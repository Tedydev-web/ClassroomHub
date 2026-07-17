import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateVideoDownloadPresignedUrls: vi.fn(),
  getAssetById: vi.fn(),
  getExerciseWithRelationsOptimized: vi.fn(),
  getGroupMemberIdByCourseAndProfile: vi.fn(),
  getVideoObjectMetadata: vi.fn(),
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
  generateVideoUploadPresignedUrl: vi.fn(),
  getVideoObjectMetadata: mocks.getVideoObjectMetadata
}));
vi.mock('@cio/db/drizzle', () => ({ db: { transaction: vi.fn() } }));
vi.mock('@cio/db/queries/assets', () => ({
  createAsset: vi.fn(),
  getAssetById: mocks.getAssetById,
  lockAssetById: vi.fn(),
  updateAsset: vi.fn()
}));
vi.mock('@cio/db/queries/exercise', () => ({
  getExerciseWithRelationsOptimized: mocks.getExerciseWithRelationsOptimized,
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
vi.mock('@cio/db/queries/tag', () => ({ getCourseOrganizationId: vi.fn(() => 'org-a') }));

import { ErrorCodes } from '@api/utils/errors';
import { completeVideoRecordingUpload, getVideoRecordingPlaybackUrl } from './video-recording';

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
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: { id: 'exercise-a', courseId: 'course-a' },
      questions: [{ id: 1, questionTypeId: 13, settings: { maxDurationSeconds: 60 } }]
    });
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

  it('rejects an unowned asset before reading an object storage key from the request', async () => {
    mocks.getAssetById.mockResolvedValue(null);

    await expect(
      completeVideoRecordingUpload('course-a', 'exercise-a', 1, 'profile-a', {
        assetId: 'asset-a',
        storageKey: 'arbitrary/object-key.webm',
        fileName: 'answer.webm',
        mimeType: 'video/webm',
        size: 1_024,
        durationSeconds: 20,
        recordedAt: '2026-07-16T00:00:00.000Z',
        retakeCount: 0
      })
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 });
    expect(mocks.getVideoObjectMetadata).not.toHaveBeenCalled();
  });

  it('replays a completed recording without reading object storage again', async () => {
    mocks.getAssetById.mockResolvedValue({
      id: 'asset-a',
      organizationId: 'org-a',
      status: 'active',
      kind: 'video',
      provider: 'upload',
      storageProvider: 's3',
      createdByProfileId: 'profile-a',
      storageKey: 'exercise-recordings/answer.webm',
      title: 'answer.webm',
      mimeType: 'video/webm',
      byteSize: 1_024,
      durationSeconds: 20,
      metadata: {
        source: 'exercise_video_recording',
        courseId: 'course-a',
        exerciseId: 'exercise-a',
        questionId: 1,
        groupMemberId: 'member-a',
        recordedAt: '2026-07-16T00:00:00.000Z',
        uploadedAt: '2026-07-16T00:01:00.000Z',
        retakeCount: 0
      }
    });

    const answer = await completeVideoRecordingUpload('course-a', 'exercise-a', 1, 'profile-a', {
      assetId: 'asset-a',
      storageKey: 'exercise-recordings/answer.webm',
      fileName: 'answer.webm',
      mimeType: 'video/webm',
      size: 1_024,
      durationSeconds: 20,
      recordedAt: '2026-07-16T00:00:00.000Z',
      retakeCount: 0
    });

    expect(answer).toMatchObject({
      assetId: 'asset-a',
      uploadedAt: '2026-07-16T00:01:00.000Z'
    });
    expect(mocks.getVideoObjectMetadata).not.toHaveBeenCalled();
    // Active-take read: archived questions must be excluded at the query level.
    expect(mocks.getExerciseWithRelationsOptimized).toHaveBeenCalledWith('exercise-a', undefined, {
      questionScope: 'active'
    });
  });
});
