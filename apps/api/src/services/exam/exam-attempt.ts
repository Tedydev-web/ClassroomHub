import { createHash, randomBytes } from 'node:crypto';

import { AppError, ErrorCodes } from '@api/utils/errors';
import { db } from '@cio/db/drizzle';
import * as schema from '@cio/db/schema';
import { and, eq, sql } from 'drizzle-orm';

import { canStartNow, computeExpiry, isWithinWritingWindow, secondsRemaining } from './exam-attempt-clock';
import { getAttemptByToken } from '@cio/db/queries/exam/exam-attempt';
import {
  paperQuestionIds,
  revisionForQuestion,
  toExamSittingPaper,
  type ExamPaperSnapshot
} from './exam-paper-serializer';

/**
 * Sitting an exam: starting, saving, submitting.
 *
 * Two rules here are not preferences.
 *
 * The server assigns the revision each answer was given against, taken from the frozen
 * paper. A client that supplies its own revision picks which answer key it is marked
 * against, which is worth doing precisely when a teacher has corrected a wrong key.
 *
 * Answers merge rather than replace, under a row lock. Replacing is the obvious
 * implementation and it destroys work whenever a save carries a partial payload — which
 * is what an autosave is — and the symptom is invisible until a student says their
 * answers vanished.
 */

export const RESUME_COOKIE_PREFIX = 'cio_exam';

/** The cookie is scoped per exam, so sitting two papers does not overwrite one attempt. */
export function resumeCookieName(examId: string): string {
  return `${RESUME_COOKIE_PREFIX}_${examId.replace(/-/g, '')}`;
}

export function issueResumeToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashResumeToken(raw) };
}

export function hashResumeToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export type DeclaredIdentity = {
  displayName?: string | null;
  className?: string | null;
  candidateNumber?: string | null;
};

const MAX_DECLARED_LENGTH = 120;
const MAX_ANSWERS = 500;

/**
 * Validation belongs here, at the trust boundary, rather than in a later hardening pass.
 * An invalid answer stored now becomes an attempt that can never be scored, failing every
 * read of the results page from then on.
 */
export function validateDeclaredIdentity(
  identity: DeclaredIdentity,
  requires: { name: boolean; className: boolean; candidateNumber: boolean }
): string[] {
  const issues: string[] = [];

  const fields: Array<[keyof DeclaredIdentity, boolean, string]> = [
    ['displayName', requires.name, 'name'],
    ['className', requires.className, 'class'],
    ['candidateNumber', requires.candidateNumber, 'candidate number']
  ];

  for (const [key, required, label] of fields) {
    const value = identity[key];

    if (required && (!value || value.trim().length === 0)) {
      issues.push(`Your ${label} is required`);
      continue;
    }

    if (value && value.length > MAX_DECLARED_LENGTH) {
      issues.push(`That ${label} is too long`);
    }
  }

  return issues;
}

export type AnswerPayload = { questionId: number; answerData: unknown };

/**
 * Refuses anything the frozen paper does not contain. Phase 4's normaliser raises on an
 * answer to a question outside the paper, so letting one through here would create an
 * attempt that poisons every later read.
 */
export function validateAnswers(answers: AnswerPayload[], snapshot: ExamPaperSnapshot): string[] {
  if (answers.length > MAX_ANSWERS) return ['That is more answers than this paper has questions'];

  const allowed = paperQuestionIds(snapshot);
  const unknown = answers.filter((answer) => !allowed.has(answer.questionId)).map((answer) => answer.questionId);

  return unknown.length > 0 ? [`Those questions are not in this paper: ${unknown.join(', ')}`] : [];
}

type StoredAnswer = { questionId: number; questionRevisionId: string; answerData: unknown };

/**
 * Merges by question, so a save carrying only the question just answered does not erase
 * the rest. The revision comes from the frozen paper, never from the request.
 */
export function mergeAnswers(
  existing: StoredAnswer[],
  incoming: AnswerPayload[],
  snapshot: ExamPaperSnapshot
): StoredAnswer[] {
  const byQuestion = new Map(existing.map((answer) => [answer.questionId, answer]));

  for (const answer of incoming) {
    const questionRevisionId = revisionForQuestion(snapshot, answer.questionId);
    if (!questionRevisionId) continue;

    byQuestion.set(answer.questionId, {
      questionId: answer.questionId,
      questionRevisionId,
      answerData: answer.answerData
    });
  }

  return [...byQuestion.values()];
}

export type StartAttemptInput = {
  exam: typeof schema.exam.$inferSelect;
  identity: DeclaredIdentity;
  profileId: string | null;
  password: string | null;
  ipHash: string | null;
  userAgent: string | null;
  now: Date;
};

export async function startAttemptService(input: StartAttemptInput) {
  const { exam, identity, profileId, now } = input;

  if (
    !canStartNow(
      {
        opensAt: exam.opensAt ? new Date(exam.opensAt) : null,
        closesAt: exam.closesAt ? new Date(exam.closesAt) : null
      },
      now
    )
  ) {
    throw new AppError('This exam is not open', ErrorCodes.VALIDATION_ERROR, 403);
  }

  if (exam.mode === 'public') {
    const issues = validateDeclaredIdentity(identity, {
      name: exam.requiresName,
      className: exam.requiresClass,
      candidateNumber: exam.requiresCandidateNumber
    });

    if (issues.length > 0) {
      throw new AppError(issues.join('; '), ErrorCodes.VALIDATION_ERROR, 400);
    }
  }

  const snapshot = exam.paperSnapshot as ExamPaperSnapshot | null;
  if (!snapshot) {
    throw new AppError('This exam has no frozen paper', ErrorCodes.VALIDATION_ERROR, 409);
  }

  const token = issueResumeToken();
  const expiresAt = computeExpiry({
    startedAt: now,
    workingSeconds: exam.workingSeconds,
    closesAt: exam.closesAt ? new Date(exam.closesAt) : null
  });

  const [attempt] = await db
    .insert(schema.examAttempt)
    .values({
      examId: exam.id,
      profileId,
      displayName: identity.displayName?.trim() ?? null,
      className: identity.className?.trim() ?? null,
      candidateNumber: identity.candidateNumber?.trim() ?? null,
      tokenHash: token.hash,
      startedAt: now.toISOString(),
      expiresAt: expiresAt?.toISOString() ?? null,
      ipHash: input.ipHash,
      userAgent: input.userAgent
    })
    .returning();

  return {
    attempt,
    resumeToken: token.raw,
    paper: toExamSittingPaper(snapshot),
    secondsRemaining: secondsRemaining(expiresAt, now)
  };
}

/**
 * Saves under a row lock, so two overlapping saves cannot lose one another — and phase 5
 * creates overlapping saves by design, pairing a debounced save with an interval save and
 * a retry.
 */
export async function saveAnswersService(attemptId: string, incoming: AnswerPayload[], now: Date) {
  return db.transaction(async (tx) => {
    const [attempt] = await tx
      .select()
      .from(schema.examAttempt)
      .where(eq(schema.examAttempt.id, attemptId))
      .limit(1)
      .for('update');

    if (!attempt) throw new AppError('Attempt not found', ErrorCodes.NOT_FOUND, 404);
    if (attempt.status !== 'in_progress') {
      throw new AppError('This attempt is already finished', ErrorCodes.VALIDATION_ERROR, 409);
    }

    const expiresAt = attempt.expiresAt ? new Date(attempt.expiresAt) : null;
    if (!isWithinWritingWindow(expiresAt, now)) {
      throw new AppError('Your time is up', ErrorCodes.VALIDATION_ERROR, 410);
    }

    const [exam] = await tx.select().from(schema.exam).where(eq(schema.exam.id, attempt.examId)).limit(1);
    const snapshot = exam?.paperSnapshot as ExamPaperSnapshot | null;
    if (!snapshot) throw new AppError('This exam has no frozen paper', ErrorCodes.VALIDATION_ERROR, 409);

    const issues = validateAnswers(incoming, snapshot);
    if (issues.length > 0) throw new AppError(issues.join('; '), ErrorCodes.VALIDATION_ERROR, 400);

    const merged = mergeAnswers((attempt.answers as StoredAnswer[]) ?? [], incoming, snapshot);
    const appended = [
      ...((attempt.answerLog as unknown[]) ?? []),
      ...incoming.map((answer) => ({ at: now.toISOString(), ...answer }))
    ];

    await tx
      .update(schema.examAttempt)
      .set({ answers: merged, answerLog: appended, updatedAt: now.toISOString() })
      .where(eq(schema.examAttempt.id, attemptId));

    return { saved: incoming.length, secondsRemaining: secondsRemaining(expiresAt, now) };
  });
}

export async function submitAttemptService(attemptId: string, now: Date) {
  const [attempt] = await db
    .update(schema.examAttempt)
    .set({ status: 'submitted', submittedAt: now.toISOString(), updatedAt: now.toISOString() })
    .where(and(eq(schema.examAttempt.id, attemptId), eq(schema.examAttempt.status, 'in_progress')))
    .returning();

  if (!attempt) {
    throw new AppError('This attempt is already finished', ErrorCodes.VALIDATION_ERROR, 409);
  }

  return attempt;
}

/** Counted per cookie, so it is an honest limit rather than an enforced one. */
export async function countAttemptsForToken(examId: string, tokenHash: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.examAttempt)
    .where(and(eq(schema.examAttempt.examId, examId), eq(schema.examAttempt.tokenHash, tokenHash)));

  return row?.count ?? 0;
}

/**
 * The live attempt this browser already has, if any.
 *
 * Resume is by cookie, not by name: two sitters typing the same name get separate
 * attempts, and the same sitter refreshing gets theirs back with the time already spent
 * gone. Without this a refresh silently starts a second attempt on a fresh clock, which
 * is both a lost paper and a way to get more time.
 */
export async function resumeAttemptService(examId: string, rawToken: string, now: Date) {
  const attempt = await getAttemptByToken(examId, hashResumeToken(rawToken));
  if (!attempt || attempt.status !== 'in_progress') return null;

  const expiresAt = attempt.expiresAt ? new Date(attempt.expiresAt) : null;

  return {
    attempt,
    expiresAt,
    secondsRemaining: secondsRemaining(expiresAt, now),
    // Whether writes are still accepted. An attempt whose clock ran out is resumable only
    // in the sense that the sitter can see it finished; phase 4 will score it on read.
    writable: isWithinWritingWindow(expiresAt, now)
  };
}
