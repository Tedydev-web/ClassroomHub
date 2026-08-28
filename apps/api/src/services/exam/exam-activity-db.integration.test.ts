import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

/**
 * Recording that a candidate left the paper, and the one case where that ends it.
 *
 * The enforcement half is off unless a teacher switched it on, so the first thing these
 * pin is that an exam nobody configured records everything and submits nothing.
 */
const integrationVariable = ['RUN', 'DB', 'INTEGRATION'].join('_');
const runDatabaseIntegration = process['env'][integrationVariable] === '1';

describe.runIf(runDatabaseIntegration)('recording a candidate leaving the paper', () => {
  async function load() {
    const [{ db }, schema, attempt] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('./exam-attempt')
    ]);
    return { db, schema, attempt };
  }

  async function seedSitting(db: any, schema: any, autoSubmitAfterLeaves: number | null) {
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
        autoSubmitAfterLeaves,
        paperSnapshot: {
          frozenAt: new Date().toISOString(),
          questions: [
            {
              questionId: 1,
              questionRevisionId: randomUUID(),
              order: 1,
              points: 1,
              definition: { schemaVersion: 1, blocks: [] }
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
        answers: []
      })
      .returning({ id: schema.examAttempt.id });

    return { attemptId: sitting.id as string };
  }

  const leaving = (seconds: number) => ({
    kind: 'left' as const,
    at: new Date(Date.UTC(2026, 7, 28, 9, 0, seconds)).toISOString()
  });
  const returning = (seconds: number) => ({
    kind: 'returned' as const,
    at: new Date(Date.UTC(2026, 7, 28, 9, 0, seconds)).toISOString()
  });

  it('records without ending the paper where no teacher asked for that', async () => {
    const { db, schema, attempt } = await load();
    const { attemptId } = await seedSitting(db, schema, null);

    for (let round = 0; round < 5; round += 1) {
      const outcome = await attempt.recordActivityService(
        attemptId,
        [leaving(round * 60), returning(round * 60 + 20)],
        new Date()
      );

      expect(outcome.submitted).toBe(false);
      expect(outcome.autoSubmitAfterLeaves).toBeNull();
    }

    const [row] = await db
      .select({ status: schema.examAttempt.status, activityLog: schema.examAttempt.activityLog })
      .from(schema.examAttempt)
      .where(eq(schema.examAttempt.id, attemptId));

    expect(row.status).toBe('in_progress');
    expect((row.activityLog as unknown[]).length).toBe(10);
  });

  it('ends the paper only after the limit a teacher set is passed', async () => {
    const { db, schema, attempt } = await load();
    const { attemptId } = await seedSitting(db, schema, 2);

    const first = await attempt.recordActivityService(attemptId, [leaving(0), returning(20)], new Date());
    expect(first.submitted).toBe(false);
    expect(first.leaves).toBe(1);

    // The second departure reaches the limit without passing it.
    const second = await attempt.recordActivityService(attemptId, [leaving(60), returning(80)], new Date());
    expect(second.submitted).toBe(false);
    expect(second.leaves).toBe(2);

    const third = await attempt.recordActivityService(attemptId, [leaving(120)], new Date());
    expect(third.submitted).toBe(true);
    expect(third.leaves).toBe(3);

    const [row] = await db
      .select({ status: schema.examAttempt.status, submittedAt: schema.examAttempt.submittedAt })
      .from(schema.examAttempt)
      .where(eq(schema.examAttempt.id, attemptId));

    expect(row.status).toBe('submitted');
    expect(row.submittedAt).not.toBeNull();
  });

  it('accepts a late report against a finished paper instead of raising at the candidate', async () => {
    const { db, schema, attempt } = await load();
    const { attemptId } = await seedSitting(db, schema, null);

    await db
      .update(schema.examAttempt)
      .set({ status: 'submitted', submittedAt: new Date().toISOString() })
      .where(eq(schema.examAttempt.id, attemptId));

    const outcome = await attempt.recordActivityService(attemptId, [leaving(0)], new Date());

    expect(outcome.submitted).toBe(true);
  });
});
