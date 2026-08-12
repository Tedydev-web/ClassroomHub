import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

/**
 * The save path, against a real database — because the failure modes here are all about
 * concurrency and none of them can be observed without one.
 */
const integrationVariable = ['RUN', 'DB', 'INTEGRATION'].join('_');
const runDatabaseIntegration = process['env'][integrationVariable] === '1';

describe.runIf(runDatabaseIntegration)('saving answers', () => {
  async function load() {
    const [{ db }, schema, attempt, container] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('./exam-attempt'),
      import('./exam-container')
    ]);
    return { db, schema, attempt, container };
  }

  async function seedOpenExam(db: any, schema: any, options: { expiresInSeconds?: number | null } = {}) {
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

    const questionIds: number[] = [];
    const snapshotQuestions: unknown[] = [];

    for (let index = 0; index < 3; index += 1) {
      const [question] = await db
        .insert(schema.question)
        .values({ exerciseId, title: `Q${index + 1}`, questionTypeId: 1, points: 1, order: index + 1 })
        .returning({ id: schema.question.id });
      const [revision] = await db
        .insert(schema.questionRevision)
        .values({
          questionId: question.id,
          revision: 1,
          definition: { schemaVersion: 1, blocks: [] },
          contentHash: randomUUID()
        })
        .returning({ id: schema.questionRevision.id });
      await db
        .update(schema.question)
        .set({ currentRevisionId: revision.id })
        .where(eq(schema.question.id, question.id));

      questionIds.push(question.id);
      snapshotQuestions.push({
        questionId: question.id,
        questionRevisionId: revision.id,
        order: index + 1,
        points: 1,
        definition: { schemaVersion: 1, blocks: [] }
      });
    }

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
        paperSnapshot: { frozenAt: new Date().toISOString(), questions: snapshotQuestions }
      })
      .returning();

    const expiresAt =
      options.expiresInSeconds === undefined
        ? new Date(Date.now() + 3600_000).toISOString()
        : options.expiresInSeconds === null
          ? null
          : new Date(Date.now() + options.expiresInSeconds * 1000).toISOString();

    const [row] = await db
      .insert(schema.examAttempt)
      .values({
        examId: exam.id,
        displayName: 'Nguyễn Văn A',
        tokenHash: randomUUID(),
        startedAt: new Date().toISOString(),
        expiresAt
      })
      .returning({ id: schema.examAttempt.id });

    return { examId: exam.id as string, attemptId: row.id as string, questionIds };
  }

  it('keeps both when two saves for different questions overlap', async () => {
    const { db, schema, attempt } = await load();
    const seed = await seedOpenExam(db, schema);

    await Promise.all([
      attempt.saveAnswersService(seed.attemptId, [{ questionId: seed.questionIds[0]!, answerData: 'A' }], new Date()),
      attempt.saveAnswersService(seed.attemptId, [{ questionId: seed.questionIds[1]!, answerData: 'B' }], new Date())
    ]);

    const [row] = await db
      .select({ answers: schema.examAttempt.answers })
      .from(schema.examAttempt)
      .where(eq(schema.examAttempt.id, seed.attemptId));

    const answers = row.answers as Array<{ questionId: number }>;
    expect(answers.map((answer) => answer.questionId).sort()).toEqual(
      [seed.questionIds[0], seed.questionIds[1]].sort()
    );
  });

  it('records every change, not only the last', async () => {
    const { db, schema, attempt } = await load();
    const seed = await seedOpenExam(db, schema);

    await attempt.saveAnswersService(
      seed.attemptId,
      [{ questionId: seed.questionIds[0]!, answerData: 'A' }],
      new Date()
    );
    await attempt.saveAnswersService(
      seed.attemptId,
      [{ questionId: seed.questionIds[0]!, answerData: 'B' }],
      new Date()
    );

    const [row] = await db
      .select({ answers: schema.examAttempt.answers, answerLog: schema.examAttempt.answerLog })
      .from(schema.examAttempt)
      .where(eq(schema.examAttempt.id, seed.attemptId));

    expect((row.answers as unknown[]).length).toBe(1);
    expect((row.answerLog as unknown[]).length).toBe(2);
  });

  it('refuses a save once the grace period has passed', async () => {
    const { db, schema, attempt } = await load();
    const seed = await seedOpenExam(db, schema, { expiresInSeconds: -120 });

    await expect(
      attempt.saveAnswersService(seed.attemptId, [{ questionId: seed.questionIds[0]!, answerData: 'A' }], new Date())
    ).rejects.toThrow();
  });

  it('accepts a save inside the grace period, so a slow final request is not punished', async () => {
    const { db, schema, attempt } = await load();
    const seed = await seedOpenExam(db, schema, { expiresInSeconds: -5 });

    await expect(
      attempt.saveAnswersService(seed.attemptId, [{ questionId: seed.questionIds[0]!, answerData: 'A' }], new Date())
    ).resolves.toBeTruthy();
  });

  it('refuses an answer to a question outside the paper before it can poison the attempt', async () => {
    const { db, schema, attempt } = await load();
    const seed = await seedOpenExam(db, schema);

    await expect(
      attempt.saveAnswersService(seed.attemptId, [{ questionId: 999999, answerData: 'A' }], new Date())
    ).rejects.toThrow();
  });

  it('refuses a second submit rather than moving the submitted time', async () => {
    const { db, schema, attempt } = await load();
    const seed = await seedOpenExam(db, schema);

    await attempt.submitAttemptService(seed.attemptId, new Date());

    await expect(attempt.submitAttemptService(seed.attemptId, new Date())).rejects.toThrow();
  });

  it('refuses a save once the attempt is submitted', async () => {
    const { db, schema, attempt } = await load();
    const seed = await seedOpenExam(db, schema);

    await attempt.submitAttemptService(seed.attemptId, new Date());

    await expect(
      attempt.saveAnswersService(seed.attemptId, [{ questionId: seed.questionIds[0]!, answerData: 'A' }], new Date())
    ).rejects.toThrow();
  });
});
