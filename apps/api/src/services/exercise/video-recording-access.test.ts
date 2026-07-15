import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateVideoDownloadPresignedUrls: vi.fn(),
  getGroupMemberIdByCourseAndProfile: vi.fn(),
  getQuestionAnswersBySubmissionId: vi.fn(),
  getSubmissionById: vi.fn(),
  isCourseTeamMemberOrOrgAdmin: vi.fn(),
  resolveGroupMemberExerciseAccess: vi.fn()
}));

vi.mock('@cio/core/config/storage', () => ({
  getStorageConfig: () => ({ presignDownloadExpiresSeconds: 60, presignUploadExpiresSeconds: 60 })
}));
vi.mock('@cio/core/utils/s3', () => ({
  generateVideoDownloadPresignedUrls: mocks.generateVideoDownloadPresignedUrls,
  generateVideoUploadPresignedUrl: vi.fn()
}));
vi.mock('@cio/db/queries/assets', () => ({ createAsset: vi.fn(), getAssetById: vi.fn(), updateAsset: vi.fn() }));
vi.mock('@cio/db/queries/exercise', () => ({
  getExerciseWithRelationsOptimized: vi.fn(),
  resolveGroupMemberExerciseAccess: mocks.resolveGroupMemberExerciseAccess
}));
vi.mock('@cio/db/queries/submission', () => ({
  getQuestionAnswersBySubmissionId: mocks.getQuestionAnswersBySubmissionId,
  getSubmissionById: mocks.getSubmissionById
}));
vi.mock('@cio/db/queries/group', () => ({
  getGroupMemberIdByCourseAndProfile: mocks.getGroupMemberIdByCourseAndProfile,
  isCourseTeamMemberOrOrgAdmin: mocks.isCourseTeamMemberOrOrgAdmin
}));
vi.mock('@cio/db/queries/tag', () => ({ getCourseOrganizationId: vi.fn() }));

import { ErrorCodes } from '@api/utils/errors';
import { getVideoRecordingPlaybackUrl } from './video-recording';

describe('getVideoRecordingPlaybackUrl assignment access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSubmissionById.mockResolvedValue({
      id: 'submission-a',
      courseId: 'course-a',
      exerciseId: 'exercise-a',
      submittedBy: 'member-a'
    });
    mocks.getGroupMemberIdByCourseAndProfile.mockResolvedValue('member-a');
    mocks.isCourseTeamMemberOrOrgAdmin.mockResolvedValue(false);
  });

  it('denies a former assignee from replaying a stored answer', async () => {
    mocks.resolveGroupMemberExerciseAccess.mockResolvedValue({
      groupMemberId: 'member-a',
      roleId: 3,
      hasAccess: false
    });

    await expect(
      getVideoRecordingPlaybackUrl('course-a', 'exercise-a', 'submission-a', 1, 'profile-a')
    ).rejects.toMatchObject({ code: ErrorCodes.EXERCISE_NOT_ASSIGNED, statusCode: 403 });
    expect(mocks.generateVideoDownloadPresignedUrls).not.toHaveBeenCalled();
  });
});
