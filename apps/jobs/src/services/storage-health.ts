import { randomUUID } from 'node:crypto';

import { getStorageConfig } from '@cio/core/config/storage';
import { deleteFromS3, getFromS3, uploadToS3 } from '@cio/core/utils/s3';

/**
 * Proves object storage still accepts writes.
 *
 * Storage rejected every upload for sixteen days and nothing noticed, because nothing ever
 * wrote to it except a person trying to do their job — and they were told to try again.
 * A revoked credential refuses a read exactly as it refuses a write, so the check writes,
 * reads back and deletes a small object in each bucket the product depends on.
 *
 * It reports; it does not throw. A caller decides what a failure means.
 */
export type StorageBucketHealth = {
  bucket: string;
  ok: boolean;
  error?: string;
};

export type StorageHealth = {
  ok: boolean;
  checkedAt: string;
  buckets: StorageBucketHealth[];
};

/** Namespaced and random, so a probe can never collide with real content. */
const HEALTH_KEY_PREFIX = '__health/';
const HEALTH_BODY = 'ok';

async function checkBucket(bucket: string): Promise<StorageBucketHealth> {
  const key = `${HEALTH_KEY_PREFIX}${randomUUID()}.txt`;

  try {
    const uploaded = await uploadToS3({ Bucket: bucket, Key: key, Body: HEALTH_BODY, ContentType: 'text/plain' });
    if (!uploaded.success) return { bucket, ok: false, error: uploaded.error ?? 'write refused' };

    const read = await getFromS3({ Bucket: bucket, Key: key });
    if (!read.success) return { bucket, ok: false, error: read.error ?? 'read refused' };

    return { bucket, ok: true };
  } catch (error) {
    return { bucket, ok: false, error: error instanceof Error ? error.message : 'unknown error' };
  } finally {
    // Best effort: a probe left behind is harmless, and a delete that fails must not turn
    // a healthy write into a reported outage.
    await deleteFromS3({ Bucket: bucket, Key: key }).catch(() => undefined);
  }
}

export async function checkStorageHealth(): Promise<StorageHealth> {
  const config = getStorageConfig();
  const buckets = [...new Set([config.bucketDocuments, config.bucketMedia, config.bucketVideos])];
  const results = await Promise.all(buckets.map((bucket) => checkBucket(bucket)));

  return {
    ok: results.every((result) => result.ok),
    checkedAt: new Date().toISOString(),
    buckets: results
  };
}
