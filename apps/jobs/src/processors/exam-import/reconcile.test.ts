import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cleanupExamImportAttemptOutputs: vi.fn(),
  cleanupExamImportSourceArtifact: vi.fn(),
  deleteJobStep: vi.fn(),
  deleteObjectFromBucket: vi.fn(),
  deleteObjectsByPrefix: vi.fn(),
  enqueueExamImport: vi.fn(),
  error: vi.fn(),
  listExpiredExamImportDrafts: vi.fn(),
  listQueuedExamImports: vi.fn(),
  listTerminalExamImportSourceCheckpoints: vi.fn(),
  markExamImportDraftCleanupCompleted: vi.fn(),
  markExamImportDraftExpired: vi.fn(),
  reapStuckExamImports: vi.fn()
}));

vi.mock('@cio/db/queries/exam-import', () => ({
  listExpiredExamImportDrafts: mocks.listExpiredExamImportDrafts,
  listQueuedExamImports: mocks.listQueuedExamImports,
  listTerminalExamImportSourceCheckpoints: mocks.listTerminalExamImportSourceCheckpoints,
  markExamImportDraftCleanupCompleted: mocks.markExamImportDraftCleanupCompleted,
  markExamImportDraftExpired: mocks.markExamImportDraftExpired,
  reapStuckExamImports: mocks.reapStuckExamImports
}));
vi.mock('@cio/db/queries/jobs', () => ({
  deleteJobStep: mocks.deleteJobStep
}));
vi.mock('@cio/jobs', () => ({
  enqueueExamImport: mocks.enqueueExamImport
}));
vi.mock('../../utils/logger', () => ({
  log: { error: mocks.error }
}));
vi.mock('../../config/storage', () => ({
  getStorageConfig: () => ({ bucketMedia: 'media' })
}));
vi.mock('../../utils/storage', () => ({
  deleteObjectFromBucket: mocks.deleteObjectFromBucket,
  deleteObjectsByPrefix: mocks.deleteObjectsByPrefix
}));
vi.mock('./process', () => ({
  cleanupExamImportAttemptOutputs: mocks.cleanupExamImportAttemptOutputs,
  cleanupExamImportSourceArtifact: mocks.cleanupExamImportSourceArtifact
}));

import { reconcileExamImports } from './reconcile';

describe('reconcileExamImports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listQueuedExamImports.mockResolvedValue([
      {
        id: '00000000-0000-4000-8000-000000000001',
        organizationId: '00000000-0000-4000-8000-000000000002',
        courseId: '00000000-0000-4000-8000-000000000003'
      },
      {
        id: '00000000-0000-4000-8000-000000000004',
        organizationId: '00000000-0000-4000-8000-000000000005',
        courseId: '00000000-0000-4000-8000-000000000006'
      }
    ]);
    mocks.reapStuckExamImports.mockResolvedValue([{ id: 'stale-import' }]);
    mocks.listExpiredExamImportDrafts.mockResolvedValue([]);
    mocks.listTerminalExamImportSourceCheckpoints.mockResolvedValue([]);
    mocks.cleanupExamImportSourceArtifact.mockResolvedValue(undefined);
    mocks.cleanupExamImportAttemptOutputs.mockResolvedValue(undefined);
    mocks.deleteJobStep.mockResolvedValue(true);
    mocks.deleteObjectsByPrefix.mockResolvedValue(undefined);
  });

  it('retries terminal source cleanup and removes failed checkpoints only after prefix cleanup', async () => {
    const importId = '00000000-0000-4000-8000-000000000010';
    mocks.listTerminalExamImportSourceCheckpoints.mockResolvedValue([
      {
        importId,
        organizationId: '00000000-0000-4000-8000-000000000011',
        courseId: '00000000-0000-4000-8000-000000000012',
        sourceStepStatus: 'failed'
      }
    ]);
    mocks.enqueueExamImport.mockResolvedValue('job');

    await reconcileExamImports(100, '2026-07-26T00:00:00.000Z');

    expect(mocks.deleteObjectsByPrefix).toHaveBeenCalledWith(
      'media',
      `exam-import/00000000-0000-4000-8000-000000000011/${importId}/`
    );
    expect(mocks.deleteJobStep).toHaveBeenCalledWith('exam-import', importId, 'source');
  });

  it('re-enqueues every durable queued row and contains per-row failures', async () => {
    mocks.enqueueExamImport.mockResolvedValueOnce('job-1').mockRejectedValueOnce(new Error('Redis unavailable'));

    await expect(reconcileExamImports(100, '2026-07-26T00:00:00.000Z')).resolves.toEqual({
      scanned: 2,
      enqueued: 1,
      failed: 1,
      reaped: 1,
      expired: 0,
      cleanupFailed: 0
    });
    expect(mocks.reapStuckExamImports).toHaveBeenCalledWith('2026-07-26T00:00:00.000Z');
    expect(mocks.cleanupExamImportSourceArtifact).toHaveBeenCalledWith('stale-import', true);
    expect(mocks.enqueueExamImport).toHaveBeenCalledTimes(2);
    expect(mocks.error).toHaveBeenCalledOnce();
  });

  it('uses a new stable job id checkpoint when an import is waiting for AI', async () => {
    mocks.listQueuedExamImports.mockResolvedValue([
      {
        id: '00000000-0000-4000-8000-000000000001',
        organizationId: '00000000-0000-4000-8000-000000000002',
        courseId: '00000000-0000-4000-8000-000000000003',
        status: 'waiting_for_ai',
        updatedAt: '2026-07-27T00:00:00.000Z'
      }
    ]);
    mocks.enqueueExamImport.mockResolvedValue('resume-job');

    await reconcileExamImports(100, '2026-07-26T00:00:00.000Z');

    expect(mocks.enqueueExamImport).toHaveBeenCalledWith(
      {
        importId: '00000000-0000-4000-8000-000000000001',
        organizationId: '00000000-0000-4000-8000-000000000002',
        courseId: '00000000-0000-4000-8000-000000000003'
      },
      {},
      'waiting_for_ai-1785110400000'
    );
  });

  it('marks an expired draft before deleting its embedded media and records cleanup completion', async () => {
    const expiredImportId = '00000000-0000-4000-8000-000000000007';
    mocks.listExpiredExamImportDrafts.mockResolvedValue([
      {
        scope: {
          importId: expiredImportId,
          organizationId: '00000000-0000-4000-8000-000000000008',
          courseId: '00000000-0000-4000-8000-000000000009'
        },
        status: 'draft_ready',
        embeddedAssets: [{ storageKey: 'exam-import/org/import/image.png' }]
      }
    ]);
    mocks.markExamImportDraftExpired.mockResolvedValue({ id: expiredImportId, status: 'failed' });
    mocks.deleteObjectFromBucket.mockResolvedValue(undefined);
    mocks.markExamImportDraftCleanupCompleted.mockResolvedValue({ importId: expiredImportId });
    mocks.enqueueExamImport.mockResolvedValue('job');

    await expect(reconcileExamImports(100, '2026-07-26T00:00:00.000Z')).resolves.toMatchObject({
      expired: 1,
      cleanupFailed: 0
    });
    expect(mocks.markExamImportDraftExpired).toHaveBeenCalledOnce();
    expect(mocks.deleteObjectFromBucket).toHaveBeenCalledWith('media', 'exam-import/org/import/image.png');
    expect(mocks.markExamImportDraftCleanupCompleted).toHaveBeenCalledWith(expiredImportId);
  });
});
