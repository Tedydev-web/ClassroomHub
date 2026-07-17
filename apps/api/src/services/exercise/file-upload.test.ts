import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateDocumentDownloadPresignedUrls: vi.fn(),
  getAssetById: vi.fn(),
  getDocumentObjectMetadata: vi.fn(),
  getExerciseWithRelationsOptimized: vi.fn(),
  getGroupMemberIdByCourseAndProfile: vi.fn()
}));

vi.mock('@cio/core/config/storage', () => ({
  getStorageConfig: () => ({ presignUploadExpiresSeconds: 60 })
}));
vi.mock('@cio/core/utils/s3', () => ({
  generateDocumentDownloadPresignedUrls: mocks.generateDocumentDownloadPresignedUrls,
  generateDocumentUploadPresignedUrl: vi.fn(),
  getDocumentObjectMetadata: mocks.getDocumentObjectMetadata
}));
vi.mock('@cio/db/drizzle', () => ({ db: { transaction: vi.fn() } }));
vi.mock('@cio/db/queries/assets', () => ({
  createAsset: vi.fn(),
  getAssetById: mocks.getAssetById,
  lockAssetById: vi.fn(),
  updateAsset: vi.fn()
}));
vi.mock('@cio/db/queries/exercise', () => ({
  getExerciseWithRelationsOptimized: mocks.getExerciseWithRelationsOptimized
}));
vi.mock('@cio/db/queries/group', () => ({
  getGroupMemberIdByCourseAndProfile: mocks.getGroupMemberIdByCourseAndProfile
}));
vi.mock('@cio/db/queries/tag', () => ({ getCourseOrganizationId: vi.fn(() => 'org-a') }));

import { completeExerciseFileUpload } from './file-upload';

describe('completeExerciseFileUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGroupMemberIdByCourseAndProfile.mockResolvedValue('member-a');
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: { id: 'exercise-a', courseId: 'course-a' },
      questions: [{ id: 1, questionTypeId: 8, settings: {} }]
    });
    mocks.generateDocumentDownloadPresignedUrls.mockResolvedValue({
      'exercise-files/answer.pdf': 'https://storage.test/answer.pdf'
    });
  });

  it('replays a completed file upload without reading object storage again', async () => {
    mocks.getAssetById.mockResolvedValue({
      id: 'asset-a',
      organizationId: 'org-a',
      status: 'active',
      kind: 'document',
      provider: 'upload',
      storageProvider: 's3',
      createdByProfileId: 'profile-a',
      storageKey: 'exercise-files/answer.pdf',
      title: 'answer.pdf',
      mimeType: 'application/pdf',
      byteSize: 1_024,
      metadata: {
        source: 'exercise_file_upload',
        courseId: 'course-a',
        exerciseId: 'exercise-a',
        questionId: 1,
        groupMemberId: 'member-a',
        uploadedAt: '2026-07-16T00:01:00.000Z'
      }
    });

    const answer = await completeExerciseFileUpload('course-a', 'exercise-a', 1, 'profile-a', {
      assetId: 'asset-a',
      storageKey: 'exercise-files/answer.pdf'
    });

    expect(answer).toEqual({
      type: 'FILE_UPLOAD',
      assetId: 'asset-a',
      fileKey: 'exercise-files/answer.pdf',
      fileName: 'answer.pdf',
      mimeType: 'application/pdf',
      size: 1_024,
      fileUrl: 'https://storage.test/answer.pdf'
    });
    expect(mocks.getDocumentObjectMetadata).not.toHaveBeenCalled();
    // Active-take read: archived questions must be excluded at the query level.
    expect(mocks.getExerciseWithRelationsOptimized).toHaveBeenCalledWith('exercise-a', undefined, {
      questionScope: 'active'
    });
  });
});
