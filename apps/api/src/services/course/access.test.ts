import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exerciseBelongsToCourse: vi.fn(),
  getCourseById: vi.fn(),
  getCourseProgress: vi.fn(),
  getCourseContentItems: vi.fn(),
  resolveViewerExerciseAccess: vi.fn(),
  isCourseTeamMemberOrOrgAdmin: vi.fn(),
  getLessonById: vi.fn(),
  assertStudentCanAccessContent: vi.fn()
}));

vi.mock('@cio/db/queries/course/certification-exercise', () => ({
  exerciseBelongsToCourse: mocks.exerciseBelongsToCourse
}));
vi.mock('@cio/db/queries/course/course', () => ({
  getCourseById: mocks.getCourseById,
  getCourseProgress: mocks.getCourseProgress
}));
vi.mock('@cio/db/queries/course/content', () => ({ getCourseContentItems: mocks.getCourseContentItems }));
vi.mock('@cio/db/queries/exercise', () => ({ resolveViewerExerciseAccess: mocks.resolveViewerExerciseAccess }));
vi.mock('@cio/db/queries/group', () => ({ isCourseTeamMemberOrOrgAdmin: mocks.isCourseTeamMemberOrOrgAdmin }));
vi.mock('@cio/db/queries/lesson', () => ({ getLessonById: mocks.getLessonById }));
vi.mock('@cio/core/services/course/progression', () => ({
  assertStudentCanAccessContent: mocks.assertStudentCanAccessContent
}));

import { ContentType } from '@cio/utils/constants';
import { ErrorCodes } from '@api/utils/errors';
import { assertEnrolledStudentContentAccess } from './access';

const accessParams: Parameters<typeof assertEnrolledStudentContentAccess>[0] = {
  courseId: 'course-a',
  profileId: 'profile-a',
  contentId: 'exercise-b',
  type: ContentType.Exercise
};

describe('assertEnrolledStudentContentAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a cross-course exercise before applying the team-member bypass', async () => {
    mocks.exerciseBelongsToCourse.mockResolvedValue(false);
    mocks.isCourseTeamMemberOrOrgAdmin.mockResolvedValue(true);

    await expect(assertEnrolledStudentContentAccess(accessParams)).rejects.toMatchObject({
      statusCode: 404,
      code: ErrorCodes.EXERCISE_NOT_FOUND
    });
    expect(mocks.isCourseTeamMemberOrOrgAdmin).not.toHaveBeenCalled();
  });

  it('allows a team member only after course ownership is verified', async () => {
    mocks.exerciseBelongsToCourse.mockResolvedValue(true);
    mocks.isCourseTeamMemberOrOrgAdmin.mockResolvedValue(true);

    await expect(assertEnrolledStudentContentAccess(accessParams)).resolves.toBeUndefined();
    expect(mocks.getCourseProgress).not.toHaveBeenCalled();
    expect(mocks.resolveViewerExerciseAccess).not.toHaveBeenCalled();
  });

  it('returns the assignment-specific denial for an unassigned student', async () => {
    mocks.exerciseBelongsToCourse.mockResolvedValue(true);
    mocks.isCourseTeamMemberOrOrgAdmin.mockResolvedValue(false);
    mocks.getCourseById.mockResolvedValue([{ id: accessParams.courseId, metadata: {} }]);
    mocks.getCourseProgress.mockResolvedValue({ roleId: 3 });
    mocks.getCourseContentItems.mockResolvedValue([]);
    mocks.resolveViewerExerciseAccess.mockResolvedValue({
      groupMemberId: 'member-a',
      roleId: 3,
      hasAccess: false
    });

    await expect(assertEnrolledStudentContentAccess(accessParams)).rejects.toMatchObject({
      statusCode: 403,
      code: ErrorCodes.EXERCISE_NOT_ASSIGNED
    });
  });
});
