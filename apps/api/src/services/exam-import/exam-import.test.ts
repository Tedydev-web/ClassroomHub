import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZCourseDocumentPresignUrlUpload } from '@cio/utils/validation/course';

const mocks = vi.hoisted(() => ({
  createExerciseFromAuthoringPlan: vi.fn(),
  createExamImport: vi.fn(),
  createExamImportPublishPlan: vi.fn(),
  enqueueExamImport: vi.fn(),
  enqueueExamImportAiSuggestion: vi.fn(),
  getGatewaySettings: vi.fn(),
  getOrganizationById: vi.fn(),
  readGatewayConnectionFromEnv: vi.fn(),
  getAssetById: vi.fn(),
  getCourseWithOrgData: vi.fn(),
  getExamImportById: vi.fn(),
  getExamImportDraft: vi.fn(),
  isCourseTeamMemberOrOrgAdmin: vi.fn(),
  inspectExamImportDocument: vi.fn(),
  lockExamImportById: vi.fn(),
  markExamImportCanceled: vi.fn(),
  markExamImportPublished: vi.fn(),
  readDocumentObjectBytes: vi.fn(),
  replaceExamImportDraft: vi.fn(),
  transaction: vi.fn(),
  updateExamImportDraftSummary: vi.fn(),
  selectGatewayModelId: vi.fn(),
  collectExamImportAiRegions: vi.fn(),
  validateExamImportDraft: vi.fn()
}));

vi.mock('@cio/core/services/exercise/exercise', () => ({
  createExerciseFromAuthoringPlan: mocks.createExerciseFromAuthoringPlan
}));
vi.mock('@cio/core/config/upload-limits', () => ({
  getUploadLimits: () => ({ documentBytes: 100 * 1024 * 1024 })
}));
vi.mock('@cio/core/config/env', () => ({
  env: { EXAM_IMPORT_ENABLED: 'true', EXAM_IMPORT_AI_ENABLED: 'true', EXAM_IMPORT_AI_MODEL: 'exam-import-model' }
}));
vi.mock('@cio/core/services/agent/gateway-runtime', () => ({
  readGatewayConnectionFromEnv: mocks.readGatewayConnectionFromEnv,
  selectGatewayModelId: mocks.selectGatewayModelId
}));
vi.mock('@cio/core/services/agent/gateway-settings-store', () => ({
  getGatewaySettings: mocks.getGatewaySettings
}));
vi.mock('@cio/core/utils/sanitize-html', () => ({
  sanitizeHtml: (html: string) => html
}));
vi.mock('@cio/core/utils/s3', () => ({
  S3ObjectSizeLimitExceededError: class S3ObjectSizeLimitExceededError extends Error {},
  readDocumentObjectBytes: mocks.readDocumentObjectBytes
}));
vi.mock('@cio/db/drizzle', () => ({
  db: { transaction: mocks.transaction }
}));
vi.mock('@cio/db/queries/assets', () => ({
  getAssetById: mocks.getAssetById
}));
vi.mock('@cio/db/queries/course', () => ({
  getCourseWithOrgData: mocks.getCourseWithOrgData
}));
vi.mock('@cio/db/queries/organization', () => ({
  getOrganizationById: mocks.getOrganizationById
}));
vi.mock('@cio/db/queries/exam-import', () => ({
  createExamImport: mocks.createExamImport,
  getExamImportById: mocks.getExamImportById,
  getExamImportDraft: mocks.getExamImportDraft,
  lockExamImportById: mocks.lockExamImportById,
  markExamImportCanceled: mocks.markExamImportCanceled,
  markExamImportPublished: mocks.markExamImportPublished,
  replaceExamImportDraft: mocks.replaceExamImportDraft,
  updateExamImportDraftSummary: mocks.updateExamImportDraftSummary
}));
vi.mock('@cio/db/queries/group', () => ({
  isCourseTeamMemberOrOrgAdmin: mocks.isCourseTeamMemberOrOrgAdmin
}));
vi.mock('@cio/exam-import', () => ({
  EXAM_IMPORT_PUBLISHABLE_QUESTION_KINDS: ['choice', 'true_false_group', 'short_answer', 'numeric', 'essay'],
  ExamImportCompactAnswerKeyError: class ExamImportCompactAnswerKeyError extends Error {},
  ExamImportDraftPatchError: class ExamImportDraftPatchError extends Error {},
  ExamImportPublishPlanError: class ExamImportPublishPlanError extends Error {},
  applyExamImportCompactAnswerKey: vi.fn(),
  applyExamImportDraftPatches: vi.fn(),
  collectExamImportAiRegions: mocks.collectExamImportAiRegions,
  createExamImportPublishPlan: mocks.createExamImportPublishPlan,
  examImportDraftSchema: { safeParse: vi.fn() },
  inspectExamImportDocument: mocks.inspectExamImportDocument,
  validateExamImportDraft: mocks.validateExamImportDraft
}));
vi.mock('@cio/jobs', () => ({
  enqueueExamImport: mocks.enqueueExamImport,
  enqueueExamImportAiSuggestion: mocks.enqueueExamImportAiSuggestion
}));

import { ErrorCodes } from '@api/utils/errors';
import {
  applyExamImportAnswerKeyDocumentService,
  cancelExamImportService,
  createExamImportService,
  getExamImportDraftService,
  publishExamImportService,
  requestExamImportAiSuggestionService
} from './exam-import';

const scope = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  courseId: '00000000-0000-4000-8000-000000000002',
  userId: '00000000-0000-4000-8000-000000000003'
};
const importId = '00000000-0000-4000-8000-000000000004';
const exerciseId = '00000000-0000-4000-8000-000000000005';
const assetId = '00000000-0000-4000-8000-000000000006';
const transactionClient = {};

function importRow(status: 'queued' | 'running' | 'waiting_for_ai' | 'draft_ready' | 'published' | 'canceled') {
  return {
    id: importId,
    organizationId: scope.organizationId,
    courseId: scope.courseId,
    actorProfileId: scope.userId,
    sourceAssetId: assetId,
    status,
    extractor: 'docx',
    sectionCount: 1,
    questionCount: 1,
    reviewRequiredCount: 0,
    blockingIssueCount: 0,
    warningCount: 0,
    failure: null,
    publishedExerciseId: status === 'published' ? exerciseId : null,
    startedAt: status === 'queued' ? null : '2026-07-26T00:00:00.000Z',
    draftReadyAt:
      status === 'queued' || status === 'running' || status === 'waiting_for_ai' || status === 'canceled'
        ? null
        : '2026-07-26T00:01:00.000Z',
    publishedAt: status === 'published' ? '2026-07-26T00:02:00.000Z' : null,
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:02:00.000Z'
  } as const;
}

describe('exam import service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (tx: Record<string, never>) => Promise<unknown>) =>
      callback(transactionClient)
    );
    mocks.getCourseWithOrgData.mockResolvedValue({ orgId: scope.organizationId });
    mocks.getOrganizationById.mockResolvedValue({ settings: { examImport: { aiEnabled: true } } });
    mocks.getGatewaySettings.mockResolvedValue({
      modelAllowlist: [{ modelId: 'exam-import-model', quotaWeight: 1 }]
    });
    mocks.selectGatewayModelId.mockReturnValue('exam-import-model');
    mocks.readGatewayConnectionFromEnv.mockReturnValue({ baseURL: 'https://gateway.test', authToken: 'test-token' });
    mocks.readDocumentObjectBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.inspectExamImportDocument.mockResolvedValue({
      supported: true,
      detectedType: 'docx',
      reason: null
    });
  });

  it('allows the document presign boundary to accept plain-text interchange files', () => {
    expect(
      ZCourseDocumentPresignUrlUpload.safeParse({
        fileName: 'exam.aiken',
        fileType: 'text/plain',
        fileSize: 1_024
      }).success
    ).toBe(true);
  });

  it('refuses a PDF answer-key document while PDF import is disabled', async () => {
    // The paper path rejects a PDF when the server flag is off. A key file reaches the same
    // PDF reader, so accepting one here would reopen through the second door exactly what
    // that flag exists to close — and would leave the documented PDF rollback incomplete.
    mocks.getAssetById.mockResolvedValue({
      id: assetId,
      kind: 'document',
      provider: 'upload',
      status: 'active',
      isExternal: false,
      storageKey: 'documents/key.pdf',
      title: 'key.pdf'
    });
    mocks.inspectExamImportDocument.mockResolvedValue({ supported: true, detectedType: 'pdf', reason: null });

    await expect(applyExamImportAnswerKeyDocumentService(scope, importId, assetId)).rejects.toMatchObject({
      code: ErrorCodes.EXAM_IMPORT_SOURCE_INVALID
    });
  });

  it('replays a published import without creating another exercise', async () => {
    mocks.lockExamImportById.mockResolvedValue(importRow('published'));

    await expect(publishExamImportService(scope, importId)).resolves.toEqual({
      exerciseId,
      replayed: true
    });
    expect(mocks.createExerciseFromAuthoringPlan).not.toHaveBeenCalled();
    expect(mocks.markExamImportPublished).not.toHaveBeenCalled();
  });

  it('cancels a running import under the import row lock', async () => {
    mocks.lockExamImportById.mockResolvedValue(importRow('running'));
    mocks.markExamImportCanceled.mockResolvedValue(importRow('canceled'));

    await expect(cancelExamImportService(scope, importId)).resolves.toEqual({
      status: 'canceled',
      replayed: false
    });
    expect(mocks.markExamImportCanceled).toHaveBeenCalledWith(
      {
        organizationId: scope.organizationId,
        courseId: scope.courseId,
        importId
      },
      transactionClient
    );
  });

  it('allows cancellation while the import is waiting for AI capacity', async () => {
    mocks.lockExamImportById.mockResolvedValue(importRow('waiting_for_ai'));
    mocks.markExamImportCanceled.mockResolvedValue(importRow('canceled'));

    await expect(cancelExamImportService(scope, importId)).resolves.toEqual({
      status: 'canceled',
      replayed: false
    });
  });

  it('rejects cancellation after the draft becomes ready', async () => {
    mocks.lockExamImportById.mockResolvedValue(importRow('draft_ready'));

    await expect(cancelExamImportService(scope, importId)).rejects.toMatchObject({
      code: ErrorCodes.EXAM_IMPORT_CANCEL_CONFLICT,
      statusCode: 409
    });
    expect(mocks.markExamImportCanceled).not.toHaveBeenCalled();
  });

  it('refuses publish when course authoring permission was revoked', async () => {
    mocks.lockExamImportById.mockResolvedValue(importRow('draft_ready'));
    mocks.isCourseTeamMemberOrOrgAdmin.mockResolvedValue(false);

    await expect(publishExamImportService(scope, importId)).rejects.toMatchObject({
      code: ErrorCodes.FORBIDDEN,
      statusCode: 403
    });
    expect(mocks.getExamImportDraft).not.toHaveBeenCalled();
    expect(mocks.createExerciseFromAuthoringPlan).not.toHaveBeenCalled();
  });

  it('publishes through the existing atomic exercise authoring service', async () => {
    const publishPlan = {
      title: 'Imported exam',
      sections: [{ sourceSectionId: 'section-1', title: 'Part I', order: 0, entries: [] }]
    };
    mocks.lockExamImportById.mockResolvedValue(importRow('draft_ready'));
    mocks.isCourseTeamMemberOrOrgAdmin.mockResolvedValue(true);
    mocks.getExamImportDraft.mockResolvedValue({
      importId,
      draft: { schemaVersion: 1 },
      schemaVersion: 1,
      expiresAt: '2999-01-01T00:00:00.000Z',
      createdAt: '2026-07-26T00:01:00.000Z',
      updatedAt: '2026-07-26T00:01:00.000Z'
    });
    mocks.createExamImportPublishPlan.mockReturnValue(publishPlan);
    mocks.createExerciseFromAuthoringPlan.mockResolvedValue({ id: exerciseId });
    mocks.markExamImportPublished.mockResolvedValue(importRow('published'));

    await expect(publishExamImportService(scope, importId)).resolves.toEqual({
      exerciseId,
      replayed: false
    });
    expect(mocks.createExerciseFromAuthoringPlan).toHaveBeenCalledWith(
      {
        exercise: { title: publishPlan.title, courseId: scope.courseId },
        sections: publishPlan.sections
      },
      transactionClient
    );
    expect(mocks.markExamImportPublished).toHaveBeenCalledWith(
      {
        organizationId: scope.organizationId,
        courseId: scope.courseId,
        importId
      },
      {
        publishedExerciseId: exerciseId,
        publishedAt: expect.any(String)
      },
      transactionClient
    );
  });

  it('refuses an expired draft', async () => {
    mocks.getExamImportById.mockResolvedValue(importRow('draft_ready'));
    mocks.getExamImportDraft.mockResolvedValue({
      importId,
      draft: {},
      schemaVersion: 1,
      expiresAt: '2000-01-01T00:00:00.000Z',
      createdAt: '2000-01-01T00:00:00.000Z',
      updatedAt: '2000-01-01T00:00:00.000Z'
    });

    await expect(getExamImportDraftService(scope, importId)).rejects.toMatchObject({
      code: ErrorCodes.EXAM_IMPORT_DRAFT_EXPIRED,
      statusCode: 410
    });
  });

  it('queues an explicit AI suggestion only for a currently suggestable draft question', async () => {
    const draft = { schemaVersion: 1, sections: [] };
    mocks.getExamImportById.mockResolvedValue(importRow('draft_ready'));
    mocks.getExamImportDraft.mockResolvedValue({
      importId,
      draft,
      schemaVersion: 1,
      expiresAt: '2999-01-01T00:00:00.000Z',
      createdAt: '2026-07-26T00:01:00.000Z',
      updatedAt: '2026-07-26T00:01:00.000Z'
    });
    mocks.validateExamImportDraft.mockReturnValue({ draft, findings: [], publishable: false });
    mocks.collectExamImportAiRegions.mockReturnValue([{ questionId: 'question-1' }]);
    mocks.enqueueExamImportAiSuggestion.mockResolvedValue('job-1');

    await expect(requestExamImportAiSuggestionService(scope, importId, ['question-1'])).resolves.toEqual({
      queuedCount: 1
    });
    expect(mocks.enqueueExamImportAiSuggestion).toHaveBeenCalledWith({
      importId,
      organizationId: scope.organizationId,
      courseId: scope.courseId,
      actorProfileId: scope.userId,
      questionIds: ['question-1'],
      expectedDraftUpdatedAt: '2026-07-26T00:01:00.000Z'
    });
  });

  it('keeps a durable queued import for reconciliation when immediate enqueue fails', async () => {
    mocks.getAssetById.mockResolvedValue({
      id: assetId,
      organizationId: scope.organizationId,
      kind: 'document',
      provider: 'upload',
      status: 'active',
      isExternal: false,
      storageKey: 'documents/exam.docx',
      title: 'exam.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      byteSize: 1_024
    });
    mocks.createExamImport.mockResolvedValue(importRow('queued'));
    mocks.enqueueExamImport.mockRejectedValue(new Error('Redis unavailable'));

    await expect(createExamImportService(scope, assetId)).resolves.toMatchObject({
      id: importId,
      status: 'queued'
    });
  });

  it.each(['aiken', 'gift'] as const)('creates an import for a validated %s source', async (extractor) => {
    const fileName = `exam.${extractor}`;
    mocks.getAssetById.mockResolvedValue({
      id: assetId,
      organizationId: scope.organizationId,
      kind: 'document',
      provider: 'upload',
      status: 'active',
      isExternal: false,
      storageKey: `documents/${fileName}`,
      title: fileName,
      mimeType: 'text/plain',
      byteSize: 1_024
    });
    mocks.inspectExamImportDocument.mockResolvedValue({
      supported: true,
      detectedType: extractor,
      reason: null
    });
    mocks.createExamImport.mockResolvedValue({
      ...importRow('queued'),
      extractor
    });
    mocks.enqueueExamImport.mockResolvedValue(undefined);

    await expect(createExamImportService(scope, assetId)).resolves.toMatchObject({
      id: importId,
      extractor,
      status: 'queued'
    });
    expect(mocks.inspectExamImportDocument).toHaveBeenCalledWith(expect.any(Uint8Array), 100 * 1024 * 1024, fileName);
    expect(mocks.createExamImport).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: scope.organizationId,
        courseId: scope.courseId,
        sourceAssetId: assetId,
        extractor
      })
    );
  });

  it('rejects a spoofed DOCX before creating an import row', async () => {
    mocks.getAssetById.mockResolvedValue({
      id: assetId,
      organizationId: scope.organizationId,
      kind: 'document',
      provider: 'upload',
      status: 'active',
      isExternal: false,
      storageKey: 'documents/spoofed.docx',
      title: 'spoofed.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      byteSize: 1_024
    });
    mocks.inspectExamImportDocument.mockResolvedValue({
      supported: false,
      detectedType: 'unknown',
      reason: 'invalid_document'
    });

    await expect(createExamImportService(scope, assetId)).rejects.toMatchObject({
      code: ErrorCodes.EXAM_IMPORT_SOURCE_INVALID,
      statusCode: 400
    });
    expect(mocks.createExamImport).not.toHaveBeenCalled();
  });

  it('rejects a valid PDF while the separate PDF gate is disabled', async () => {
    mocks.getAssetById.mockResolvedValue({
      id: assetId,
      organizationId: scope.organizationId,
      kind: 'document',
      provider: 'upload',
      status: 'active',
      isExternal: false,
      storageKey: 'documents/exam.pdf',
      title: 'exam.pdf',
      mimeType: 'application/pdf',
      byteSize: 1_024
    });
    mocks.inspectExamImportDocument.mockResolvedValue({
      supported: true,
      detectedType: 'pdf',
      reason: null
    });

    await expect(createExamImportService(scope, assetId)).rejects.toMatchObject({
      code: ErrorCodes.EXAM_IMPORT_SOURCE_INVALID,
      statusCode: 400
    });
    expect(mocks.createExamImport).not.toHaveBeenCalled();
  });
});
