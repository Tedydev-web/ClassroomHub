import { Context, Next } from 'hono';

import { db } from '@cio/db/drizzle';
import { isCourseTeamMemberOrOrgAdmin } from '@cio/db/queries/group';
import * as schema from '@cio/db/schema';
import { ROLE } from '@cio/utils/constants/roles';
import { eq } from 'drizzle-orm';

import { ErrorCodes } from '@api/utils/errors';

/**
 * Who may act on an exam, its results, and the sittings under it.
 *
 * `authMiddleware` proves only that a session exists. Every route reached by an exam id or
 * an attempt id was guarded by that alone, so any signed-in account of any organization
 * could read another school's paper with its answer key, read a candidate's name and
 * answers, and — worse — delete a sitting, reopen it, change a mark, or correct the key for
 * a whole class.
 *
 * Organization membership is not the bar. Students are organization members too
 * (`roleId: ROLE.STUDENT`), so requiring membership alone would hand a candidate the answer
 * key to their own paper. The bar is the one the create and list routes already use: a team
 * member of the exam's course, or an organization admin. Anyone who can reach these screens
 * has already passed exactly that check on the way in.
 */
async function isExamTeamMember(context: Context, examId: string): Promise<boolean> {
  const user = context.get('user');
  if (!user) return false;

  // Deliberately not `getExamById`, which hides soft-deleted rows. `POST /:examId/restore`
  // exists to bring one of those back, and a guard that cannot see it would refuse the one
  // route that needs it.
  const [exam] = await db
    .select({ courseId: schema.exam.courseId, organizationId: schema.exam.organizationId })
    .from(schema.exam)
    .where(eq(schema.exam.id, examId))
    .limit(1);
  if (!exam) return false;

  if (exam.courseId) return isCourseTeamMemberOrOrgAdmin(exam.courseId, user.id);

  // The schema allows an exam with no course so a standalone paper stays possible. Nothing
  // creates one today — `createExamService` always writes a course — so this branch is
  // unreachable until that feature lands. When it does, note that `orgRoles` comes from the
  // session's cached roles, so an account promoted to admin can be refused here until its
  // session refreshes. Fail-closed either way.
  const orgRoles = (context.get('orgRoles') as Record<string, number> | undefined) ?? {};

  return orgRoles[exam.organizationId] === ROLE.ADMIN;
}

function deny(context: Context) {
  return context.json({ success: false, error: 'Unauthorized', code: ErrorCodes.UNAUTHORIZED }, 403);
}

/** Guards a route addressed by `:examId`. */
export const examTeamMemberMiddleware = async (c: Context, next: Next) => {
  const examId = c.req.param('examId');
  if (!examId) {
    return c.json({ success: false, error: 'Exam ID is required', code: 'EXAM_ID_REQUIRED' }, 400);
  }

  try {
    if (await isExamTeamMember(c, examId)) return next();
  } catch (error) {
    console.error('examTeamMemberMiddleware failed:', error);

    return deny(c);
  }

  // Logged because this is a new gate on routes that had none. If a teacher is refused
  // where they should not be, this line names who, which exam, and which route.
  console.error('examTeamMemberMiddleware denied', {
    userId: c.get('user')?.id ?? null,
    examId,
    path: c.req.path
  });

  return deny(c);
};

/** Guards a route addressed by `:attemptId`, through the exam that owns the sitting. */
export const examAttemptTeamMemberMiddleware = async (c: Context, next: Next) => {
  const attemptId = c.req.param('attemptId');
  if (!attemptId) {
    return c.json({ success: false, error: 'Attempt ID is required', code: 'ATTEMPT_ID_REQUIRED' }, 400);
  }

  try {
    const [attempt] = await db
      .select({ examId: schema.examAttempt.examId })
      .from(schema.examAttempt)
      .where(eq(schema.examAttempt.id, attemptId))
      .limit(1);

    if (attempt && (await isExamTeamMember(c, attempt.examId))) return next();
  } catch (error) {
    console.error('examAttemptTeamMemberMiddleware failed:', error);

    return deny(c);
  }

  console.error('examAttemptTeamMemberMiddleware denied', {
    userId: c.get('user')?.id ?? null,
    attemptId,
    path: c.req.path
  });

  return deny(c);
};
