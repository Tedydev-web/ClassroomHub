import { randomBytes } from 'node:crypto';

import { AppError, ErrorCodes } from '@api/utils/errors';
import { env } from '@cio/core/config/env';
import { db } from '@cio/db/drizzle';
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

import { assertIsContainer, freezeExamPaper, summariseContainer } from './exam-container';
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
  organizationId: string
): Promise<void> {
  if (container.courseId) {
    const owner = await getCourseWithOrgData(container.courseId);

    if (!owner || owner.orgId !== organizationId) {
      throw new AppError('That question container belongs to another organisation', ErrorCodes.FORBIDDEN, 403);
    }
  }

  const [claimed] = await db
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
  const organizationId = owner.orgId;

  const issues = validateExamSettings(input);
  if (issues.length > 0) {
    throw new AppError(issues.join('; '), ErrorCodes.VALIDATION_ERROR, 400);
  }

  const [container] = await db
    .select({ id: schema.exercise.id, courseId: schema.exercise.courseId })
    .from(schema.exercise)
    .where(eq(schema.exercise.id, input.exerciseId))
    .limit(1);

  if (!container) {
    throw new AppError('That question container does not exist', ErrorCodes.NOT_FOUND, 404);
  }

  await assertContainerBelongsToOrganization(container, organizationId);

  const [exam] = await db
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

  const merged: ExamSettingsInput = {
    exerciseId: exam.exerciseId,
    title: patch.title ?? exam.title,
    mode: patch.mode ?? exam.mode,
    workingSeconds: patch.workingSeconds !== undefined ? patch.workingSeconds : exam.workingSeconds,
    opensAt: patch.opensAt !== undefined ? patch.opensAt : exam.opensAt,
    closesAt: patch.closesAt !== undefined ? patch.closesAt : exam.closesAt,
    maxAttempts: patch.maxAttempts !== undefined ? patch.maxAttempts : exam.maxAttempts,
    requiresName: patch.requiresName ?? exam.requiresName,
    requiresClass: patch.requiresClass ?? exam.requiresClass,
    requiresCandidateNumber: patch.requiresCandidateNumber ?? exam.requiresCandidateNumber,
    scoreVisibility: patch.scoreVisibility ?? exam.scoreVisibility,
    answerVisibility: patch.answerVisibility ?? exam.answerVisibility,
    commentVisibility: patch.commentVisibility ?? exam.commentVisibility,
    revealThreshold: patch.revealThreshold !== undefined ? patch.revealThreshold : exam.revealThreshold
  };

  const issues = validateExamSettings(merged);
  if (issues.length > 0) {
    throw new AppError(issues.join('; '), ErrorCodes.VALIDATION_ERROR, 400);
  }

  const { exerciseId: _paper, ...settings } = merged;

  const updated = await updateExam(id, settings);
  if (!updated) throw new AppError('Exam not found', ErrorCodes.NOT_FOUND, 404);

  return updated;
}

export async function getExamService(id: string) {
  requireExamsEnabled();

  const exam = await getExamById(id);
  if (!exam) throw new AppError('Exam not found', ErrorCodes.NOT_FOUND, 404);

  return exam;
}

export async function getPublicExamService(slug: string) {
  requireExamsEnabled();

  const exam = await getExamBySlug(slug);
  if (!exam || exam.mode !== 'public' || exam.status !== 'open') {
    throw new AppError('Exam not found', ErrorCodes.NOT_FOUND, 404);
  }

  return exam;
}

export async function listExamsService(courseId: string) {
  requireExamsEnabled();

  return listExamsByCourseId(courseId);
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
