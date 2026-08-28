import { AppError, ErrorCodes } from '@api/utils/errors';
import { db } from '@cio/db/drizzle';
import { getExamById } from '@cio/db/queries/exam/exam';
import * as schema from '@cio/db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';

import { finaliseExpiredAttempts, rescoreFinishedAttempts } from './exam-finalisation';
import {
  applyCorrections,
  gradeAttempt,
  type ExamCorrection,
  type ManualMarks,
  type StoredExamAnswer
} from './exam-grading';
import { isRevealed, type ExamRevealValue } from './exam-reveal-policy';
import { getAssessmentInteractionBlocks, type AssessmentItemDefinition } from '@cio/question-types';
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
      nickname: schema.examAttempt.nickname,
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

  const snapshot = exam.paperSnapshot as ExamPaperSnapshot | null;
  const corrections = (exam.corrections as ExamCorrection[]) ?? [];

  return {
    attempt,
    // The teacher sees the paper with its answers. The reveal policy governs what a
    // *student* may see; a teacher is not subject to it.
    //
    // Corrected before it leaves, by the same function grading uses. Handing over the raw
    // snapshot showed the teacher the key as first frozen while the score beside it came
    // from the corrected one, so a corrected answer was marked wrong on screen and right in
    // the total.
    paper: snapshot ? applyCorrections(snapshot, corrections) : null,
    // Still sent, so the page can say a key was corrected rather than silently differ from
    // what the class was originally marked against.
    corrections
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
 * Throws a sitting away so the paper can be sat again from nothing.
 *
 * Distinct from reopening, which hands back the same answers with more time. When a
 * student opened the paper by accident, or sat it as somebody else, more time on the
 * wrong paper is not the remedy — Azota separates the two for the same reason.
 *
 * A hard delete rather than a flag: the row holds a name a student typed and the answers
 * they gave, and a teacher who deletes a sitting means it to be gone. Removing the row
 * also frees the attempt against `maxAttempts`, which is the point of deleting it.
 */
export async function deleteAttemptService(attemptId: string) {
  const [deleted] = await db
    .delete(schema.examAttempt)
    .where(eq(schema.examAttempt.id, attemptId))
    .returning({ id: schema.examAttempt.id, examId: schema.examAttempt.examId });

  if (!deleted) throw new AppError('That attempt no longer exists', ErrorCodes.NOT_FOUND, 404);

  return deleted;
}

/** The choice key a question currently carries, or `null` where it has no choice part. */
function currentKeyOf(snapshot: ExamPaperSnapshot, questionId: number): string[] | null {
  const question = snapshot.questions.find((candidate) => candidate.questionId === questionId);
  if (!question) return null;

  for (const block of getAssessmentInteractionBlocks(question.definition as AssessmentItemDefinition)) {
    if (block.interaction.kind !== 'choice') continue;

    const config = block.interaction.config as { correctOptionIds?: string[] };
    return [...(config.correctOptionIds ?? [])];
  }

  return null;
}

/** How many options the question lets a candidate pick, which bounds what a key may name. */
function cardinalityOf(snapshot: ExamPaperSnapshot, questionId: number): 'single' | 'multiple' | null {
  const question = snapshot.questions.find((candidate) => candidate.questionId === questionId);
  if (!question) return null;

  for (const block of getAssessmentInteractionBlocks(question.definition as AssessmentItemDefinition)) {
    if (block.interaction.kind !== 'choice') continue;

    return (block.interaction.config as { cardinality?: 'single' | 'multiple' }).cardinality === 'multiple'
      ? 'multiple'
      : 'single';
  }

  return null;
}

/** Two keys are the same key whatever order the options were listed in. */
function sameKey(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;

  const sortedRight = [...right].sort();
  return [...left].sort().every((value, index) => value === sortedRight[index]);
}

/**
 * Records a correction and re-scores everything already finished. Attempts still in
 * progress are left alone on purpose: grading reads the corrections, so they pick it up
 * when they finalise.
 */
export async function addCorrectionService(examId: string, correction: ExamCorrection) {
  const exam = await getExamById(examId);
  if (!exam) throw new AppError('Exam not found', ErrorCodes.NOT_FOUND, 404);

  const existing = (exam.corrections as ExamCorrection[]) ?? [];

  // A key fix names the key it is replacing, and that is checked rather than filed. Two
  // teachers looking at the same question at the same time would otherwise both submit a
  // correction against the key they each read, and the second would silently overwrite the
  // first — with every finished attempt re-scored to match, and nothing on screen to say
  // it had happened.
  if (correction.kind === 'keyFix') {
    const snapshot = exam.paperSnapshot as ExamPaperSnapshot | null;
    if (!snapshot) throw new AppError('This exam has no frozen paper', ErrorCodes.VALIDATION_ERROR, 409);

    const inForce = currentKeyOf(applyCorrections(snapshot, existing), correction.questionId);

    if (inForce === null) {
      throw new AppError('That question has no answer key to correct', ErrorCodes.VALIDATION_ERROR, 400);
    }

    if (correction.correctedKey.length === 0) {
      throw new AppError('A corrected key must name at least one option', ErrorCodes.VALIDATION_ERROR, 400);
    }

    // The grader scores a choice by comparing the key against the response option for
    // option, and it requires the two to be the same size. A candidate answering a
    // single-choice question sends exactly one option, so a key naming two marks the whole
    // class wrong — the opposite of what correcting a key is for. Refused here rather than
    // stored, because by the time it is stored every finished sitting has been re-marked.
    if (cardinalityOf(snapshot, correction.questionId) === 'single' && correction.correctedKey.length !== 1) {
      throw new AppError(
        'This question lets a candidate pick one option, so its key must name exactly one',
        ErrorCodes.VALIDATION_ERROR,
        400
      );
    }

    if (!sameKey(inForce, correction.previousKey)) {
      throw new AppError(
        'The answer key changed while you were reading it. Reload and check the key before correcting it again.',
        ErrorCodes.CONFLICT,
        409
      );
    }
  }

  const corrections = [...existing, correction];

  await db
    .update(schema.exam)
    .set({ corrections, updatedAt: new Date().toISOString() })
    .where(eq(schema.exam.id, examId));

  const rescored = await rescoreFinishedAttempts(examId);

  return { corrections, rescored };
}
