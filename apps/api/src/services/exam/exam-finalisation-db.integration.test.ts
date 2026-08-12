import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

/**
 * Finalising abandoned attempts. Every claim here is about concurrency or persistence,
 * so none of it can be observed without a real database.
 */
const integrationVariable = ['RUN', 'DB', 'INTEGRATION'].join('_');
const runDatabaseIntegration = process['env'][integrationVariable] === '1';

describe.runIf(runDatabaseIntegration)('finalising expired attempts', () => {
  async function load() {
    const [{ db }, schema, finalisation] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('./exam-finalisation')
    ]);
    return { db, schema, finalisation };
  }

  function choiceDefinition() {
    return {
      schemaVersion: 1,
      blocks: [
        {
          id: 'b1',
          kind: 'interaction',
          interaction: {
            kind: 'choice',
            prompt: { html: '<p>Which one?</p>' },
            required: true,
            maxScore: 1,
            config: {
              cardinality: 'single',
              presentation: 'list',
              options: [
                { id: '1', html: '<p>A</p>' },
                { id: '2', html: '<p>B</p>' }
              ],
              correctOptionIds: ['2']
            }
          }
        }
      ]
    };
  }

  async function seedExamWithExpiredAttempt(
    db: any,
    schema: any,
    options: { answerOption?: string; brokenDefinition?: boolean } = {}
  ) {
    const suffix = randomUUID().slice(0, 8);

    const [organization] = await db
      .insert(schema.organization)
      .values({ name: `Org ${suffix}` })
      .returning({ id: schema.organization.id });
    const [user] = await db
      .insert(schema.user)
      .values({ id: randomUUID(), name: 'T', email: `t-${suffix}@test.local` })
      .returning({ id: schema.user.id });
    await db.insert(schema.profile).values({ id: user.id, fullname: 'T', username: `t-${suffix}` });

    const { createExamContainer } = await import('./exam-container');
    const exerciseId = await createExamContainer(`Paper ${suffix}`, db);

    const expiredAt = new Date(Date.now() - 600_000).toISOString();
    const [exam] = await db
      .insert(schema.exam)
      .values({
        organizationId: organization.id,
        exerciseId,
        title: 'Paper',
        slug: randomUUID().replace(/-/g, '').slice(0, 16),
        createdBy: user.id,
        mode: 'public',
        status: 'open',
        paperSnapshot: {
          frozenAt: new Date().toISOString(),
          questions: [
            {
              questionId: 1,
              questionRevisionId: randomUUID(),
              order: 1,
              points: 1,
              definition: options.brokenDefinition ? {} : choiceDefinition()
            }
          ]
        }
      })
      .returning({ id: schema.exam.id });

    const answers = options.answerOption
      ? [
          {
            questionId: 1,
            questionRevisionId: randomUUID(),
            answerData: {
              schemaVersion: 1,
              responses: [
                { interactionId: 'b1', response: { kind: 'choice', selectedOptionIds: [options.answerOption] } }
              ]
            }
          }
        ]
      : [];

    const [attempt] = await db
      .insert(schema.examAttempt)
      .values({
        examId: exam.id,
        displayName: 'Nguyễn Văn A',
        tokenHash: randomUUID(),
        startedAt: new Date(Date.now() - 1_200_000).toISOString(),
        expiresAt: expiredAt,
        answers
      })
      .returning({ id: schema.examAttempt.id });

    return { examId: exam.id as string, attemptId: attempt.id as string, expiredAt };
  }

  it('scores an abandoned attempt from whatever was saved', async () => {
    const { db, schema, finalisation } = await load();
    const seed = await seedExamWithExpiredAttempt(db, schema, { answerOption: '2' });

    await finalisation.finaliseExpiredAttempts(seed.examId);

    const [row] = await db
      .select({ status: schema.examAttempt.status, score: schema.examAttempt.score })
      .from(schema.examAttempt)
      .where(eq(schema.examAttempt.id, seed.attemptId));

    expect(row.status).toBe('expired');
    expect(Number(row.score)).toBeGreaterThan(0);
  });

  it('records the moment the clock ran out, not the moment somebody read the page', async () => {
    const { db, schema, finalisation } = await load();
    const seed = await seedExamWithExpiredAttempt(db, schema, { answerOption: '2' });

    await finalisation.finaliseExpiredAttempts(seed.examId);

    const [row] = await db
      .select({ submittedAt: schema.examAttempt.submittedAt })
      .from(schema.examAttempt)
      .where(eq(schema.examAttempt.id, seed.attemptId));

    expect(new Date(row.submittedAt!).toISOString()).toBe(new Date(seed.expiredAt).toISOString());
  });

  it('produces one score when two readers race, not two', async () => {
    const { db, schema, finalisation } = await load();
    const seed = await seedExamWithExpiredAttempt(db, schema, { answerOption: '2' });

    const [first, second] = await Promise.all([
      finalisation.finaliseExpiredAttempts(seed.examId),
      finalisation.finaliseExpiredAttempts(seed.examId)
    ]);

    expect(first.finalised + second.finalised).toBe(1);
  });

  it('leaves an attempt it cannot score marked, and does not throw', async () => {
    const { db, schema, finalisation } = await load();
    const seed = await seedExamWithExpiredAttempt(db, schema, { answerOption: '2', brokenDefinition: true });

    await expect(finalisation.finaliseExpiredAttempts(seed.examId)).resolves.toBeTruthy();

    const [row] = await db
      .select({ gradingState: schema.examAttempt.gradingState })
      .from(schema.examAttempt)
      .where(eq(schema.examAttempt.id, seed.attemptId));

    expect(row.gradingState).toBe('unscoreable');
  });

  it('re-scores finished attempts when a correction awards a question to everybody', async () => {
    const { db, schema, finalisation } = await load();
    // Answered wrongly, so only a correction can move the score.
    const seed = await seedExamWithExpiredAttempt(db, schema, { answerOption: '1' });

    await finalisation.finaliseExpiredAttempts(seed.examId);

    await db
      .update(schema.exam)
      .set({ corrections: [{ kind: 'award', questionId: 1, by: 'teacher', at: new Date().toISOString() }] })
      .where(eq(schema.exam.id, seed.examId));

    await finalisation.rescoreFinishedAttempts(seed.examId);

    const [row] = await db
      .select({ score: schema.examAttempt.score })
      .from(schema.examAttempt)
      .where(eq(schema.examAttempt.id, seed.attemptId));

    expect(Number(row.score)).toBeGreaterThan(0);
  });

  it('applies a correction to an attempt finalised only afterwards, with nobody re-running a sweep', async () => {
    const { db, schema, finalisation } = await load();
    const seed = await seedExamWithExpiredAttempt(db, schema, { answerOption: '1' });

    // The correction lands while the attempt is still unfinalised.
    await db
      .update(schema.exam)
      .set({ corrections: [{ kind: 'award', questionId: 1, by: 'teacher', at: new Date().toISOString() }] })
      .where(eq(schema.exam.id, seed.examId));

    await finalisation.finaliseExpiredAttempts(seed.examId);

    const [row] = await db
      .select({ score: schema.examAttempt.score })
      .from(schema.examAttempt)
      .where(eq(schema.examAttempt.id, seed.attemptId));

    expect(Number(row.score)).toBeGreaterThan(0);
  });
});
