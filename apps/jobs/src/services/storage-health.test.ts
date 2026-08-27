import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  uploadToS3: vi.fn(),
  getFromS3: vi.fn(),
  deleteFromS3: vi.fn()
}));

vi.mock('@cio/core/utils/s3', () => mocks);
vi.mock('@cio/core/config/storage', () => ({
  getStorageConfig: () => ({ bucketDocuments: 'documents', bucketMedia: 'media', bucketVideos: 'videos' })
}));

import { checkStorageHealth } from './storage-health';

describe('storage health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.uploadToS3.mockResolvedValue({ success: true });
    mocks.getFromS3.mockResolvedValue({ success: true });
    mocks.deleteFromS3.mockResolvedValue({ success: true });
  });

  it('writes, reads back and deletes a probe in every bucket', async () => {
    const health = await checkStorageHealth();

    expect(health.ok).toBe(true);
    expect(health.buckets.map((bucket) => bucket.bucket).sort()).toEqual(['documents', 'media', 'videos']);
    expect(mocks.uploadToS3).toHaveBeenCalledTimes(3);
    expect(mocks.getFromS3).toHaveBeenCalledTimes(3);
    expect(mocks.deleteFromS3).toHaveBeenCalledTimes(3);
    // The probe must never land where real content lives.
    for (const call of mocks.uploadToS3.mock.calls) expect(call[0].Key).toMatch(/^__health\//);
  });

  it('reports the bucket that refused a write, with its reason', async () => {
    mocks.uploadToS3.mockImplementation(async ({ Bucket }: { Bucket: string }) =>
      Bucket === 'documents' ? { success: false, error: 'Unauthorized' } : { success: true }
    );

    const health = await checkStorageHealth();

    expect(health.ok).toBe(false);
    expect(health.buckets.find((bucket) => bucket.bucket === 'documents')).toMatchObject({
      ok: false,
      error: 'Unauthorized'
    });
  });

  it('treats a write that cannot be read back as a failure', async () => {
    mocks.getFromS3.mockResolvedValue({ success: false, error: 'NoSuchKey' });

    await expect(checkStorageHealth()).resolves.toMatchObject({ ok: false });
  });

  it('does not fail a healthy bucket because the probe could not be deleted', async () => {
    mocks.deleteFromS3.mockRejectedValue(new Error('delete refused'));

    await expect(checkStorageHealth()).resolves.toMatchObject({ ok: true });
  });
});
