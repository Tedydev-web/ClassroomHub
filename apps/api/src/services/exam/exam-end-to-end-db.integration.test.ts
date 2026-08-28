import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@cio/core/config/env', async (importOriginal) => {
  const actual = await importOriginal<{ env: Record<string, unknown> }>();
  return { env: { ...actual.env, EXAM_ENABLED: 'true' } };
});

/**
 * The whole thing, once, against a real database: a teacher makes a paper, opens it, a
 * student with no account sits it, closes the tab, and the teacher reads a score.
 *
 * Every phase has its own tests for its own rules. This one exists because those can all
 * pass while the seams between them do not line up — and the seams are where a feature
 * assembled over eight phases actually breaks.
 */
const integrationVariable = ['RUN', 'DB', 'INTEGRATION'].join('_');
const runDatabaseIntegration = process['env'][integrationVariable] === '1';

describe.runIf(runDatabaseIntegration)('a paper from creation to a score', () => {
  async function load() {
    const [{ db }, schema, container, exam, attempt, results] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('./exam-container'),
      import('./exam'),
      import('./exam-attempt'),
      import('./exam-results')
    ]);
    return { db, schema, container, exam, attempt, results };
  }

  function choiceDefinition(correctOptionId: string) {
    return {
      schemaVersion: 1,
      blocks: [
        {
          id: 'b1',
          kind: 'interaction',
          interaction: {
            kind: 'choice',
            prompt: { html: '<p>Chọn đáp án đúng</p>' },
            required: true,
            maxScore: 1,
            config: {
              cardinality: 'single',
              presentation: 'list',
              options: [
                { id: '1', html: '<p>focus</p>' },
                { id: '2', html: '<p>attention</p>' }
              ],
              correctOptionIds: [correctOptionId]
            }
          }
        }
      ]
    };
  }

  async function seedTeacherAndCourse(db: any, schema: any) {
    const suffix = randomUUID().slice(0, 8);

    const [organization] = await db
      .insert(schema.organization)
      .values({ name: `Org ${suffix}` })
      .returning({ id: schema.organization.id });
    const [group] = await db
      .insert(schema.group)
      .values({ organizationId: organization.id, name: `Group ${suffix}` })
      .returning({ id: schema.group.id });
    const [course] = await db
      .insert(schema.course)
      .values({
        title: `Course ${suffix}`,
        description: 'E2E',
        groupId: group.id,
        slug: `course-${suffix}`,
        status: 'ACTIVE'
      })
      .returning({ id: schema.course.id });
    const [user] = await db
      .insert(schema.user)
      .values({ id: randomUUID(), name: 'Teacher', email: `teacher-${suffix}@test.local` })
      .returning({ id: schema.user.id });
    await db.insert(schema.profile).values({ id: user.id, fullname: 'Teacher', username: `teacher-${suffix}` });

    return { courseId: course.id as string, teacherId: user.id as string };
  }

  /** A two-question paper, one of which is deliberately keyed wrongly. */
  async function seedContainer(db: any, schema: any) {
    const { createExamContainer } = await import('./exam-container');
    const exerciseId = await createExamContainer(`Paper ${randomUUID().slice(0, 8)}`, db);

    for (const [index, correct] of [true, false].entries()) {
      const [question] = await db
        .insert(schema.question)
        .values({ exerciseId, title: `Câu ${index + 1}`, questionTypeId: 1, points: 1, order: index + 1 })
        .returning({ id: schema.question.id });

      await db.insert(schema.option).values([
        { questionId: question.id, label: 'focus', isCorrect: false },
        { questionId: question.id, label: 'attention', isCorrect: correct }
      ]);

      const [revision] = await db
        .insert(schema.questionRevision)
        .values({
          questionId: question.id,
          revision: 1,
          definition: choiceDefinition('2'),
          contentHash: randomUUID()
        })
        .returning({ id: schema.questionRevision.id });

      await db
        .update(schema.question)
        .set({ currentRevisionId: revision.id })
        .where(eq(schema.question.id, question.id));
    }

    return exerciseId;
  }

  it('carries a student from a link to a score the teacher can read', async () => {
    const { db, schema, container, exam, attempt, results } = await load();
    const { courseId, teacherId } = await seedTeacherAndCourse(db, schema);
    const exerciseId = await seedContainer(db, schema);

    // The teacher checks the paper before sending it. Our import once shipped a paper with
    // missing keys, so this is the step that would have caught it.
    const summary = await container.summariseContainer(exerciseId, db);
    expect(summary.questionCount).toBe(2);
    expect(summary.questionsWithoutAnswerKey).toHaveLength(1);

    const created = await exam.createExamService(
      {
        title: 'Đề kiểm tra 15 phút',
        exerciseId,
        mode: 'public',
        workingSeconds: 900,
        opensAt: null,
        closesAt: null,
        maxAttempts: 1,
        requiresName: true,
        requiresClass: true,
        requiresCandidateNumber: false,
        scoreVisibility: 'never',
        answerVisibility: 'never',
        commentVisibility: 'never',
        revealThreshold: null,
        autoSubmitAfterLeaves: null,
        supportContact: null
      },
      courseId,
      teacherId
    );

    expect(created.status).toBe('draft');
    expect(created.paperSnapshot).toBeNull();

    // Opening is what freezes the paper.
    const opened = await exam.openExamService(created.id);
    expect(opened.status).toBe('open');
    expect((opened.paperSnapshot as { questions: unknown[] }).questions).toHaveLength(2);

    const publicView = await exam.getPublicExamService(opened.slug);
    expect(publicView.id).toBe(created.id);

    const started = await attempt.startAttemptService({
      exam: opened,
      identity: { displayName: 'Nguyễn Văn A', className: '12A1' },
      profileId: null,
      password: null,
      ipHash: 'school-network',
      userAgent: 'test-agent',
      now: new Date()
    });

    // The paper reached the student with no answer key anywhere in it.
    expect(JSON.stringify(started.paper)).not.toContain('correctOptionIds');

    const questionIds = (opened.paperSnapshot as { questions: Array<{ questionId: number }> }).questions.map(
      (question) => question.questionId
    );

    await attempt.saveAnswersService(
      started.attempt.id,
      [
        {
          questionId: questionIds[0]!,
          answerData: {
            schemaVersion: 1,
            responses: [{ interactionId: 'b1', response: { kind: 'choice', selectedOptionIds: ['2'] } }]
          }
        }
      ],
      new Date()
    );

    // The student closes the tab without submitting, and their clock runs out.
    await db
      .update(schema.examAttempt)
      .set({ expiresAt: new Date(Date.now() - 60_000).toISOString() })
      .where(eq(schema.examAttempt.id, started.attempt.id));

    const rows = await results.listExamResultsService(created.id);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.displayName).toBe('Nguyễn Văn A');
    expect(rows[0]?.className).toBe('12A1');
    expect(rows[0]?.status).toBe('expired');
    expect(Number(rows[0]?.score)).toBeGreaterThan(0);
  });

  it('lets the teacher correct a wrong key afterwards, and the score follows', async () => {
    const { db, schema, exam, attempt, results } = await load();
    const { courseId, teacherId } = await seedTeacherAndCourse(db, schema);
    const exerciseId = await seedContainer(db, schema);

    const created = await exam.createExamService(
      {
        title: 'Đề có đáp án sai',
        exerciseId,
        mode: 'public',
        workingSeconds: 900,
        opensAt: null,
        closesAt: null,
        maxAttempts: 1,
        requiresName: true,
        requiresClass: false,
        requiresCandidateNumber: false,
        scoreVisibility: 'never',
        answerVisibility: 'never',
        commentVisibility: 'never',
        revealThreshold: null,
        autoSubmitAfterLeaves: null,
        supportContact: null
      },
      courseId,
      teacherId
    );
    const opened = await exam.openExamService(created.id);
    const questionIds = (opened.paperSnapshot as { questions: Array<{ questionId: number }> }).questions.map(
      (question) => question.questionId
    );

    const started = await attempt.startAttemptService({
      exam: opened,
      identity: { displayName: 'Trần Thị B' },
      profileId: null,
      password: null,
      ipHash: null,
      userAgent: null,
      now: new Date()
    });

    // Answers option 1 — wrong under the frozen key.
    await attempt.saveAnswersService(
      started.attempt.id,
      [
        {
          questionId: questionIds[0]!,
          answerData: {
            schemaVersion: 1,
            responses: [{ interactionId: 'b1', response: { kind: 'choice', selectedOptionIds: ['1'] } }]
          }
        }
      ],
      new Date()
    );
    await attempt.submitAttemptService(started.attempt.id, new Date());

    const before = await results.listExamResultsService(created.id);
    const scoreBefore = Number(before[0]?.score ?? 0);

    // The teacher decides the key was wrong: option 1 was correct all along.
    await results.addCorrectionService(created.id, {
      kind: 'keyFix',
      questionId: questionIds[0]!,
      previousKey: ['2'],
      correctedKey: ['1'],
      by: teacherId,
      at: new Date().toISOString()
    });

    const after = await results.listExamResultsService(created.id);

    expect(Number(after[0]?.score)).toBeGreaterThan(scoreBefore);

    // And the frozen paper still records what was actually delivered.
    const [stored] = await db.select().from(schema.exam).where(eq(schema.exam.id, created.id));
    const frozen = stored.paperSnapshot as {
      questions: Array<{ definition: { blocks: Array<{ interaction: { config: { correctOptionIds: string[] } } }> } }>;
    };
    expect(frozen.questions[0]?.definition.blocks[0]?.interaction.config.correctOptionIds).toEqual(['2']);
  });
});
