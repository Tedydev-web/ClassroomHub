import { randomUUID } from 'node:crypto';

import { AppError, ErrorCodes } from '@api/utils/errors';
import { getStorageConfig } from '@cio/core/config/storage';
import { getUploadLimits } from '@cio/core/config/upload-limits';
import {
  generateDocumentDownloadPresignedUrls,
  generateDocumentUploadPresignedUrl,
  getDocumentObjectMetadata
} from '@cio/core/utils/s3';
import { db, type DbOrTxClient } from '@cio/db/drizzle';
import { createAsset, getAssetById, lockAssetById, updateAsset } from '@cio/db/queries/assets';
import { getExerciseWithRelationsOptimized } from '@cio/db/queries/exercise';
import { getGroupMemberIdByCourseAndProfile } from '@cio/db/queries/group';
import { getCourseOrganizationId as getCourseOrganizationIdFromDb } from '@cio/db/queries/tag';
import {
  QUESTION_TYPE_IDS,
  getFileUploadExtension,
  isRecord,
  isFileUploadSizeAllowed,
  resolveAllowedFileUploadMimeTypes,
  resolveCanonicalFileUploadMimeType,
  type FileUploadAnswerData,
  type FileUploadMimeType
} from '@cio/question-types';
import type { TExerciseFileUploadComplete, TExerciseFileUploadInit } from '@cio/utils/validation/exercise';
import { hasExerciseAnswerAssetOwnership } from './exercise-answer-asset-ownership';

type FileUploadContext = {
  organizationId: string;
  groupMemberId: string;
  allowedMimeTypes: readonly FileUploadMimeType[];
  questionMaxSizeMb: number | null;
};

type FileUploadAsset = NonNullable<Awaited<ReturnType<typeof getAssetById>>>;
type ValidFileUploadAsset = FileUploadAsset & {
  storageKey: string;
  title: string;
  mimeType: string;
  byteSize: number;
};

async function getCourseOrganizationIdResolved(courseId: string): Promise<string> {
  const organizationId = await getCourseOrganizationIdFromDb(courseId);
  if (!organizationId) {
    throw new AppError('Course organization not found', ErrorCodes.NOT_FOUND, 404);
  }

  return organizationId;
}

function readPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

async function getFileUploadContext(
  courseId: string,
  exerciseId: string,
  questionId: number,
  profileId: string
): Promise<FileUploadContext> {
  const [organizationId, groupMemberId, exerciseWithRelations] = await Promise.all([
    getCourseOrganizationIdResolved(courseId),
    getGroupMemberIdByCourseAndProfile(courseId, profileId),
    // Active-take read: archived questions must not accept new uploads.
    getExerciseWithRelationsOptimized(exerciseId, undefined, { questionScope: 'active' })
  ]);

  if (!groupMemberId) {
    throw new AppError('User is not a member of this course', ErrorCodes.UNAUTHORIZED, 403);
  }
  if (exerciseWithRelations.exercise.courseId !== courseId) {
    throw new AppError('Exercise not found', ErrorCodes.EXERCISE_NOT_FOUND, 404);
  }

  const question = exerciseWithRelations.questions.find((item) => item.id === questionId);
  if (!question) {
    throw new AppError('Question not found for this exercise', ErrorCodes.NOT_FOUND, 404);
  }
  if (question.questionTypeId !== QUESTION_TYPE_IDS.FILE_UPLOAD) {
    throw new AppError('Question is not a file upload question', ErrorCodes.VALIDATION_ERROR, 400);
  }

  const settings =
    question.settings && typeof question.settings === 'object' && !Array.isArray(question.settings)
      ? (question.settings as Record<string, unknown>)
      : {};

  return {
    organizationId,
    groupMemberId,
    allowedMimeTypes: resolveAllowedFileUploadMimeTypes(settings.acceptedTypes),
    questionMaxSizeMb: readPositiveNumber(settings.maxSizeMb)
  };
}

function assertFileUploadAsset(
  asset: FileUploadAsset | null,
  input: {
    organizationId: string;
    courseId: string;
    exerciseId: string;
    questionId: number;
    groupMemberId: string;
    profileId: string;
    storageKey: string;
  }
): asserts asset is ValidFileUploadAsset {
  if (
    !asset ||
    (asset.status !== 'pending' && asset.status !== 'active') ||
    asset.kind !== 'document' ||
    asset.provider !== 'upload' ||
    asset.storageProvider !== 's3' ||
    asset.organizationId !== input.organizationId ||
    asset.createdByProfileId !== input.profileId ||
    asset.storageKey !== input.storageKey ||
    !asset.title ||
    !asset.mimeType ||
    !asset.byteSize ||
    !hasExerciseAnswerAssetOwnership(asset.metadata, {
      source: 'exercise_file_upload',
      courseId: input.courseId,
      exerciseId: input.exerciseId,
      questionId: input.questionId,
      groupMemberId: input.groupMemberId
    })
  ) {
    throw new AppError('File upload asset is invalid', ErrorCodes.VALIDATION_ERROR, 400);
  }
}

function assertCompletedFileUploadAsset(asset: ValidFileUploadAsset): void {
  const metadata = isRecord(asset.metadata) ? asset.metadata : {};
  const uploadedAt = metadata.uploadedAt;
  if (asset.status !== 'active' || typeof uploadedAt !== 'string' || !Number.isFinite(Date.parse(uploadedAt))) {
    throw new AppError('Completed file upload metadata is invalid', ErrorCodes.VALIDATION_ERROR, 400);
  }
}

export async function initExerciseFileUpload(
  courseId: string,
  exerciseId: string,
  questionId: number,
  profileId: string,
  input: TExerciseFileUploadInit
) {
  const context = await getFileUploadContext(courseId, exerciseId, questionId, profileId);
  const canonicalMimeType = resolveCanonicalFileUploadMimeType({
    fileName: input.fileName,
    mimeType: input.mimeType
  });
  if (!canonicalMimeType || !context.allowedMimeTypes.includes(canonicalMimeType)) {
    throw new AppError('File type is not allowed for this question', ErrorCodes.VALIDATION_ERROR, 400);
  }

  const uploadLimits = getUploadLimits();
  if (!isFileUploadSizeAllowed(input.size, context.questionMaxSizeMb, uploadLimits.exerciseFileMb)) {
    throw new AppError('File exceeds the upload size limit', ErrorCodes.VALIDATION_ERROR, 400);
  }

  const extension = getFileUploadExtension(canonicalMimeType);
  const storageKey = [
    'exercise-files',
    context.organizationId,
    courseId,
    exerciseId,
    String(questionId),
    context.groupMemberId,
    `${randomUUID()}.${extension}`
  ].join('/');
  const asset = await createAsset({
    organizationId: context.organizationId,
    kind: 'document',
    provider: 'upload',
    storageProvider: 's3',
    storageKey,
    mimeType: canonicalMimeType,
    byteSize: input.size,
    title: input.fileName,
    status: 'pending',
    metadata: {
      source: 'exercise_file_upload',
      courseId,
      exerciseId,
      questionId,
      groupMemberId: context.groupMemberId
    },
    createdByProfileId: profileId
  });
  const uploadUrl = await generateDocumentUploadPresignedUrl(storageKey, canonicalMimeType);
  const expiresAt = new Date(Date.now() + getStorageConfig().presignUploadExpiresSeconds * 1000).toISOString();

  return {
    assetId: asset.id,
    uploadUrl,
    storageKey,
    expiresAt
  };
}

export async function completeExerciseFileUpload(
  courseId: string,
  exerciseId: string,
  questionId: number,
  profileId: string,
  input: TExerciseFileUploadComplete
): Promise<FileUploadAnswerData> {
  const context = await getFileUploadContext(courseId, exerciseId, questionId, profileId);
  const candidateAsset = await getAssetById(input.assetId, context.organizationId);
  assertFileUploadAsset(candidateAsset, {
    organizationId: context.organizationId,
    courseId,
    exerciseId,
    questionId,
    groupMemberId: context.groupMemberId,
    profileId,
    storageKey: input.storageKey
  });

  if (candidateAsset.status === 'active') {
    assertCompletedFileUploadAsset(candidateAsset);
    const downloadUrls = await generateDocumentDownloadPresignedUrls([input.storageKey]);

    return {
      type: 'FILE_UPLOAD',
      assetId: candidateAsset.id,
      fileKey: input.storageKey,
      fileName: candidateAsset.title,
      mimeType: candidateAsset.mimeType,
      size: candidateAsset.byteSize,
      fileUrl: downloadUrls[input.storageKey]
    };
  }

  const objectMetadata = await getDocumentObjectMetadata(input.storageKey);
  const objectMimeType = resolveCanonicalFileUploadMimeType({
    fileName: candidateAsset.title,
    mimeType: objectMetadata.contentType ?? ''
  });
  if (objectMetadata.contentLength !== candidateAsset.byteSize || objectMimeType !== candidateAsset.mimeType) {
    throw new AppError('Uploaded file metadata does not match the initialized asset', ErrorCodes.VALIDATION_ERROR, 400);
  }

  const uploadedAt = new Date().toISOString();
  const activeAsset = await db.transaction(async (tx) => {
    const txClient = tx as DbOrTxClient;
    const lockedAsset = await lockAssetById(input.assetId, context.organizationId, txClient);
    assertFileUploadAsset(lockedAsset, {
      organizationId: context.organizationId,
      courseId,
      exerciseId,
      questionId,
      groupMemberId: context.groupMemberId,
      profileId,
      storageKey: input.storageKey
    });

    if (lockedAsset.status === 'active') {
      assertCompletedFileUploadAsset(lockedAsset);
      return lockedAsset;
    }

    const updatedAsset = await updateAsset(
      input.assetId,
      context.organizationId,
      {
        status: 'active',
        metadata: {
          ...(lockedAsset.metadata && typeof lockedAsset.metadata === 'object' && !Array.isArray(lockedAsset.metadata)
            ? lockedAsset.metadata
            : {}),
          uploadedAt
        }
      },
      txClient
    );
    if (!updatedAsset) {
      throw new AppError('Failed to activate uploaded file', ErrorCodes.INTERNAL_ERROR, 500);
    }

    return updatedAsset;
  });
  const downloadUrls = await generateDocumentDownloadPresignedUrls([input.storageKey]);

  return {
    type: 'FILE_UPLOAD',
    assetId: activeAsset.id,
    fileKey: input.storageKey,
    fileName: candidateAsset.title,
    mimeType: candidateAsset.mimeType,
    size: candidateAsset.byteSize,
    fileUrl: downloadUrls[input.storageKey]
  };
}
