import { randomBytes } from 'node:crypto';

import { AppError, ErrorCodes } from '@api/utils/errors';
import { env } from '@cio/core/config/env';
import { db, type DbOrTxClient } from '@cio/db/drizzle';
import { getCourseWithOrgData } from '@cio/db/queries/course';
import { examHasAttempts } from '@cio/db/queries/exam/exam-attempt';
import {
  getExamById,
  getExamBySlug,
  listExamsByCourseId,
  restoreExam,
  softDeleteExam,
  updateExam
} from '@cio/db/queries/exam/exam';
import * as schema from '@cio/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

import {
  assertIsContainer,
  copyQuestionsIntoNewContainer,
  freezeExamPaper,
  summariseContainer
} from './exam-container';
import { toExamSittingPaper, type ExamPaperSnapshot } from './exam-paper-serializer';
import { hashExamPassword } from './exam-password';
import { revealConfigurationIssue, type ExamRevealValue } from './exam-reveal-policy';

/**
 * Creating and configuring an exam. Sitting one lives in `./exam-attempt`; what a sitter
 * is served lives in `./exam-paper-serializer`.
 */

export function requireExamsEnabled(): void {
  if (env.EXAM_ENABLED !== 'true') {
    throw new AppError('Exams are disabled', ErrorCodes.NOT_FOUND, 404);
  }
}

/**
 * The link is the only gate on a public exam, so the slug is a credential: random and
 * unguessable, never derived from the title. Twenty-two characters of base64url is a
 * little over 128 bits.
 */
export function generateExamSlug(): string {
  return randomBytes(16).toString('base64url');
}

export type ExamSettingsInput = {
  title: string;
  exerciseId: string;
  mode: 'public' | 'private';
  workingSeconds: number | null;
  opensAt: string | null;
  closesAt: string | null;
  maxAttempts: number | null;
  requiresName: boolean;
  requiresClass: boolean;
  requiresCandidateNumber: boolean;
  scoreVisibility: ExamRevealValue;
  answerVisibility: ExamRevealValue;
  commentVisibility: ExamRevealValue;
  revealThreshold: string | null;
  /** Plain text, hashed here. Absent or `null` means the exam has no password. */
  password?: string | null;
  /** `null` means a candidate is never handed in for leaving the paper. */
  autoSubmitAfterLeaves: number | null;
  /** Where a candidate turns if something goes wrong mid-paper. */
  supportContact: string | null;
};

/**
 * Refuses a configuration that cannot do what it says, rather than storing it and
 * disappointing a teacher who believes they have released something.
 *
 * The pairing of `on_submit` answers with more than one permitted attempt is refused
 * outright: a sitter submits, reads the key, clears their cookie and sits again with a
 * perfect score. That is not a setting, it is a way of scoring everybody full marks.
 */
export function validateExamSettings(input: ExamSettingsInput): string[] {
  const issues: string[] = [];

  for (const [label, value] of [
    ['score', input.scoreVisibility],
    ['paper and answers', input.answerVisibility],
    ['comments', input.commentVisibility]
  ] as const) {
    const issue = revealConfigurationIssue(value, {
      closesAt: input.closesAt,
      workingSeconds: input.workingSeconds,
      revealThreshold: input.revealThreshold
    });
    if (issue) issues.push(`${issue} (${label})`);
  }

  if (input.answerVisibility === 'on_submit' && (input.maxAttempts === null || input.maxAttempts > 1)) {
    issues.push(
      'Showing the answers on submit needs the exam limited to a single attempt, or a sitter can read the answers and sit again'
    );
  }

  if (input.opensAt && input.closesAt && new Date(input.opensAt) >= new Date(input.closesAt)) {
    issues.push('The exam must open before it closes');
  }

  if (input.workingSeconds !== null && input.workingSeconds <= 0) {
    issues.push('Working time must be a positive number of seconds, or empty for no limit');
  }

  return issues;
}

/**
 * A container carries no course of its own, so it has no direct owner to compare against.
 *
 * Ownership is established by first claim: if any exam already delivers this container, it
 * must belong to the same organisation. A second organisation cannot attach itself to
 * somebody else's paper by guessing an identifier. Where the container is attached to a
 * course, that course's organisation is resolved through `getCourseWithOrgData` rather
 * than a join written here, since `course` reaches its organisation through its group.
 */
async function assertContainerBelongsToOrganization(
  container: { id: string; courseId: string | null },
  organizationId: string,
  dbClient: DbOrTxClient = db
): Promise<void> {
  if (container.courseId) {
    const owner = await getCourseWithOrgData(container.courseId);

    if (!owner || owner.orgId !== organizationId) {
      throw new AppError('That question container belongs to another organisation', ErrorCodes.FORBIDDEN, 403);
    }
  }

  const [claimed] = await dbClient
    .select({ organizationId: schema.exam.organizationId })
    .from(schema.exam)
    .where(eq(schema.exam.exerciseId, container.id))
    .limit(1);

  if (claimed && claimed.organizationId !== organizationId) {
    throw new AppError('That question container belongs to another organisation', ErrorCodes.FORBIDDEN, 403);
  }
}

/**
 * The organisation is resolved from the course rather than taken from a request header:
 * a header is supplied by the caller, and this decides who owns the exam.
 */
export async function createExamService(input: ExamSettingsInput, courseId: string, createdBy: string) {
  requireExamsEnabled();

  const owner = await getCourseWithOrgData(courseId);
  if (!owner) {
    throw new AppError('Course not found', ErrorCodes.NOT_FOUND, 404);
  }

  return createExamForOrganization(input, courseId, owner.orgId, createdBy);
}

/**
 * The exam row itself, once the course and its organisation are known.
 *
 * Separate from the service above so a caller already inside a transaction can create an
 * exam alongside the container it delivers — the importer does exactly that, and the
 * container it just inserted is invisible to any query issued on another connection.
 * Every rule stays here rather than being restated: the settings are validated, the
 * container is checked for shape and ownership, and the password is hashed.
 */
export async function createExamForOrganization(
  input: ExamSettingsInput,
  courseId: string,
  organizationId: string,
  createdBy: string,
  dbClient: DbOrTxClient = db
) {
  const issues = validateExamSettings(input);
  if (issues.length > 0) {
    throw new AppError(issues.join('; '), ErrorCodes.VALIDATION_ERROR, 400);
  }

  const [container] = await dbClient
    .select({ id: schema.exercise.id, courseId: schema.exercise.courseId })
    .from(schema.exercise)
    .where(eq(schema.exercise.id, input.exerciseId))
    .limit(1);

  if (!container) {
    throw new AppError('That question container does not exist', ErrorCodes.NOT_FOUND, 404);
  }

  await assertContainerBelongsToOrganization(container, organizationId, dbClient);

  const [exam] = await dbClient
    .insert(schema.exam)
    .values({
      organizationId,
      courseId,
      exerciseId: input.exerciseId,
      title: input.title,
      slug: generateExamSlug(),
      mode: input.mode,
      workingSeconds: input.workingSeconds,
      opensAt: input.opensAt,
      closesAt: input.closesAt,
      maxAttempts: input.maxAttempts,
      requiresName: input.requiresName,
      requiresClass: input.requiresClass,
      requiresCandidateNumber: input.requiresCandidateNumber,
      scoreVisibility: input.scoreVisibility,
      answerVisibility: input.answerVisibility,
      commentVisibility: input.commentVisibility,
      revealThreshold: input.revealThreshold,
      autoSubmitAfterLeaves: input.autoSubmitAfterLeaves,
      supportContact: input.supportContact,
      passwordHash: input.password ? await hashExamPassword(input.password) : null,
      createdBy
    })
    .returning();

  return exam;
}

/**
 * The settings a teacher may change after the exam exists. `exerciseId` is absent
 * deliberately: that field names the paper, and swapping it is not an edit, it is a
 * different exam. `slug` is absent because it is the credential on a link already handed
 * out, and `status` because opening and closing own that transition.
 */
export type ExamSettingsPatch = Partial<Omit<ExamSettingsInput, 'exerciseId'>>;

/**
 * Applies a patch to an exam's settings.
 *
 * The patch is merged onto the stored row and the whole result is validated, never the
 * submitted keys alone. The rules are cross-field — showing answers on submit is only
 * safe at one attempt, a reveal threshold needs a close time or a clock — so a patch
 * that touches one half of a pair can break an invariant it never mentions. Validating
 * the merged settings is what makes a partial update as safe as a create.
 *
 * Timing and entry fields are read once when a sitting starts and stored on the attempt,
 * so changing them here cannot move the clock or the requirements of anybody already
 * sitting. The visibility fields are different: they are read when a candidate looks at
 * their results, so changing them applies to sittings already finished. That is the
 * point of them — it is how a teacher releases results — but it is also the one edit
 * here that a candidate can notice after the fact.
 */
export async function updateExamSettingsService(id: string, patch: ExamSettingsPatch) {
  requireExamsEnabled();

  const exam = await getExamById(id);
  if (!exam) throw new AppError('Exam not found', ErrorCodes.NOT_FOUND, 404);

  const { password, ...settingsPatch } = patch;

  const merged: ExamSettingsInput = {
    exerciseId: exam.exerciseId,
    title: settingsPatch.title ?? exam.title,
    mode: settingsPatch.mode ?? exam.mode,
    workingSeconds: settingsPatch.workingSeconds !== undefined ? settingsPatch.workingSeconds : exam.workingSeconds,
    opensAt: settingsPatch.opensAt !== undefined ? settingsPatch.opensAt : exam.opensAt,
    closesAt: settingsPatch.closesAt !== undefined ? settingsPatch.closesAt : exam.closesAt,
    maxAttempts: settingsPatch.maxAttempts !== undefined ? settingsPatch.maxAttempts : exam.maxAttempts,
    requiresName: settingsPatch.requiresName ?? exam.requiresName,
    requiresClass: settingsPatch.requiresClass ?? exam.requiresClass,
    requiresCandidateNumber: settingsPatch.requiresCandidateNumber ?? exam.requiresCandidateNumber,
    scoreVisibility: settingsPatch.scoreVisibility ?? exam.scoreVisibility,
    answerVisibility: settingsPatch.answerVisibility ?? exam.answerVisibility,
    commentVisibility: settingsPatch.commentVisibility ?? exam.commentVisibility,
    revealThreshold: settingsPatch.revealThreshold !== undefined ? settingsPatch.revealThreshold : exam.revealThreshold,
    autoSubmitAfterLeaves:
      settingsPatch.autoSubmitAfterLeaves !== undefined
        ? settingsPatch.autoSubmitAfterLeaves
        : exam.autoSubmitAfterLeaves,
    supportContact: settingsPatch.supportContact !== undefined ? settingsPatch.supportContact : exam.supportContact
  };

  const issues = validateExamSettings(merged);
  if (issues.length > 0) {
    throw new AppError(issues.join('; '), ErrorCodes.VALIDATION_ERROR, 400);
  }

  const { exerciseId: _container, password: _plain, ...settings } = merged;

  const updated = await updateExam(id, {
    ...settings,
    // Only when the caller said something about it. `undefined` leaves the stored hash
    // alone; `null` is a deliberate removal.
    ...(password === undefined ? {} : { passwordHash: password === null ? null : await hashExamPassword(password) })
  });
  if (!updated) throw new AppError('Exam not found', ErrorCodes.NOT_FOUND, 404);

  // The settings back, not the row. The row carries the frozen paper with every answer
  // key on it, and none of that is what a caller asked to change.
  const { paperSnapshot: _paper, corrections: _corrections, passwordHash: _password, ...rest } = updated;

  return rest;
}

export async function getExamService(id: string) {
  requireExamsEnabled();

  const exam = await getExamById(id);
  if (!exam) throw new AppError('Exam not found', ErrorCodes.NOT_FOUND, 404);

  // Whether there is a password, never the hash. A teacher's screen needs to say the exam
  // is protected; nothing it draws needs the value that protects it.
  const { passwordHash, ...rest } = exam;

  return { ...rest, hasPassword: Boolean(passwordHash) };
}

export async function getPublicExamService(slug: string) {
  requireExamsEnabled();

  const exam = await getExamBySlug(slug);
  if (!exam || exam.mode !== 'public' || exam.status !== 'open') {
    throw new AppError('Exam not found', ErrorCodes.NOT_FOUND, 404);
  }

  return exam;
}

export async function listExamsService(courseId: string, includeDeleted = false) {
  requireExamsEnabled();

  return listExamsByCourseId(courseId, { includeDeleted });
}

/**
 * The paper as a candidate would be served it, for a teacher to read before the link goes
 * out.
 *
 * An exam that has opened is previewed from its frozen snapshot, because that is what its
 * candidates are actually sitting. One that has not is previewed by freezing the container
 * and throwing the result away — the same function `open` uses, so the preview is the
 * paper, not an approximation of it, and a teacher can see what they are about to release
 * while there is still time to change it.
 *
 * Answer keys are stripped by `toExamSittingPaper`, exactly as they are for a candidate.
 * A teacher checking their own keys has the answer-key screen for that; this one answers a
 * different question — what does this look like to sit.
 */
export async function previewExamPaperService(id: string) {
  requireExamsEnabled();

  const exam = await getExamById(id);
  if (!exam) throw new AppError('Exam not found', ErrorCodes.NOT_FOUND, 404);

  const snapshot = (exam.paperSnapshot as ExamPaperSnapshot | null) ?? (await freezeExamPaper(exam.exerciseId));

  return {
    frozen: Boolean(exam.paperSnapshot),
    paper: toExamSittingPaper(snapshot)
  };
}

/**
 * Copies an exam so the same paper can be sat again — a second sitting, a second class, a
 * resit.
 *
 * The copy gets its own questions rather than pointing at the original's container: two
 * exams sharing one container would mean editing the paper of the second rewrote what the
 * first freezes the next time it opens.
 *
 * It arrives as a draft with no paper frozen, no results, and no password. The password is
 * deliberately not carried over: the people who sat the original know it, and a copy that
 * silently inherited it would be protected in name only. The caller sends the teacher
 * straight to the copy's settings, which is where that gets set.
 */
export async function duplicateExamService(id: string, title?: string) {
  requireExamsEnabled();

  const exam = await getExamById(id);
  if (!exam) throw new AppError('Exam not found', ErrorCodes.NOT_FOUND, 404);

  const copiedTitle = title?.trim() || exam.title;
  const container = await copyQuestionsIntoNewContainer(exam.exerciseId, copiedTitle);

  const [copy] = await db
    .insert(schema.exam)
    .values({
      organizationId: exam.organizationId,
      courseId: exam.courseId,
      exerciseId: container.id,
      title: copiedTitle,
      slug: generateExamSlug(),
      mode: exam.mode,
      workingSeconds: exam.workingSeconds,
      // The window is not carried over. A second sitting happens at a different time by
      // definition, and inheriting the first one's dates would either open the copy in the
      // past or quietly schedule it against the original.
      opensAt: null,
      closesAt: null,
      maxAttempts: exam.maxAttempts,
      requiresName: exam.requiresName,
      requiresClass: exam.requiresClass,
      requiresCandidateNumber: exam.requiresCandidateNumber,
      scoreVisibility: exam.scoreVisibility,
      answerVisibility: exam.answerVisibility,
      commentVisibility: exam.commentVisibility,
      revealThreshold: exam.revealThreshold,
      createdBy: exam.createdBy
    })
    .returning({ id: schema.exam.id, title: schema.exam.title });

  return copy;
}

/**
 * Marks the exam deleted and stops. The container is never touched: another exam may
 * still deliver it, and a soft-deleted exam that could be restored must still find its
 * paper where it left it.
 */
export async function deleteExamService(id: string) {
  requireExamsEnabled();

  const deleted = await softDeleteExam(id);
  if (!deleted) throw new AppError('Exam not found', ErrorCodes.NOT_FOUND, 404);

  return deleted;
}

/**
 * Opening an exam is the moment its paper stops moving. The frozen snapshot is written
 * here and nowhere else, and the exam cannot leave `draft` without one — every later
 * guarantee about what a sitter sees, which revision an answer is pinned to, and what
 * grading reads, rests on it existing.
 */
export async function openExamService(id: string) {
  requireExamsEnabled();

  const exam = await getExamById(id);
  if (!exam) throw new AppError('Exam not found', ErrorCodes.NOT_FOUND, 404);

  if (exam.status === 'open') return exam;

  // Re-opening a closed exam must not replace a paper somebody has already been marked
  // against. Editing the container between a close and a re-open used to swap the
  // snapshot out from under the attempts already scored, leaving one exam holding
  // attempts whose totals came from different papers. Once anybody has sat it, the paper
  // it was sat on is the paper it keeps; a new paper needs a new exam.
  const reuseSnapshot = Boolean(exam.paperSnapshot) && (await examHasAttempts(id));

  let paperSnapshot = exam.paperSnapshot;
  if (!reuseSnapshot) {
    await assertIsContainer(exam.exerciseId);
    paperSnapshot = await freezeExamPaper(exam.exerciseId);
  }

  const [opened] = await db
    .update(schema.exam)
    .set({ status: 'open', paperSnapshot, updatedAt: new Date().toISOString() })
    .where(eq(schema.exam.id, id))
    .returning();

  return opened;
}

/**
 * Closing stops new sitters. It deliberately leaves attempts already in progress alone:
 * their own clocks decide when they end, and cutting them off mid-answer would lose work
 * the server has already accepted.
 */
export async function closeExamService(id: string) {
  requireExamsEnabled();

  const [closed] = await db
    .update(schema.exam)
    .set({ status: 'closed', updatedAt: new Date().toISOString() })
    .where(and(eq(schema.exam.id, id), isNull(schema.exam.deletedAt)))
    .returning();

  if (!closed) throw new AppError('Exam not found', ErrorCodes.NOT_FOUND, 404);

  return closed;
}

export async function restoreExamService(id: string) {
  requireExamsEnabled();

  const restored = await restoreExam(id);
  if (!restored) throw new AppError('Exam not found', ErrorCodes.NOT_FOUND, 404);

  return restored;
}

/** What the teacher is shown before sending the link. Reports; refuses nothing. */
export async function summariseExamPaperService(id: string) {
  requireExamsEnabled();

  const exam = await getExamById(id);
  if (!exam) throw new AppError('Exam not found', ErrorCodes.NOT_FOUND, 404);

  return summariseContainer(exam.exerciseId);
}
