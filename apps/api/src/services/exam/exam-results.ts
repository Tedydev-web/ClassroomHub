import { AppError, ErrorCodes } from '@api/utils/errors';
import { db } from '@cio/db/drizzle';
import { getExamById } from '@cio/db/queries/exam/exam';
import * as schema from '@cio/db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';

import { finaliseExpiredAttempts, rescoreFinishedAttempts } from './exam-finalisation';
import { gradeAttempt, type ExamCorrection, type ManualMarks, type StoredExamAnswer } from './exam-grading';
import { isRevealed, type ExamRevealValue } from './exam-reveal-policy';
import type { ExamPaperSnapshot } from './exam-paper-serializer';

/**
 * What a teacher reads after an exam, and the two things they can do about it.
 *
 * Reading the list finalises expired attempts first. A `GET` that writes is unusual and
 * will surprise a reviewer; it is what makes a closed tab harmless, and anybody
 * refactoring it into a pure read reintroduces the data loss it prevents.
 */

export type ExamResultRow = {
  attemptId: string;
  displayName: string | null;
  className: string | null;
  candidateNumber: string | null;
  status: 'in_progress' | 'submitted' | 'expired';
  gradingState: 'complete' | 'awaiting_manual' | 'unscoreable';
  score: string | null;
  total: string | null;
  startedAt: string;
  submittedAt: string | null;
  /** Someone else on this paper typed the same name, or came from the same network. */
  duplicateName: boolean;
  duplicateAddress: boolean;
};

/**
 * What the sitter is allowed to see of their own result, right after submitting.
 *
 * The teacher chose this per exam, and `never` is the default. Returning nothing is the
 * honest answer for every case except an explicit reveal — the sitter has no account, so
 * this one response is the only chance they get.
 */
export async function revealedScoreForSitterService(
  attemptId: string,
  now = new Date()
): Promise<{ score: string; total: string } | null> {
  const [attempt] = await db
    .select({
      examId: schema.examAttempt.examId,
      status: schema.examAttempt.status,
      gradingState: schema.examAttempt.gradingState,
      score: schema.examAttempt.score,
      total: schema.examAttempt.total
    })
    .from(schema.examAttempt)
    .where(eq(schema.examAttempt.id, attemptId))
    .limit(1);

  if (!attempt) return null;

  const exam = await getExamById(attempt.examId);
  if (!exam) return null;

  const revealed = isRevealed(exam.scoreVisibility as ExamRevealValue, {
    now,
    exam: {
      closesAt: exam.closesAt,
      workingSeconds: exam.workingSeconds,
      revealThreshold: exam.revealThreshold
    },
    attempt: {
      status: attempt.status,
      gradingState: attempt.gradingState,
      score: attempt.score,
      total: attempt.total
    }
  });

  if (!revealed || attempt.score === null || attempt.total === null) return null;

  return { score: attempt.score, total: attempt.total };
}

/**
 * The list deliberately does not select `answers` or `answerLog`. At four hundred sittings
 * those are a large read for a table that shows a score, and the detail view fetches them
 * for one attempt when it is actually opened.
 */
export async function listExamResultsService(examId: string): Promise<ExamResultRow[]> {
  const exam = await getExamById(examId);
  if (!exam) throw new AppError('Exam not found', ErrorCodes.NOT_FOUND, 404);

  await finaliseExpiredAttempts(examId);

  const rows = await db
    .select({
      attemptId: schema.examAttempt.id,
      displayName: schema.examAttempt.displayName,
      className: schema.examAttempt.className,
      candidateNumber: schema.examAttempt.candidateNumber,
      status: schema.examAttempt.status,
      gradingState: schema.examAttempt.gradingState,
      score: schema.examAttempt.score,
      total: schema.examAttempt.total,
      startedAt: schema.examAttempt.startedAt,
      submittedAt: schema.examAttempt.submittedAt,
      ipHash: schema.examAttempt.ipHash
    })
    .from(schema.examAttempt)
    .where(eq(schema.examAttempt.examId, examId))
    .orderBy(desc(schema.examAttempt.startedAt));

  // Surfaced, never blocked. Two sitters may legitimately share a name, and refusing the
  // second is worse than showing a teacher both and letting a person decide.
  const nameCounts = new Map<string, number>();
  const addressCounts = new Map<string, number>();

  for (const row of rows) {
    const name = row.displayName?.trim().toLowerCase();
    if (name) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    if (row.ipHash) addressCounts.set(row.ipHash, (addressCounts.get(row.ipHash) ?? 0) + 1);
  }

  return rows.map(({ ipHash, ...row }) => ({
    ...row,
    duplicateName: Boolean(row.displayName && (nameCounts.get(row.displayName.trim().toLowerCase()) ?? 0) > 1),
    duplicateAddress: Boolean(ipHash && (addressCounts.get(ipHash) ?? 0) > 1)
  }));
}

/** One attempt in full, including the answer trail a dispute would need. */
export async function getExamAttemptDetailService(attemptId: string) {
  const [attempt] = await db.select().from(schema.examAttempt).where(eq(schema.examAttempt.id, attemptId)).limit(1);
  if (!attempt) throw new AppError('Attempt not found', ErrorCodes.NOT_FOUND, 404);

  const exam = await getExamById(attempt.examId);
  if (!exam) throw new AppError('Exam not found', ErrorCodes.NOT_FOUND, 404);

  return {
    attempt,
    // The teacher sees the paper with its answers. The reveal policy governs what a
    // *student* may see; a teacher is not subject to it.
    paper: exam.paperSnapshot as ExamPaperSnapshot | null,
    corrections: (exam.corrections as ExamCorrection[]) ?? []
  };
}

/**
 * Saves a hand mark and recomputes the total through the one function that owns it, so
 * the automatic part and the marks cannot drift apart.
 */
export async function saveManualMarkService(
  attemptId: string,
  questionId: number,
  mark: { score: number; comment?: string },
  now = new Date()
) {
  const [attempt] = await db.select().from(schema.examAttempt).where(eq(schema.examAttempt.id, attemptId)).limit(1);
  if (!attempt) throw new AppError('Attempt not found', ErrorCodes.NOT_FOUND, 404);

  const exam = await getExamById(attempt.examId);
  const snapshot = exam?.paperSnapshot as ExamPaperSnapshot | null;
  if (!snapshot) throw new AppError('This exam has no frozen paper', ErrorCodes.VALIDATION_ERROR, 409);

  // Replaces rather than adds: marking the same question twice must not double its score.
  const marks: ManualMarks = { ...((attempt.manualScores as ManualMarks) ?? {}), [questionId]: mark };

  const graded = gradeAttempt(
    snapshot,
    (attempt.answers as StoredExamAnswer[]) ?? [],
    (exam?.corrections as ExamCorrection[]) ?? [],
    marks
  );

  const [updated] = await db
    .update(schema.examAttempt)
    .set({
      manualScores: marks,
      score: String(graded.score),
      total: String(graded.total),
      gradingState: graded.gradingState,
      updatedAt: now.toISOString()
    })
    .where(eq(schema.examAttempt.id, attemptId))
    .returning();

  return updated;
}

/**
 * Reopens an expired attempt with a fresh expiry, keeping the answers so the sitter
 * resumes rather than starting over.
 *
 * Done in one statement so the batch finaliser — which may run in the very request that
 * renders the page — cannot re-expire it the moment it is reopened. Where the paper has
 * hand-marked questions the marks are dropped back to awaiting: they were given for
 * answers the student is now free to change.
 */
export async function reopenAttemptService(attemptId: string, extraSeconds: number, now = new Date()) {
  const [reopened] = await db
    .update(schema.examAttempt)
    .set({
      status: 'in_progress',
      expiresAt: new Date(now.getTime() + extraSeconds * 1000).toISOString(),
      submittedAt: null,
      score: null,
      total: null,
      gradingState: sql`CASE WHEN ${schema.examAttempt.manualScores} = '{}'::jsonb THEN 'complete'::"EXAM_GRADING_STATE" ELSE 'awaiting_manual'::"EXAM_GRADING_STATE" END`,
      updatedAt: now.toISOString()
    })
    .where(and(eq(schema.examAttempt.id, attemptId), sql`${schema.examAttempt.status} <> 'in_progress'`))
    .returning();

  if (!reopened) throw new AppError('That attempt is already open', ErrorCodes.VALIDATION_ERROR, 409);

  return reopened;
}

/**
 * Records a correction and re-scores everything already finished. Attempts still in
 * progress are left alone on purpose: grading reads the corrections, so they pick it up
 * when they finalise.
 */
export async function addCorrectionService(examId: string, correction: ExamCorrection) {
  const exam = await getExamById(examId);
  if (!exam) throw new AppError('Exam not found', ErrorCodes.NOT_FOUND, 404);

  const corrections = [...((exam.corrections as ExamCorrection[]) ?? []), correction];

  await db
    .update(schema.exam)
    .set({ corrections, updatedAt: new Date().toISOString() })
    .where(eq(schema.exam.id, examId));

  const rescored = await rescoreFinishedAttempts(examId);

  return { corrections, rescored };
}
