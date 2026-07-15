import { GetObjectCommand, NoSuchKey } from '@aws-sdk/client-s3';
import path from 'node:path';

import { AppError, ErrorCodes } from '@api/utils/errors';
import { getScormLessonContentForCourse } from '@cio/db/queries/scorm';
import { getS3Client, getStorageConfig } from '@cio/core/config/storage';

function safeAssetPath(assetPath: string): string {
  const normalized = path.posix.normalize(assetPath).replace(/^\.\//, '');
  if (
    !normalized ||
    assetPath.includes('\\') ||
    normalized.startsWith('/') ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new AppError(new Error('Invalid SCORM asset path'), ErrorCodes.VALIDATION_ERROR, 400);
  }

  return normalized;
}

export async function getScormLessonAsset(courseId: string, lessonId: string, assetPath: string, range?: string) {
  const content = await getScormLessonContentForCourse(courseId, lessonId);
  if (!content) throw new AppError(new Error('SCORM lesson not found'), ErrorCodes.NOT_FOUND, 404);

  const normalizedPath = safeAssetPath(assetPath);
  const config = getStorageConfig();
  try {
    const object = await getS3Client().send(
      new GetObjectCommand({
        Bucket: config.bucketDocuments,
        Key: `scorm/${content.content.organizationId}/${content.content.packageId}/${normalizedPath}`,
        Range: range
      })
    );
    if (!object.Body) throw new Error('SCORM asset has no body');

    return {
      body: object.Body.transformToWebStream(),
      contentLength: object.ContentLength,
      contentRange: object.ContentRange,
      contentType: object.ContentType ?? 'application/octet-stream',
      status: object.ContentRange ? 206 : 200
    } as const;
  } catch (error) {
    if (error instanceof NoSuchKey || (error instanceof Error && error.name === 'NoSuchKey')) {
      throw new AppError(new Error('SCORM asset not found'), ErrorCodes.NOT_FOUND, 404);
    }
    throw error;
  }
}
