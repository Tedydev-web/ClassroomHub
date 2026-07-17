import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSubmissionById: vi.fn(),
  lockCourseSubmission: vi.fn()
}));

vi.mock('@cio/db/queries/submission', () => ({
  getSubmissionById: mocks.getSubmissionById,
  lockCourseSubmission: mocks.lockCourseSubmission
}));

import { ErrorCodes } from '@api/utils/errors';
import { getCourseSubmissionOrThrow, lockCourseSubmissionOrThrow } from './submission-ownership';

describe('getCourseSubmissionOrThrow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a submission owned by the requested course', async () => {
    const submission = { id: 'submission-a', courseId: 'course-a', exerciseId: 'exercise-a' };
    mocks.getSubmissionById.mockResolvedValue(submission);

    await expect(getCourseSubmissionOrThrow('course-a', 'submission-a')).resolves.toBe(submission);
  });

  it('returns not found for a submission owned by another course', async () => {
    mocks.getSubmissionById.mockResolvedValue({
      id: 'submission-b',
      courseId: 'course-b',
      exerciseId: 'exercise-b'
    });

    await expect(getCourseSubmissionOrThrow('course-a', 'submission-b')).rejects.toMatchObject({
      code: ErrorCodes.SUBMISSION_NOT_FOUND,
      statusCode: 404
    });
  });

  it('uses the transaction-scoped lock query for grading mutations', async () => {
    const dbClient = { transaction: 'client' };
    const submission = { id: 'submission-a', courseId: 'course-a', exerciseId: 'exercise-a' };
    mocks.lockCourseSubmission.mockResolvedValue(submission);

    await expect(lockCourseSubmissionOrThrow('course-a', 'submission-a', dbClient as never)).resolves.toBe(submission);
    expect(mocks.lockCourseSubmission).toHaveBeenCalledWith('course-a', 'submission-a', dbClient);
    expect(mocks.getSubmissionById).not.toHaveBeenCalled();
  });
});
