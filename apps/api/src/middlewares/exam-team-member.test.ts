import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isCourseTeamMemberOrOrgAdmin: vi.fn(),
  select: vi.fn()
}));

vi.mock('@cio/db/queries/group', () => ({
  isCourseTeamMemberOrOrgAdmin: mocks.isCourseTeamMemberOrOrgAdmin
}));
vi.mock('@cio/db/drizzle', () => ({ db: { select: mocks.select } }));
vi.mock('@cio/db/schema', () => ({
  exam: { id: 'exam.id', courseId: 'exam.courseId', organizationId: 'exam.organizationId' },
  examAttempt: { id: 'attempt.id', examId: 'attempt.examId' }
}));

import { examAttemptTeamMemberMiddleware, examTeamMemberMiddleware } from './exam-team-member';

/** Returns the rows the middleware's chained select resolves to, one call at a time. */
function rowsInOrder(...batches: unknown[][]) {
  let call = 0;
  mocks.select.mockImplementation(() => ({
    from: () => ({ where: () => ({ limit: async () => batches[call++] ?? [] }) })
  }));
}

function contextFor(params: Record<string, string>, user: { id: string } | null, orgRoles = {}) {
  const store: Record<string, unknown> = { user, orgRoles };
  let status: number | null = null;

  return {
    context: {
      get: (key: string) => store[key],
      req: { param: (name: string) => params[name], path: '/exam/test' },
      json: (_body: unknown, code: number) => {
        status = code;

        return { status: code };
      }
    } as never,
    statusOf: () => status
  };
}

describe('exam authorisation', () => {
  it('refuses a signed-in stranger from another organisation', async () => {
    // The whole point: `authMiddleware` proves only that someone is signed in, and every
    // one of these routes used to accept that alone — including the ones that delete a
    // sitting or change a mark.
    rowsInOrder([{ courseId: 'course-1', organizationId: 'org-1' }]);
    mocks.isCourseTeamMemberOrOrgAdmin.mockResolvedValue(false);
    const next = vi.fn();
    const { context, statusOf } = contextFor({ examId: 'exam-1' }, { id: 'stranger' });

    await examTeamMemberMiddleware(context, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusOf()).toBe(403);
  });

  it('lets the course team through', async () => {
    rowsInOrder([{ courseId: 'course-1', organizationId: 'org-1' }]);
    mocks.isCourseTeamMemberOrOrgAdmin.mockResolvedValue(true);
    const next = vi.fn();
    const { context } = contextFor({ examId: 'exam-1' }, { id: 'teacher' });

    await examTeamMemberMiddleware(context, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('refuses a student of the same organisation', async () => {
    // Students are organisation members too, so membership alone would hand a candidate the
    // answer key to their own paper.
    rowsInOrder([{ courseId: 'course-1', organizationId: 'org-1' }]);
    mocks.isCourseTeamMemberOrOrgAdmin.mockResolvedValue(false);
    const next = vi.fn();
    const { context, statusOf } = contextFor({ examId: 'exam-1' }, { id: 'student' }, { 'org-1': 3 });

    await examTeamMemberMiddleware(context, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusOf()).toBe(403);
  });

  it('reaches an attempt through the exam that owns it', async () => {
    rowsInOrder([{ examId: 'exam-1' }], [{ courseId: 'course-1', organizationId: 'org-1' }]);
    mocks.isCourseTeamMemberOrOrgAdmin.mockResolvedValue(true);
    const next = vi.fn();
    const { context } = contextFor({ attemptId: 'attempt-1' }, { id: 'teacher' });

    await examAttemptTeamMemberMiddleware(context, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('refuses an attempt that does not exist rather than falling through', async () => {
    rowsInOrder([]);
    const next = vi.fn();
    const { context, statusOf } = contextFor({ attemptId: 'missing' }, { id: 'teacher' });

    await examAttemptTeamMemberMiddleware(context, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusOf()).toBe(403);
  });
});
