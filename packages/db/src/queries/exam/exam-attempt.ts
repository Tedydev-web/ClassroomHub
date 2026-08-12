import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';

import { db, type DbOrTxClient } from '../../drizzle';
import * as schema from '../../schema';

/**
 * Reads and writes for a single sitting.
 *
 * Two of these carry rules that only make sense together with the plan: attempts are
 * resumed by hashed cookie rather than by name, because two sitters may type the same
 * name; and finalisation is a guarded update, so two readers racing to finalise the
 * same expired attempt produce one score rather than two.
 */

export async function getAttemptByToken(examId: string, tokenHash: string, dbClient: DbOrTxClient = db) {
  const [attempt] = await dbClient
    .select()
    .from(schema.examAttempt)
    .where(and(eq(schema.examAttempt.examId, examId), eq(schema.examAttempt.tokenHash, tokenHash)))
    .limit(1);

  return attempt ?? null;
}

export async function getAttemptById(id: string, dbClient: DbOrTxClient = db) {
  const [attempt] = await dbClient.select().from(schema.examAttempt).where(eq(schema.examAttempt.id, id)).limit(1);

  return attempt ?? null;
}

/** Locks the row for the duration of the transaction, so overlapping saves cannot lose one another. */
export async function lockAttemptForUpdate(id: string, dbClient: DbOrTxClient) {
  const [attempt] = await dbClient
    .select()
    .from(schema.examAttempt)
    .where(eq(schema.examAttempt.id, id))
    .limit(1)
    .for('update');

  return attempt ?? null;
}

/**
 * Attempts whose clock ran out while they were still open. Bounded and skipping locked
 * rows, so the first page load after a paper closes does not try to finalise a whole
 * class in one request.
 */
export async function claimExpiredAttempts(examId: string, limit: number, dbClient: DbOrTxClient) {
  return dbClient
    .select()
    .from(schema.examAttempt)
    .where(
      and(
        eq(schema.examAttempt.examId, examId),
        eq(schema.examAttempt.status, 'in_progress'),
        isNotNull(schema.examAttempt.expiresAt),
        lt(schema.examAttempt.expiresAt, sql`now()`)
      )
    )
    .limit(limit)
    .for('update', { skipLocked: true });
}

/**
 * Marks an expired attempt finished with the score it earned. The status predicate is
 * the guard: a second writer racing the first updates no rows and reads the finished
 * one instead. `submittedAt` is the moment the clock ran out, not the moment anybody
 * happened to read the page.
 */
export async function finaliseExpiredAttempt(
  id: string,
  scored: { score: string; total: string; gradingState: 'complete' | 'awaiting_manual' | 'unscoreable' },
  dbClient: DbOrTxClient
) {
  const [attempt] = await dbClient
    .update(schema.examAttempt)
    .set({
      status: 'expired',
      submittedAt: sql`${schema.examAttempt.expiresAt}`,
      score: scored.score,
      total: scored.total,
      gradingState: scored.gradingState,
      updatedAt: new Date().toISOString()
    })
    .where(and(eq(schema.examAttempt.id, id), eq(schema.examAttempt.status, 'in_progress')))
    .returning({ id: schema.examAttempt.id });

  return attempt ?? null;
}
