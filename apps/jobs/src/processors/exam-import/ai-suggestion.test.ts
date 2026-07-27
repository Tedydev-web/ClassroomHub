import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getExamImportById: vi.fn(),
  getExamImportDraft: vi.fn(),
  lockExamImportById: vi.fn(),
  recordExamImportAiRegion: vi.fn(),
  replaceExamImportDraft: vi.fn(),
  updateExamImportDraftSummary: vi.fn(),
  applyExamImportAiRegionResponse: vi.fn(),
  collectExamImportAiRegions: vi.fn(),
  validateExamImportDraft: vi.fn(),
  requestNextExamImportAiRegion: vi.fn(),
  transaction: vi.fn()
}));

vi.mock('@cio/db/drizzle', () => ({ db: { transaction: mocks.transaction } }));
vi.mock('@cio/db/queries/exam-import', () => ({
  getExamImportById: mocks.getExamImportById,
  getExamImportDraft: mocks.getExamImportDraft,
  lockExamImportById: mocks.lockExamImportById,
  recordExamImportAiRegion: mocks.recordExamImportAiRegion,
  replaceExamImportDraft: mocks.replaceExamImportDraft,
  updateExamImportDraftSummary: mocks.updateExamImportDraftSummary
}));
vi.mock('@cio/exam-import', () => ({
  applyExamImportAiRegionResponse: mocks.applyExamImportAiRegionResponse,
  collectExamImportAiRegions: mocks.collectExamImportAiRegions,
  validateExamImportDraft: mocks.validateExamImportDraft
}));
vi.mock('@cio/core/services/agent/usage', () => ({ recordTokenUsage: vi.fn() }));
vi.mock('@cio/core/utils/sanitize-html', () => ({ sanitizeHtml: (html: string) => html }));
vi.mock('../../utils/logger', () => ({ log: { info: vi.fn() } }));
vi.mock('./ai-region', () => ({ requestNextExamImportAiRegion: mocks.requestNextExamImportAiRegion }));

import { processExamImportAiSuggestion } from './ai-suggestion';

const payload = {
  importId: '00000000-0000-4000-8000-000000000001',
  organizationId: '00000000-0000-4000-8000-000000000002',
  courseId: '00000000-0000-4000-8000-000000000003',
  actorProfileId: '00000000-0000-4000-8000-000000000004',
  questionIds: ['question-1'],
  expectedDraftUpdatedAt: '2026-07-27T15:00:00.000Z'
};

describe('processExamImportAiSuggestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getExamImportById.mockResolvedValue({ status: 'draft_ready' });
    mocks.transaction.mockImplementation(async (callback: (tx: Record<string, never>) => Promise<unknown>) =>
      callback({})
    );
  });

  it('does not request AI when the draft changed after the teacher action', async () => {
    mocks.getExamImportDraft.mockResolvedValue({ updatedAt: '2026-07-27T15:00:01.000Z' });

    await expect(processExamImportAiSuggestion(payload)).resolves.toEqual({ status: 'stale' });
    expect(mocks.requestNextExamImportAiRegion).not.toHaveBeenCalled();
  });

  it('uses the revision saved for each question before processing the next selected question', async () => {
    const draft = { schemaVersion: 1, sections: [] };
    const initialUpdatedAt = payload.expectedDraftUpdatedAt;
    const firstUpdatedAt = '2026-07-27T15:00:01.000Z';
    const secondUpdatedAt = '2026-07-27T15:00:02.000Z';
    const batchPayload = { ...payload, questionIds: ['question-1', 'question-2'] };
    mocks.getExamImportById.mockResolvedValueOnce({ status: 'draft_ready', aiCursor: 1 }).mockResolvedValueOnce({
      status: 'draft_ready',
      aiCursor: 2
    });
    mocks.getExamImportDraft
      .mockResolvedValueOnce({ updatedAt: initialUpdatedAt, draft })
      .mockResolvedValueOnce({ updatedAt: initialUpdatedAt, embeddedAssets: [], expiresAt: '2999-01-01T00:00:00.000Z' })
      .mockResolvedValueOnce({ updatedAt: firstUpdatedAt, draft })
      .mockResolvedValueOnce({ updatedAt: firstUpdatedAt, embeddedAssets: [], expiresAt: '2999-01-01T00:00:00.000Z' });
    mocks.requestNextExamImportAiRegion
      .mockResolvedValueOnce({
        kind: 'attempted',
        region: { questionId: 'question-1', reasons: [] },
        response: { regions: [] },
        requestHash: 'request-1',
        sentAt: initialUpdatedAt,
        model: 'exam-import-model',
        quotaMultiplier: 1,
        promptTokens: 0,
        completionTokens: 0,
        transportAvailable: true
      })
      .mockResolvedValueOnce({
        kind: 'attempted',
        region: { questionId: 'question-2', reasons: [] },
        response: { regions: [] },
        requestHash: 'request-2',
        sentAt: firstUpdatedAt,
        model: 'exam-import-model',
        quotaMultiplier: 1,
        promptTokens: 0,
        completionTokens: 0,
        transportAvailable: true
      });

    mocks.lockExamImportById
      .mockResolvedValueOnce({ status: 'draft_ready', aiCursor: 1, warningCount: 0 })
      .mockResolvedValueOnce({ status: 'draft_ready', aiCursor: 2, warningCount: 0 });
    mocks.recordExamImportAiRegion.mockResolvedValue({});
    mocks.replaceExamImportDraft
      .mockResolvedValueOnce({ updatedAt: firstUpdatedAt })
      .mockResolvedValueOnce({ updatedAt: secondUpdatedAt });
    mocks.updateExamImportDraftSummary.mockResolvedValue({});
    mocks.validateExamImportDraft.mockReturnValue({ draft, findings: [] });
    mocks.collectExamImportAiRegions.mockImplementation((input: unknown) => {
      if (input === draft) return [{ questionId: 'question-1' }, { questionId: 'question-2' }];

      return [];
    });
    mocks.applyExamImportAiRegionResponse.mockReturnValue({ accepted: true, draft });

    await expect(processExamImportAiSuggestion(batchPayload)).resolves.toEqual({ status: 'applied' });
    expect(mocks.requestNextExamImportAiRegion).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ questionId: 'question-1' })
    );
    expect(mocks.requestNextExamImportAiRegion).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ questionId: 'question-2' })
    );
    expect(mocks.getExamImportDraft).toHaveBeenNthCalledWith(3, expect.anything());
  });
});
