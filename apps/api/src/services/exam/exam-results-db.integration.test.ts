import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

/**
 * The teacher's side. Reading the list is what finalises abandoned attempts, so most of
 * these claims are about what one request does to the database.
 */
const integrationVariable = ['RUN', 'DB', 'INTEGRATION'].join('_');
const runDatabaseIntegration = process['env'][integrationVariable] === '1';

describe.runIf(runDatabaseIntegration)('exam results', () => {
  async function load() {
    const [{ db }, schema, results] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('./exam-results')
    ]);
    return { db, schema, results };
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
            prompt: { html: '<p>Q</p>' },
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

  async function seedExam(db: any, schema: any) {
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
            { questionId: 1, questionRevisionId: randomUUID(), order: 1, points: 1, definition: choiceDefinition() }
          ]
        }
      })
      .returning({ id: schema.exam.id });

    return exam.id as string;
  }

  async function addAttempt(
    db: any,
    schema: any,
    examId: string,
    options: { name?: string; ipHash?: string; expiredMinutesAgo?: number; answerOption?: string } = {}
  ) {
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
        examId,
        displayName: options.name ?? 'Nguyễn Văn A',
        tokenHash: randomUUID(),
        startedAt: new Date(Date.now() - 3_600_000).toISOString(),
        expiresAt: new Date(Date.now() - (options.expiredMinutesAgo ?? 10) * 60_000).toISOString(),
        ipHash: options.ipHash ?? null,
        answers
      })
      .returning({ id: schema.examAttempt.id });

    return attempt.id as string;
  }

  it('finalises expired attempts in the same request that lists them', async () => {
    const { db, schema, results } = await load();
    const examId = await seedExam(db, schema);
    const attemptId = await addAttempt(db, schema, examId, { answerOption: '2' });

    const rows = await results.listExamResultsService(examId);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('expired');
    expect(Number(rows[0]?.score)).toBeGreaterThan(0);

    const [stored] = await db
      .select({ status: schema.examAttempt.status })
      .from(schema.examAttempt)
      .where(eq(schema.examAttempt.id, attemptId));
    expect(stored.status).toBe('expired');
  });

  it('flags two sitters who typed the same name, rather than refusing the second', async () => {
    const { db, schema, results } = await load();
    const examId = await seedExam(db, schema);
    await addAttempt(db, schema, examId, { name: 'Trần Thị B' });
    await addAttempt(db, schema, examId, { name: 'trần thị b' });
    await addAttempt(db, schema, examId, { name: 'Lê Văn C' });

    const rows = await results.listExamResultsService(examId);

    expect(rows.filter((row) => row.duplicateName)).toHaveLength(2);
    expect(rows.find((row) => row.displayName === 'Lê Văn C')?.duplicateName).toBe(false);
  });

  it('flags two sitters from the same network', async () => {
    const { db, schema, results } = await load();
    const examId = await seedExam(db, schema);
    await addAttempt(db, schema, examId, { name: 'A', ipHash: 'same-network' });
    await addAttempt(db, schema, examId, { name: 'B', ipHash: 'same-network' });

    const rows = await results.listExamResultsService(examId);

    expect(rows.every((row) => row.duplicateAddress)).toBe(true);
  });

  it('never exposes the address hash itself, only that it repeated', async () => {
    const { db, schema, results } = await load();
    const examId = await seedExam(db, schema);
    await addAttempt(db, schema, examId, { ipHash: 'secret-hash' });

    const rows = await results.listExamResultsService(examId);

    expect(JSON.stringify(rows)).not.toContain('secret-hash');
  });

  it('keeps a hand mark and recomputes the total through one function', async () => {
    const { db, schema, results } = await load();
    const examId = await seedExam(db, schema);
    const attemptId = await addAttempt(db, schema, examId, { answerOption: '1' });

    await results.listExamResultsService(examId);
    const marked = await results.saveManualMarkService(attemptId, 1, { score: 3, comment: 'Tốt' });

    expect(Number(marked.score)).toBeGreaterThanOrEqual(3);
  });

  it('replaces a mark rather than adding to it when the same question is marked twice', async () => {
    const { db, schema, results } = await load();
    const examId = await seedExam(db, schema);
    const attemptId = await addAttempt(db, schema, examId, { answerOption: '1' });

    await results.saveManualMarkService(attemptId, 1, { score: 3 });
    const second = await results.saveManualMarkService(attemptId, 1, { score: 5 });

    expect(Number(second.score)).toBe(5);
  });

  it('reopens an expired attempt without the finaliser closing it again in the same request', async () => {
    const { db, schema, results } = await load();
    const examId = await seedExam(db, schema);
    const attemptId = await addAttempt(db, schema, examId, { answerOption: '2' });

    await results.listExamResultsService(examId);
    await results.reopenAttemptService(attemptId, 600);

    // The very next read runs the finaliser again.
    const rows = await results.listExamResultsService(examId);

    expect(rows[0]?.status).toBe('in_progress');
  });

  it('keeps the answers when an attempt is reopened, so the sitter resumes', async () => {
    const { db, schema, results } = await load();
    const examId = await seedExam(db, schema);
    const attemptId = await addAttempt(db, schema, examId, { answerOption: '2' });

    await results.listExamResultsService(examId);
    await results.reopenAttemptService(attemptId, 600);

    const [row] = await db
      .select({ answers: schema.examAttempt.answers })
      .from(schema.examAttempt)
      .where(eq(schema.examAttempt.id, attemptId));

    expect((row.answers as unknown[]).length).toBe(1);
  });

  it('re-scores finished attempts when a correction is added', async () => {
    const { db, schema, results } = await load();
    const examId = await seedExam(db, schema);
    const attemptId = await addAttempt(db, schema, examId, { answerOption: '1' });

    await results.listExamResultsService(examId);
    await results.addCorrectionService(examId, {
      kind: 'award',
      questionId: 1,
      by: 'teacher',
      at: new Date().toISOString()
    });

    const [row] = await db
      .select({ score: schema.examAttempt.score })
      .from(schema.examAttempt)
      .where(eq(schema.examAttempt.id, attemptId));

    expect(Number(row.score)).toBeGreaterThan(0);
  });
});
