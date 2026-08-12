import { db } from '@cio/db/drizzle';
import * as schema from '@cio/db/schema';
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';

import { gradeAttempt, type ExamCorrection, type ManualMarks, type StoredExamAnswer } from './exam-grading';
import type { ExamPaperSnapshot } from './exam-paper-serializer';

/**
 * Finishing attempts nobody submitted.
 *
 * There is no scheduled job. When a read path meets an attempt whose clock ran out while
 * it was still open, it finalises it first — which is what makes a closed tab a
 * non-event rather than a lost paper.
 *
 * A `GET` that writes is unusual and will surprise a reviewer. It is deliberate. Anyone
 * refactoring this into a pure read reintroduces the data loss it exists to prevent.
 */

/** How many expired attempts one request will finish before leaving the rest. */
const FINALISE_BATCH = 25;

export type FinalisationOutcome = { finalised: number; unscoreable: number };

/**
 * Finalises expired attempts for one exam, in a bounded batch.
 *
 * The batch matters: the first read after a paper closes could otherwise face a whole
 * class at once, each needing its answers and the frozen paper, which would collide with
 * the results page's own performance criterion. `SKIP LOCKED` lets two readers share the
 * work instead of queueing behind each other.
 */
export async function finaliseExpiredAttempts(examId: string, now = new Date()): Promise<FinalisationOutcome> {
  const [exam] = await db.select().from(schema.exam).where(eq(schema.exam.id, examId)).limit(1);
  if (!exam) return { finalised: 0, unscoreable: 0 };

  const snapshot = exam.paperSnapshot as ExamPaperSnapshot | null;
  if (!snapshot) return { finalised: 0, unscoreable: 0 };

  const corrections = (exam.corrections as ExamCorrection[]) ?? [];
  let finalised = 0;
  let unscoreable = 0;

  await db.transaction(async (tx) => {
    const expired = await tx
      .select()
      .from(schema.examAttempt)
      .where(
        and(
          eq(schema.examAttempt.examId, examId),
          eq(schema.examAttempt.status, 'in_progress'),
          isNotNull(schema.examAttempt.expiresAt),
          lt(schema.examAttempt.expiresAt, now.toISOString())
        )
      )
      .limit(FINALISE_BATCH)
      .for('update', { skipLocked: true });

    for (const attempt of expired) {
      // Wrapped per attempt. Without this, one malformed row makes the whole class's
      // results page fail — permanently, and at the moment a teacher most needs it.
      try {
        const graded = gradeAttempt(
          snapshot,
          (attempt.answers as StoredExamAnswer[]) ?? [],
          corrections,
          (attempt.manualScores as ManualMarks) ?? {}
        );

        await tx
          .update(schema.examAttempt)
          .set({
            status: 'expired',
            // The moment the clock ran out, not the moment somebody read the page: a paper
            // opened three days later must not claim it was submitted three days late.
            submittedAt: sql`${schema.examAttempt.expiresAt}`,
            score: String(graded.score),
            total: String(graded.total),
            gradingState: graded.gradingState,
            updatedAt: now.toISOString()
          })
          // The guard. A second reader racing this one updates no rows and reads the
          // finished attempt instead, so two page loads cannot produce two scores.
          .where(and(eq(schema.examAttempt.id, attempt.id), eq(schema.examAttempt.status, 'in_progress')));

        finalised += 1;
        if (graded.gradingState === 'unscoreable') unscoreable += 1;
      } catch {
        await tx
          .update(schema.examAttempt)
          .set({ gradingState: 'unscoreable', status: 'expired', updatedAt: now.toISOString() })
          .where(and(eq(schema.examAttempt.id, attempt.id), eq(schema.examAttempt.status, 'in_progress')));

        unscoreable += 1;
      }
    }
  });

  return { finalised, unscoreable };
}

/** Scores an attempt the sitter submitted. Same grading path, no second implementation. */
export async function scoreSubmittedAttempt(attemptId: string, now = new Date()): Promise<void> {
  const [attempt] = await db.select().from(schema.examAttempt).where(eq(schema.examAttempt.id, attemptId)).limit(1);
  if (!attempt) return;

  const [exam] = await db.select().from(schema.exam).where(eq(schema.exam.id, attempt.examId)).limit(1);
  const snapshot = exam?.paperSnapshot as ExamPaperSnapshot | null;
  if (!snapshot) return;

  const graded = gradeAttempt(
    snapshot,
    (attempt.answers as StoredExamAnswer[]) ?? [],
    (exam?.corrections as ExamCorrection[]) ?? [],
    (attempt.manualScores as ManualMarks) ?? {}
  );

  await db
    .update(schema.examAttempt)
    .set({
      score: String(graded.score),
      total: String(graded.total),
      gradingState: graded.gradingState,
      updatedAt: now.toISOString()
    })
    .where(eq(schema.examAttempt.id, attemptId));
}

/**
 * Re-scores every finished attempt of an exam after a correction. Attempts still in
 * progress are deliberately left alone: they pick the correction up when they finalise,
 * because grading reads the corrections rather than a stored decision.
 */
export async function rescoreFinishedAttempts(examId: string, now = new Date()): Promise<number> {
  const [exam] = await db.select().from(schema.exam).where(eq(schema.exam.id, examId)).limit(1);
  const snapshot = exam?.paperSnapshot as ExamPaperSnapshot | null;
  if (!exam || !snapshot) return 0;

  const corrections = (exam.corrections as ExamCorrection[]) ?? [];
  const finished = await db
    .select()
    .from(schema.examAttempt)
    .where(and(eq(schema.examAttempt.examId, examId), sql`${schema.examAttempt.status} <> 'in_progress'`));

  let rescored = 0;

  for (const attempt of finished) {
    const graded = gradeAttempt(
      snapshot,
      (attempt.answers as StoredExamAnswer[]) ?? [],
      corrections,
      (attempt.manualScores as ManualMarks) ?? {}
    );

    await db
      .update(schema.examAttempt)
      .set({
        score: String(graded.score),
        total: String(graded.total),
        gradingState: graded.gradingState,
        updatedAt: now.toISOString()
      })
      .where(eq(schema.examAttempt.id, attempt.id));

    rescored += 1;
  }

  return rescored;
}
