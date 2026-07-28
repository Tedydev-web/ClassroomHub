import { Readable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn()
}));

vi.mock('../config/storage', () => ({
  getS3Client: () => ({ send: mocks.send }),
  getStorageConfig: vi.fn()
}));

import { ObjectSizeLimitExceededError, deleteObjectsByPrefix, downloadObjectToTempFile } from './storage';

describe('downloadObjectToTempFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stops the stream before an object can exceed the configured disk limit', async () => {
    mocks.send.mockResolvedValue({
      Body: Readable.from([Buffer.alloc(3), Buffer.alloc(3)])
    });

    await expect(downloadObjectToTempFile('documents', 'oversized.docx', 'source.bin', 4)).rejects.toBeInstanceOf(
      ObjectSizeLimitExceededError
    );
  });
});

describe('deleteObjectsByPrefix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes every page under the prefix and ignores empty pages', async () => {
    mocks.send
      .mockResolvedValueOnce({
        Contents: [{ Key: 'exam-import/org/import/first.png' }],
        IsTruncated: true,
        NextContinuationToken: 'next-page'
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        Contents: [{ Key: 'exam-import/org/import/second.png' }, {}],
        IsTruncated: false
      })
      .mockResolvedValueOnce({});

    await deleteObjectsByPrefix('media', 'exam-import/org/import/');

    expect(mocks.send).toHaveBeenCalledTimes(4);
    expect(mocks.send.mock.calls[0]?.[0].input).toEqual({
      Bucket: 'media',
      Prefix: 'exam-import/org/import/',
      ContinuationToken: undefined
    });
    expect(mocks.send.mock.calls[1]?.[0].input).toEqual({
      Bucket: 'media',
      Delete: {
        Objects: [{ Key: 'exam-import/org/import/first.png' }],
        Quiet: true
      }
    });
    expect(mocks.send.mock.calls[2]?.[0].input).toEqual({
      Bucket: 'media',
      Prefix: 'exam-import/org/import/',
      ContinuationToken: 'next-page'
    });
    expect(mocks.send.mock.calls[3]?.[0].input.Delete.Objects).toEqual([{ Key: 'exam-import/org/import/second.png' }]);
  });

  it('fails when object storage reports a per-object delete error', async () => {
    mocks.send
      .mockResolvedValueOnce({
        Contents: [{ Key: 'exam-import/org/import/failed.png' }],
        IsTruncated: false
      })
      .mockResolvedValueOnce({
        Errors: [{ Key: 'exam-import/org/import/failed.png', Code: 'AccessDenied' }]
      });

    await expect(deleteObjectsByPrefix('media', 'exam-import/org/import/')).rejects.toThrow(
      'Failed to delete 1 objects under prefix'
    );
  });
});
