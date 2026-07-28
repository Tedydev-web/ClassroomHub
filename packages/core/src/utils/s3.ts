import {
  DeleteObjectCommand,
  DeleteObjectCommandInput,
  GetObjectCommand,
  GetObjectCommandInput,
  HeadObjectCommand,
  PutObjectCommand,
  PutObjectCommandInput
} from '@aws-sdk/client-s3';

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getPresignS3Client, getS3Client, getStorageConfig } from '../config/storage';
import { logRedisUnavailableOnce, redis } from './redis/redis';

export type GetSignedUrlParameters = Parameters<typeof getSignedUrl>;

const PRESIGN_CACHE_TTL_SECONDS = 3000; // 50 min; presigned URLs typically valid 1 hour
const PRESIGN_CACHE_KEY_PREFIX = 'presign:download:';

export class S3ObjectSizeLimitExceededError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Object exceeds the ${maxBytes}-byte read limit`);
    this.name = 'S3ObjectSizeLimitExceededError';
  }
}

async function readObjectBytesBounded(bucket: string, key: string, maxBytes: number): Promise<Uint8Array> {
  const response = await getS3Client().send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: `bytes=0-${maxBytes}`
    })
  );
  if (!response.Body) {
    throw new Error(`S3 object ${bucket}/${key} returned no body`);
  }

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    byteLength += chunk.byteLength;
    if (byteLength > maxBytes) {
      throw new S3ObjectSizeLimitExceededError(maxBytes);
    }

    chunks.push(chunk);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

export async function readDocumentObjectBytes(fileKey: string, maxBytes: number): Promise<Uint8Array> {
  const config = getStorageConfig();

  return readObjectBytesBounded(config.bucketDocuments, fileKey, maxBytes);
}

export async function uploadToS3(params: PutObjectCommandInput): Promise<{ success: boolean; error?: string }> {
  try {
    await getS3Client().send(new PutObjectCommand(params));
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function getFromS3(
  params: GetObjectCommandInput
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const data = await getS3Client().send(new GetObjectCommand(params));
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function deleteFromS3(params: DeleteObjectCommandInput): Promise<{ success: boolean; error?: string }> {
  try {
    await getS3Client().send(new DeleteObjectCommand(params));
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Generates presigned URLs for download for a list of keys in a specific bucket.
 * Uses Redis cache to avoid repeated S3 getSignedUrl calls for the same file.
 * @param keys Array of S3 keys
 * @param bucketName Bucket name (e.g., 'videos', 'documents')
 * @returns Record mapping keys to presigned URLs
 */
export async function generateDownloadPresignedUrls(
  keys: string[],
  bucketName: string
): Promise<Record<string, string>> {
  const signedUrls: Record<string, string> = {};
  const config = getStorageConfig();
  const client = getPresignS3Client();

  if (keys.length === 0) {
    return signedUrls;
  }

  const cacheKeys = keys.map((key) => `${PRESIGN_CACHE_KEY_PREFIX}${bucketName}:${key}`);

  let cachedValues: (string | null)[] | null = null;
  try {
    cachedValues = await redis.mGet(cacheKeys);
  } catch (error) {
    logRedisUnavailableOnce('Redis cache unavailable for presigned URLs, falling back to S3', error);
  }

  const keysToGenerate: string[] = [];
  if (cachedValues) {
    cachedValues.forEach((val, i) => {
      if (val) {
        signedUrls[keys[i]] = val;
      } else {
        keysToGenerate.push(keys[i]);
      }
    });
  } else {
    keysToGenerate.push(...keys);
  }

  if (keysToGenerate.length === 0) {
    return signedUrls;
  }

  const urlPromises = keysToGenerate.map(async (key) => {
    try {
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key
      }) as GetSignedUrlParameters[1];

      const presignedUrl = await getSignedUrl(client as GetSignedUrlParameters[0], command, {
        expiresIn: config.presignDownloadExpiresSeconds
      });

      return { key, presignedUrl };
    } catch (error) {
      console.error(`Failed to generate presigned URL for key "${key}" in bucket "${bucketName}":`, error);
      return null;
    }
  });

  const results = await Promise.all(urlPromises);

  try {
    const pipeline = redis.multi();
    results.forEach((result) => {
      if (result) {
        signedUrls[result.key] = result.presignedUrl;
        const cacheKey = `${PRESIGN_CACHE_KEY_PREFIX}${bucketName}:${result.key}`;
        pipeline.setEx(cacheKey, PRESIGN_CACHE_TTL_SECONDS, result.presignedUrl);
      }
    });
    await pipeline.exec();
  } catch (error) {
    logRedisUnavailableOnce('Redis cache write unavailable for presigned URLs, continuing without cache', error);
    // URLs are already in signedUrls; cache write failure is non-fatal
  }

  return signedUrls;
}

/**
 * Generates a presigned URL for upload
 * @param fileKey S3 key for the file
 * @param bucketName Bucket name (e.g., 'videos', 'documents')
 * @param contentType MIME type of the file
 * @returns Presigned URL for upload
 */
export async function generateUploadPresignedUrl(
  fileKey: string,
  bucketName: string,
  contentType: string
): Promise<string> {
  const config = getStorageConfig();
  const client = getPresignS3Client();

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileKey,
    ContentType: contentType
  }) as GetSignedUrlParameters[1];

  const presignedUrl = await getSignedUrl(client as GetSignedUrlParameters[0], command, {
    expiresIn: config.presignUploadExpiresSeconds
  });

  return presignedUrl;
}

/** 6h presigned GET for private transcript VTT objects (not Redis-cached). */
export const TRANSCRIPT_VTT_PRESIGN_SECONDS = 21_600;

export async function generateTranscriptVttPresignedUrl(key: string, bucketName: string): Promise<string> {
  const client = getPresignS3Client();

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key
  }) as GetSignedUrlParameters[1];

  return getSignedUrl(client as GetSignedUrlParameters[0], command, {
    expiresIn: TRANSCRIPT_VTT_PRESIGN_SECONDS
  });
}

/**
 * Generates presigned URLs for video download
 * @param keys Array of video keys
 * @returns Record mapping keys to presigned URLs
 */
export async function generateVideoDownloadPresignedUrls(keys: string[]): Promise<Record<string, string>> {
  const config = getStorageConfig();
  return generateDownloadPresignedUrls(keys, config.bucketVideos);
}

/**
 * Generates presigned URLs for document download
 * @param keys Array of document keys
 * @returns Record mapping keys to presigned URLs
 */
export async function generateDocumentDownloadPresignedUrls(keys: string[]): Promise<Record<string, string>> {
  const config = getStorageConfig();
  return generateDownloadPresignedUrls(keys, config.bucketDocuments);
}

/**
 * Generates a presigned URL for video upload
 * @param fileKey S3 key for the video file
 * @param contentType MIME type of the video file
 * @returns Presigned URL for upload
 */
export async function generateVideoUploadPresignedUrl(fileKey: string, contentType: string): Promise<string> {
  const config = getStorageConfig();
  return generateUploadPresignedUrl(fileKey, config.bucketVideos, contentType);
}

/**
 * Generates a presigned URL for document upload
 * @param fileKey S3 key for the document file
 * @param contentType MIME type of the document file
 * @returns Presigned URL for upload
 */
export async function generateDocumentUploadPresignedUrl(fileKey: string, contentType: string): Promise<string> {
  const config = getStorageConfig();
  return generateUploadPresignedUrl(fileKey, config.bucketDocuments, contentType);
}

async function getObjectMetadata(
  bucket: string,
  fileKey: string
): Promise<{ contentLength: number; contentType: string | null }> {
  const response = await getS3Client().send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: fileKey
    })
  );
  const contentLength = response.ContentLength;
  if (typeof contentLength !== 'number' || !Number.isSafeInteger(contentLength) || contentLength <= 0) {
    throw new Error('Uploaded document has an invalid content length');
  }

  return {
    contentLength,
    contentType: response.ContentType ?? null
  };
}

export async function getDocumentObjectMetadata(
  fileKey: string
): Promise<{ contentLength: number; contentType: string | null }> {
  return getObjectMetadata(getStorageConfig().bucketDocuments, fileKey);
}

export async function getVideoObjectMetadata(
  fileKey: string
): Promise<{ contentLength: number; contentType: string | null }> {
  return getObjectMetadata(getStorageConfig().bucketVideos, fileKey);
}
