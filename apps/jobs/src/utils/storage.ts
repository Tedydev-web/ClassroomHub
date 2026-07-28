import {
  DeleteObjectsCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
  PutObjectCommand
} from '@aws-sdk/client-s3';
import { Readable, Transform } from 'node:stream';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import { getS3Client, getStorageConfig } from '../config/storage';

export class ObjectSizeLimitExceededError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Object exceeds the ${maxBytes}-byte download limit`);
    this.name = 'ObjectSizeLimitExceededError';
  }
}

/**
 * Streams an S3 object to a temp file on disk and returns the absolute path.
 * Workers prefer disk over buffers so ffmpeg can seek without holding the
 * whole video in RAM.
 */
export async function objectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    if (error instanceof NotFound || (error as { name?: string }).name === 'NotFound') {
      return false;
    }

    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) {
      return false;
    }

    throw error;
  }
}

export async function downloadObjectToTempFile(
  bucket: string,
  key: string,
  fileNameHint?: string,
  maxBytes?: number
): Promise<string> {
  const dir = path.join(tmpdir(), 'cio-jobs');
  await mkdir(dir, { recursive: true });

  const safeName = fileNameHint?.replace(/[^a-zA-Z0-9._-]/g, '_') ?? 'media';
  const localPath = path.join(dir, `${Date.now()}_${process.pid}_${safeName}`);

  const response = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) {
    throw new Error(`S3 object ${bucket}/${key} returned no body`);
  }

  const body = response.Body as Readable;
  try {
    if (maxBytes === undefined) {
      await pipeline(body, createWriteStream(localPath));
    } else {
      let downloadedBytes = 0;
      const byteLimiter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          downloadedBytes += chunk.byteLength;
          if (downloadedBytes > maxBytes) {
            callback(new ObjectSizeLimitExceededError(maxBytes));
            return;
          }

          callback(null, chunk);
        }
      });
      await pipeline(body, byteLimiter, createWriteStream(localPath));
    }
  } catch (error) {
    await safeUnlink(localPath);
    throw error;
  }

  return localPath;
}

export async function uploadFileToBucket(
  bucket: string,
  key: string,
  localPath: string,
  contentType: string,
  cacheControl?: string
): Promise<void> {
  const buffer = await readFile(localPath);
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: cacheControl
    })
  );
}

export async function uploadBufferToBucket(
  bucket: string,
  key: string,
  buffer: Buffer,
  contentType: string,
  cacheControl?: string
): Promise<void> {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: cacheControl
    })
  );
}

export async function deleteObjectFromBucket(bucket: string, key: string): Promise<void> {
  await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function deleteObjectsByPrefix(bucket: string, prefix: string): Promise<void> {
  let continuationToken: string | undefined;

  do {
    const listed = await getS3Client().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken
      })
    );
    const objects = (listed.Contents ?? []).flatMap(({ Key }) => (Key ? [{ Key }] : []));
    if (objects.length > 0) {
      const deleted = await getS3Client().send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects, Quiet: true }
        })
      );
      if ((deleted.Errors?.length ?? 0) > 0) {
        throw new Error(`Failed to delete ${deleted.Errors?.length ?? 0} objects under prefix`);
      }
    }
    if (listed.IsTruncated && !listed.NextContinuationToken) {
      throw new Error('Truncated object listing returned no continuation token');
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
}

export async function safeUnlink(filePath: string | undefined | null): Promise<void> {
  if (!filePath) return;

  try {
    await unlink(filePath);
  } catch {
    // best-effort cleanup
  }
}

export function videosBucket(): string {
  return getStorageConfig().bucketVideos;
}

export function mediaBucket(): string {
  return getStorageConfig().bucketMedia;
}
