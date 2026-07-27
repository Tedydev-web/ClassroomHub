import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cleanupExamImportSourceArtifact: vi.fn(),
  error: vi.fn(),
  getExamImportById: vi.fn(),
  markExamImportFailed: vi.fn(),
  recordDeadLetterJob: vi.fn(),
  toExamImportFailure: vi.fn(),
  warn: vi.fn()
}));

vi.mock('@cio/db/queries/exam-import', () => ({
  getExamImportById: mocks.getExamImportById,
  markExamImportFailed: mocks.markExamImportFailed
}));
vi.mock('@cio/db/queries/jobs', () => ({
  recordDeadLetterJob: mocks.recordDeadLetterJob
}));
vi.mock('@cio/jobs', () => ({
  QUEUE_NAMES: { courseImports: 'course-imports' },
  ZExamImportPayload: {
    safeParse: (value: unknown) => ({
      success: true,
      data: value
    })
  }
}));
vi.mock('../../utils/logger', () => ({
  log: {
    error: mocks.error,
    warn: mocks.warn
  }
}));
vi.mock('./process', () => ({
  cleanupExamImportSourceArtifact: mocks.cleanupExamImportSourceArtifact,
  toExamImportFailure: mocks.toExamImportFailure
}));

import { handleExamImportFinalFailure } from './final-failure';

const rawPayload = {
  importId: '00000000-0000-4000-8000-000000000001',
  organizationId: '00000000-0000-4000-8000-000000000002',
  courseId: '00000000-0000-4000-8000-000000000003'
};

describe('handleExamImportFinalFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.toExamImportFailure.mockReturnValue({
      code: 'EXAM_IMPORT_PROCESSING_FAILED',
      message: 'Processing failed'
    });
    mocks.markExamImportFailed.mockResolvedValue({ id: rawPayload.importId, status: 'failed' });
    mocks.getExamImportById.mockResolvedValue({ id: rawPayload.importId, status: 'draft_ready' });
    mocks.cleanupExamImportSourceArtifact.mockResolvedValue(undefined);
    mocks.recordDeadLetterJob.mockResolvedValue(undefined);
  });

  it('persists the terminal state, cleans the artifact, and writes the dead letter', async () => {
    await handleExamImportFinalFailure({
      rawPayload,
      error: new Error('worker failure'),
      jobName: 'run-exam-import',
      bullmqJobId: 'exam-import-1',
      attempts: 3
    });

    expect(mocks.markExamImportFailed).toHaveBeenCalledOnce();
    expect(mocks.cleanupExamImportSourceArtifact).toHaveBeenCalledWith(rawPayload.importId, true);
    expect(mocks.recordDeadLetterJob).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: rawPayload.importId,
        queueName: 'course-imports',
        attempts: 3
      })
    );
  });

  it('contains persistence failures instead of creating an unhandled rejection', async () => {
    mocks.markExamImportFailed.mockRejectedValue(new Error('database unavailable'));
    mocks.recordDeadLetterJob.mockRejectedValue(new Error('database unavailable'));

    await expect(
      handleExamImportFinalFailure({
        rawPayload,
        error: new Error('worker failure'),
        jobName: 'run-exam-import',
        bullmqJobId: 'exam-import-1',
        attempts: 3
      })
    ).resolves.toBeUndefined();
    expect(mocks.error).toHaveBeenCalledTimes(2);
  });

  it('does not delete embedded media when a stale failure loses to draft completion', async () => {
    mocks.markExamImportFailed.mockResolvedValue(null);

    await handleExamImportFinalFailure({
      rawPayload,
      error: new Error('stale worker failure'),
      jobName: 'run-exam-import',
      bullmqJobId: 'exam-import-1',
      attempts: 3
    });

    expect(mocks.cleanupExamImportSourceArtifact).toHaveBeenCalledWith(rawPayload.importId, false);
  });
});
