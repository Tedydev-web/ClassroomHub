import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

/**
 * Scoring a paper the sitter submitted, and what they are shown of it.
 *
 * The finalisation pass only picks up attempts whose clock ran out, so a submitted paper
 * is scored nowhere else. It shipped that way once: `scoreSubmittedAttempt` existed,
 * nothing called it, and every student who pressed the button kept a null score while the
 * teacher's page reported the grading as complete.
 */
const integrationVariable = ['RUN', 'DB', 'INTEGRATION'].join('_');
const runDatabaseIntegration = process['env'][integrationVariable] === '1';

describe.runIf(runDatabaseIntegration)('scoring a submitted attempt', () => {
  async function load() {
    const [{ db }, schema, finalisation, results, attempt] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('./exam-finalisation'),
      import('./exam-results'),
      import('./exam-attempt')
    ]);
    return { db, schema, finalisation, results, attempt };
  }

  /** A one-question paper, plus an attempt that answered it correctly. */
  async function seed(db: any, schema: any, scoreVisibility: string) {
    const suffix = randomUUID().slice(0, 8);
    const [organization] = await db
      .insert(schema.organization)
      .values({ name: `Org ${suffix}` })
      .returning({ id: schema.organization.id });
    const [user] = await db
      .insert(schema.user)
      .values({ id: randomUUID(), name: 'Teacher', email: `teacher-${suffix}@test.local` })
      .returning({ id: schema.user.id });
    await db.insert(schema.profile).values({ id: user.id, fullname: 'Teacher', username: `teacher-${suffix}` });

    const [container] = await db
      .insert(schema.exercise)
      .values({ title: `Paper ${suffix}`, courseId: null, lessonId: null })
      .returning({ id: schema.exercise.id });
    const [question] = await db
      .insert(schema.question)
      .values({ exerciseId: container.id, title: 'Câu 1', questionTypeId: 1, points: 2, order: 1 })
      .returning({ id: schema.question.id });

    const definition = {
      schemaVersion: 1,
      blocks: [
        {
          id: 'i1',
          kind: 'interaction',
          interaction: {
            kind: 'choice',
            maxScore: 2,
            required: true,
            prompt: { html: '<p>Câu 1</p>', format: 'html' },
            config: {
              cardinality: 'single',
              presentation: 'list',
              options: [
                { id: 'a', html: '<p>A</p>' },
                { id: 'b', html: '<p>B</p>' }
              ],
              correctOptionIds: ['a']
            }
          }
        }
      ],
      feedback: []
    };

    const [revision] = await db
      .insert(schema.questionRevision)
      .values({ questionId: question.id, revision: 1, definition, contentHash: randomUUID() })
      .returning({ id: schema.questionRevision.id });
    await db.update(schema.question).set({ currentRevisionId: revision.id }).where(eq(schema.question.id, question.id));

    const [exam] = await db
      .insert(schema.exam)
      .values({
        organizationId: organization.id,
        exerciseId: container.id,
        title: `Exam ${suffix}`,
        slug: `slug-${suffix}`,
        mode: 'public',
        status: 'open',
        workingSeconds: 900,
        scoreVisibility,
        createdBy: user.id,
        paperSnapshot: {
          frozenAt: new Date().toISOString(),
          questions: [
            {
              questionId: question.id,
              questionRevisionId: revision.id,
              order: 1,
              points: 2,
              definition
            }
          ]
        }
      })
      .returning({ id: schema.exam.id });

    const [sitting] = await db
      .insert(schema.examAttempt)
      .values({
        examId: exam.id,
        displayName: 'Nguyễn Văn A',
        tokenHash: randomUUID(),
        startedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        status: 'in_progress',
        answers: [
          {
            questionId: question.id,
            questionRevisionId: revision.id,
            answerData: {
              schemaVersion: 1,
              responses: [{ interactionId: 'i1', response: { kind: 'choice', selectedOptionIds: ['a'] } }]
            }
          }
        ]
      })
      .returning({ id: schema.examAttempt.id });

    return { attemptId: sitting.id as string, examId: exam.id as string };
  }

  it('scores the paper when the sitter submits it', async () => {
    const { db, schema, finalisation, attempt: attemptService } = await load();
    const { attemptId } = await seed(db, schema, 'never');

    await attemptService.submitAttemptService(attemptId, new Date());
    await finalisation.scoreSubmittedAttempt(attemptId);

    const [row] = await db
      .select({
        score: schema.examAttempt.score,
        total: schema.examAttempt.total,
        state: schema.examAttempt.gradingState
      })
      .from(schema.examAttempt)
      .where(eq(schema.examAttempt.id, attemptId));

    expect(Number(row.score)).toBe(2);
    expect(Number(row.total)).toBe(2);
    expect(row.state).toBe('complete');
  });

  it('shows the sitter their score when the teacher chose to', async () => {
    const { db, schema, finalisation, results, attempt: attemptService } = await load();
    const { attemptId } = await seed(db, schema, 'on_submit');

    await attemptService.submitAttemptService(attemptId, new Date());
    await finalisation.scoreSubmittedAttempt(attemptId);

    const revealed = await results.revealedScoreForSitterService(attemptId);

    expect(revealed).toEqual({ score: '2', total: '2' });
  });

  it('shows the sitter nothing when the teacher did not', async () => {
    const { db, schema, finalisation, results, attempt: attemptService } = await load();
    const { attemptId } = await seed(db, schema, 'never');

    await attemptService.submitAttemptService(attemptId, new Date());
    await finalisation.scoreSubmittedAttempt(attemptId);

    expect(await results.revealedScoreForSitterService(attemptId)).toBeNull();
  });

  it('shows nothing to somebody still sitting, whatever the setting says', async () => {
    const { db, schema, results } = await load();
    const { attemptId } = await seed(db, schema, 'on_submit');

    // Not submitted: the reveal policy must refuse regardless of a score being present.
    await db
      .update(schema.examAttempt)
      .set({ score: '2', total: '2', gradingState: 'complete' })
      .where(eq(schema.examAttempt.id, attemptId));

    expect(await results.revealedScoreForSitterService(attemptId)).toBeNull();
  });

  it('deletes a sitting so the paper can be sat again from nothing', async () => {
    const { db, schema, results } = await load();
    const { attemptId, examId } = await seed(db, schema, 'never');

    await results.deleteAttemptService(attemptId);

    const rows = await results.listExamResultsService(examId);
    expect(rows.find((entry) => entry.attemptId === attemptId)).toBeUndefined();

    // Deleting the same sitting twice is the teacher clicking twice, not an error worth a 500.
    await expect(results.deleteAttemptService(attemptId)).rejects.toThrow(/no longer exists/);
  });

  it('reports the score on the teacher list too', async () => {
    const { db, schema, finalisation, results, attempt: attemptService } = await load();
    const { attemptId, examId } = await seed(db, schema, 'never');

    await attemptService.submitAttemptService(attemptId, new Date());
    await finalisation.scoreSubmittedAttempt(attemptId);

    const rows = await results.listExamResultsService(examId);
    const row = rows.find((entry) => entry.attemptId === attemptId);

    expect(row?.status).toBe('submitted');
    expect(Number(row?.score)).toBe(2);
  });
});
