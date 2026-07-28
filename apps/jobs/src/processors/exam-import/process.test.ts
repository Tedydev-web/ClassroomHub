import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createValidatedExamImportDraftFromRuns: vi.fn(),
  deleteJobStep: vi.fn(),
  deleteObjectFromBucket: vi.fn(),
  deleteObjectsByPrefix: vi.fn(),
  downloadObjectToTempFile: vi.fn(),
  getAssetById: vi.fn(),
  getExamImportById: vi.fn(),
  getExamImportDraft: vi.fn(),
  getConfiguredExamImportVisionModel: vi.fn(),
  getJobStep: vi.fn(),
  inspectExamImportDocument: vi.fn(),
  listJobStepsByRun: vi.fn(),
  markExamImportDraftAsAiDerived: vi.fn(),
  markExamImportDraftReady: vi.fn(),
  markExamImportRunning: vi.fn(),
  markExamImportWaitingForAi: vi.fn(),
  recordExamImportAiRegion: vi.fn(),
  recordTokenUsage: vi.fn(),
  requestExamImportVisionPage: vi.fn(),
  requestNextExamImportAiRegion: vi.fn(),
  PdfReadError: class PdfReadError extends Error {
    constructor(
      readonly code: 'INVALID_PDF' | 'NO_TEXT_LAYER',
      readonly pageCount: number,
      readonly extractedCharacterCount: number
    ) {
      super(code);
      this.name = 'PdfReadError';
    }
  },
  readDocxRuns: vi.fn(),
  readPdfRuns: vi.fn(),
  readFile: vi.fn(),
  replaceExamImportDraft: vi.fn(),
  scannedPdfTranscriptionsToSourceRuns: vi.fn(),
  transaction: vi.fn(),
  touchExamImportRunning: vi.fn(),
  uploadBufferToBucket: vi.fn(),
  upsertJobStep: vi.fn(),
  visitScannedPdfPageRasters: vi.fn()
}));

vi.mock('node:fs/promises', () => ({
  readFile: mocks.readFile
}));
vi.mock('isomorphic-dompurify', () => ({
  default: { sanitize: (html: string) => html }
}));
vi.mock('@cio/db/drizzle', () => ({
  db: { transaction: mocks.transaction }
}));
vi.mock('@cio/db/queries/assets', () => ({
  getAssetById: mocks.getAssetById
}));
vi.mock('@cio/db/queries/exam-import', () => ({
  getExamImportById: mocks.getExamImportById,
  getExamImportDraft: mocks.getExamImportDraft,
  markExamImportDraftReady: mocks.markExamImportDraftReady,
  markExamImportRunning: mocks.markExamImportRunning,
  markExamImportWaitingForAi: mocks.markExamImportWaitingForAi,
  recordExamImportAiRegion: mocks.recordExamImportAiRegion,
  replaceExamImportDraft: mocks.replaceExamImportDraft,
  touchExamImportRunning: mocks.touchExamImportRunning
}));
vi.mock('@cio/db/queries/jobs', () => ({
  deleteJobStep: mocks.deleteJobStep,
  getJobStep: mocks.getJobStep,
  listJobStepsByRun: mocks.listJobStepsByRun,
  upsertJobStep: mocks.upsertJobStep
}));
vi.mock('@cio/exam-import/draft/exam-import-pipeline', () => ({
  createValidatedExamImportDraftFromRuns: mocks.createValidatedExamImportDraftFromRuns
}));
vi.mock('@cio/exam-import/document/exam-import-document-capability', () => ({
  inspectExamImportDocument: mocks.inspectExamImportDocument
}));
vi.mock('@cio/exam-import/docx/read-docx-runs', () => ({
  readDocxRuns: mocks.readDocxRuns
}));
vi.mock('@cio/exam-import/pdf/read-pdf-runs', () => ({
  PdfReadError: mocks.PdfReadError,
  readPdfRuns: mocks.readPdfRuns
}));
vi.mock('@cio/exam-import/pdf/read-scanned-pdf-page-rasters', () => ({
  SCANNED_PDF_RASTER_LIMITS: {
    pages: 20,
    pixelsPerPage: 20_000_000,
    totalPixels: 100_000_000
  },
  ScannedPdfRasterError: class ScannedPdfRasterError extends Error {},
  visitScannedPdfPageRasters: mocks.visitScannedPdfPageRasters
}));
vi.mock('@cio/exam-import/pdf/scanned-pdf-transcription', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cio/exam-import/pdf/scanned-pdf-transcription')>();

  return {
    ...actual,
    markExamImportDraftAsAiDerived: mocks.markExamImportDraftAsAiDerived,
    scannedPdfTranscriptionsToSourceRuns: mocks.scannedPdfTranscriptionsToSourceRuns
  };
});
vi.mock('@cio/core/config/upload-limits', () => ({
  getUploadLimits: () => ({ documentBytes: 5 * 1024 * 1024, imageBytes: 5 * 1024 * 1024 })
}));
vi.mock('@cio/core/services/agent/usage', () => ({
  recordTokenUsage: mocks.recordTokenUsage
}));
vi.mock('./ai-region', () => ({
  requestNextExamImportAiRegion: mocks.requestNextExamImportAiRegion
}));
vi.mock('./ai-vision', () => ({
  EXAM_IMPORT_VISION_CONTRACT_VERSION: 1,
  getConfiguredExamImportVisionModel: mocks.getConfiguredExamImportVisionModel,
  requestExamImportVisionPage: mocks.requestExamImportVisionPage
}));
vi.mock('@cio/utils/functions/sanitize', () => ({
  createSanitizeHtmlConfig: () => ({}),
  stripSvgDataUrls: (html: string) => html
}));
vi.mock('../../config/storage', () => ({
  getStorageConfig: () => ({
    bucketDocuments: 'documents',
    bucketMedia: 'media',
    mediaPublicBaseUrl: 'https://media.example.test'
  })
}));
vi.mock('../../utils/storage', () => ({
  ObjectSizeLimitExceededError: class ObjectSizeLimitExceededError extends Error {},
  deleteObjectFromBucket: mocks.deleteObjectFromBucket,
  deleteObjectsByPrefix: mocks.deleteObjectsByPrefix,
  downloadObjectToTempFile: mocks.downloadObjectToTempFile,
  safeUnlink: vi.fn(),
  uploadBufferToBucket: mocks.uploadBufferToBucket
}));

import { cleanupExamImportSourceArtifact, ExamImportTerminalError, processExamImport } from './process';

const payload = {
  importId: '00000000-0000-4000-8000-000000000001',
  organizationId: '00000000-0000-4000-8000-000000000002',
  courseId: '00000000-0000-4000-8000-000000000003'
};
const sourceCheckpoint = {
  version: 1,
  source: {
    assetId: '00000000-0000-4000-8000-000000000004',
    fileName: 'exam.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extractor: 'docx'
  },
  runs: [
    {
      text: 'Question 1',
      formatting: {
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        color: null,
        highlight: null
      },
      block: {
        kind: 'paragraph',
        index: 0,
        listNumber: null,
        tableRef: null
      },
      math: null,
      image: null,
      location: {
        blockIndex: 0,
        runIndex: 0
      }
    }
  ],
  draft: null,
  warnings: [],
  embeddedAssets: []
} as const;

function sourceArtifact() {
  const compressed = gzipSync(Buffer.from(JSON.stringify(sourceCheckpoint)));

  return {
    compressed,
    pointer: {
      version: 1,
      key: `exam-import/checkpoints/${payload.organizationId}/${payload.importId}/source-v1.json.gz`,
      byteSize: compressed.byteLength,
      sha256: createHash('sha256').update(compressed).digest('hex')
    }
  };
}

function configureSinglePageScannedPdfImport(): string {
  const actorProfileId = '00000000-0000-4000-8000-000000000005';
  mocks.getExamImportById.mockResolvedValue({
    id: payload.importId,
    organizationId: payload.organizationId,
    courseId: payload.courseId,
    actorProfileId,
    sourceAssetId: sourceCheckpoint.source.assetId,
    status: 'running',
    extractor: 'pdf',
    aiCursor: 0,
    aiRegionAudit: []
  });
  mocks.getAssetById.mockResolvedValue({
    id: sourceCheckpoint.source.assetId,
    organizationId: payload.organizationId,
    kind: 'document',
    provider: 'upload',
    status: 'active',
    isExternal: false,
    storageKey: 'uploads/exam.pdf',
    byteSize: 100,
    title: 'exam.pdf'
  });
  mocks.readFile.mockResolvedValue(new TextEncoder().encode('%PDF-1.7'));
  mocks.inspectExamImportDocument.mockResolvedValue({
    supported: true,
    detectedType: 'pdf',
    reason: null
  });
  mocks.readPdfRuns.mockRejectedValue(new mocks.PdfReadError('NO_TEXT_LAYER', 1, 0));
  mocks.visitScannedPdfPageRasters.mockImplementation(
    async (
      _bytes: Uint8Array,
      visitPage: (page: {
        assetRef: string;
        pageIndex: number;
        bounds: { x: number; y: number; width: number; height: number };
        intrinsicWidth: number;
        intrinsicHeight: number;
        pixels: Uint8Array;
        pixelFormat: 'rgb-24bpp';
      }) => Promise<void>
    ) => {
      await visitPage({
        assetRef: 'pdf-page-raster-0',
        pageIndex: 0,
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        intrinsicWidth: 1,
        intrinsicHeight: 1,
        pixels: new Uint8Array([127, 127, 127]),
        pixelFormat: 'rgb-24bpp'
      });

      return { pageCount: 1, totalPixels: 1 };
    }
  );

  return actorProfileId;
}

describe('processExamImport checkpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (tx: object) => Promise<unknown>) => callback({}));
    mocks.getExamImportById.mockResolvedValue({
      id: payload.importId,
      organizationId: payload.organizationId,
      courseId: payload.courseId,
      sourceAssetId: sourceCheckpoint.source.assetId,
      status: 'running',
      extractor: 'docx'
    });
    mocks.markExamImportDraftReady.mockResolvedValue({ id: payload.importId, status: 'draft_ready' });
    mocks.markExamImportWaitingForAi.mockResolvedValue({ id: payload.importId, status: 'waiting_for_ai' });
    mocks.markExamImportDraftAsAiDerived.mockImplementation((draft: unknown) => draft);
    mocks.scannedPdfTranscriptionsToSourceRuns.mockReturnValue(sourceCheckpoint.runs);
    mocks.requestNextExamImportAiRegion.mockResolvedValue({ kind: 'disabled' });
    mocks.requestExamImportVisionPage.mockResolvedValue({ kind: 'disabled', reason: 'global_disabled' });
    mocks.getConfiguredExamImportVisionModel.mockReturnValue('claude-opus-5');
    mocks.getExamImportDraft.mockResolvedValue(null);
    mocks.touchExamImportRunning.mockResolvedValue(true);
    mocks.replaceExamImportDraft.mockResolvedValue({ importId: payload.importId });
    mocks.downloadObjectToTempFile.mockResolvedValue('/tmp/exam-import-source-checkpoint.json.gz');
    mocks.deleteObjectFromBucket.mockResolvedValue(undefined);
    mocks.deleteObjectsByPrefix.mockResolvedValue(undefined);
    mocks.deleteJobStep.mockResolvedValue(true);
    mocks.listJobStepsByRun.mockResolvedValue([]);
    mocks.upsertJobStep.mockImplementation(async (input: { result?: Record<string, unknown> }) => input);
  });

  it('resumes from the source artifact without downloading or extracting the DOCX again', async () => {
    const artifact = sourceArtifact();
    mocks.readFile.mockResolvedValue(artifact.compressed);
    mocks.getJobStep.mockImplementation(async (_domain: string, _runId: string, stepKey: string) => {
      if (stepKey === 'source') {
        return { status: 'completed', result: artifact.pointer };
      }

      return null;
    });
    mocks.createValidatedExamImportDraftFromRuns.mockReturnValue({
      draft: { schemaVersion: 1, sections: [] },
      findings: []
    });

    await expect(processExamImport(payload)).resolves.toMatchObject({
      status: 'draft_ready',
      questionCount: 0
    });
    expect(mocks.getAssetById).not.toHaveBeenCalled();
    expect(mocks.readDocxRuns).not.toHaveBeenCalled();
    expect(mocks.replaceExamImportDraft).toHaveBeenCalledOnce();
  });

  it('checkpoints the deterministic draft without invoking optional AI assistance', async () => {
    const artifact = sourceArtifact();
    mocks.readFile.mockResolvedValue(artifact.compressed);
    mocks.getExamImportById.mockResolvedValue({
      id: payload.importId,
      organizationId: payload.organizationId,
      courseId: payload.courseId,
      actorProfileId: '00000000-0000-4000-8000-000000000005',
      sourceAssetId: sourceCheckpoint.source.assetId,
      status: 'running',
      extractor: 'docx',
      aiCursor: 0,
      aiRegionAudit: []
    });
    mocks.getJobStep.mockImplementation(async (_domain: string, _runId: string, stepKey: string) => {
      if (stepKey === 'source') {
        return { status: 'completed', result: artifact.pointer };
      }

      return null;
    });
    mocks.createValidatedExamImportDraftFromRuns.mockReturnValue({
      draft: { schemaVersion: 1, sections: [] },
      findings: []
    });
    mocks.requestNextExamImportAiRegion.mockResolvedValue({ kind: 'waiting' });

    await expect(processExamImport(payload)).resolves.toMatchObject({ status: 'draft_ready' });
    expect(mocks.replaceExamImportDraft).toHaveBeenCalledOnce();
    expect(mocks.requestNextExamImportAiRegion).not.toHaveBeenCalled();
    expect(mocks.markExamImportWaitingForAi).not.toHaveBeenCalled();
    expect(mocks.markExamImportDraftReady).toHaveBeenCalledOnce();
  });

  it('does not use AI capacity state when finalizing the deterministic draft', async () => {
    const artifact = sourceArtifact();
    mocks.readFile.mockResolvedValue(artifact.compressed);
    mocks.getExamImportById.mockResolvedValue({
      id: payload.importId,
      organizationId: payload.organizationId,
      courseId: payload.courseId,
      actorProfileId: '00000000-0000-4000-8000-000000000005',
      sourceAssetId: sourceCheckpoint.source.assetId,
      status: 'running',
      extractor: 'docx',
      startedAt: new Date(Date.now() - 16 * 60 * 1_000).toISOString(),
      aiCursor: 0,
      aiRegionAudit: []
    });
    mocks.getJobStep.mockImplementation(async (_domain: string, _runId: string, stepKey: string) => {
      if (stepKey === 'source') {
        return { status: 'completed', result: artifact.pointer };
      }

      return null;
    });
    mocks.createValidatedExamImportDraftFromRuns.mockReturnValue({
      draft: { schemaVersion: 1, sections: [] },
      findings: []
    });
    mocks.requestNextExamImportAiRegion.mockResolvedValue({ kind: 'waiting' });

    await expect(processExamImport(payload)).resolves.toMatchObject({ status: 'draft_ready' });
    expect(mocks.requestNextExamImportAiRegion).not.toHaveBeenCalled();
    expect(mocks.markExamImportDraftReady).toHaveBeenCalledOnce();
    expect(mocks.markExamImportWaitingForAi).not.toHaveBeenCalled();
  });

  it('records a machine-readable failed step and writes no partial draft', async () => {
    const artifact = sourceArtifact();
    mocks.readFile.mockResolvedValue(artifact.compressed);
    mocks.getJobStep.mockImplementation(async (_domain: string, _runId: string, stepKey: string) => {
      if (stepKey === 'source') {
        return { status: 'completed', result: artifact.pointer };
      }

      return null;
    });
    mocks.createValidatedExamImportDraftFromRuns.mockReturnValue({
      draft: null,
      findings: [
        {
          code: 'QUESTION_INVALID',
          blocking: true,
          severity: 'error'
        }
      ]
    });

    const failure = await processExamImport(payload).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ExamImportTerminalError);
    expect(failure).toMatchObject({
      failure: { code: 'EXAM_IMPORT_DRAFT_INVALID' }
    });
    expect(mocks.replaceExamImportDraft).not.toHaveBeenCalled();
    expect(mocks.markExamImportDraftReady).not.toHaveBeenCalled();
    expect(mocks.upsertJobStep).toHaveBeenCalledWith(
      expect.objectContaining({
        stepKey: 'draft',
        status: 'failed',
        error: expect.objectContaining({ code: 'EXAM_IMPORT_DRAFT_INVALID' })
      })
    );
  });

  it('persists embedded images and passes public URLs into draft extraction', async () => {
    const imageBytes = new Uint8Array([1, 2, 3, 4]);
    const imageRun = {
      ...sourceCheckpoint.runs[0],
      text: '',
      image: {
        assetRef: 'docx:word/media/image1.png',
        width: 320,
        height: 180,
        placement: 'inline' as const
      }
    };
    mocks.getExamImportById.mockResolvedValue({
      id: payload.importId,
      organizationId: payload.organizationId,
      courseId: payload.courseId,
      sourceAssetId: sourceCheckpoint.source.assetId,
      status: 'queued',
      extractor: 'docx'
    });
    mocks.markExamImportRunning.mockResolvedValue({
      id: payload.importId,
      organizationId: payload.organizationId,
      courseId: payload.courseId,
      sourceAssetId: sourceCheckpoint.source.assetId,
      status: 'running',
      extractor: 'docx'
    });
    mocks.getJobStep.mockResolvedValue(null);
    mocks.getAssetById.mockResolvedValue({
      id: sourceCheckpoint.source.assetId,
      organizationId: payload.organizationId,
      kind: 'document',
      provider: 'upload',
      status: 'active',
      isExternal: false,
      storageKey: 'uploads/exam.docx',
      byteSize: 100,
      title: 'exam.docx'
    });
    mocks.readFile.mockResolvedValue(new Uint8Array([80, 75, 3, 4]));
    mocks.inspectExamImportDocument.mockResolvedValue({
      supported: true,
      detectedType: 'docx',
      reason: null
    });
    mocks.readDocxRuns.mockResolvedValue({
      runs: [imageRun],
      warnings: [],
      assets: [
        {
          ref: 'docx:word/media/image1.png',
          packagePath: 'word/media/image1.png',
          mimeType: 'image/png',
          bytes: imageBytes
        }
      ]
    });
    mocks.createValidatedExamImportDraftFromRuns.mockReturnValue({
      draft: { schemaVersion: 1, sections: [] },
      findings: []
    });

    await expect(processExamImport(payload)).resolves.toMatchObject({ status: 'draft_ready' });

    const expectedDigest = createHash('sha256').update(imageBytes).digest('hex');
    const expectedStorageKey = `exam-import/${payload.organizationId}/${payload.importId}/${expectedDigest}.png`;
    expect(mocks.uploadBufferToBucket).toHaveBeenCalledWith(
      'media',
      expectedStorageKey,
      Buffer.from(imageBytes),
      'image/png',
      'public, max-age=31536000, immutable'
    );
    expect(mocks.createValidatedExamImportDraftFromRuns).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          image: expect.objectContaining({
            assetRef: `https://media.example.test/${expectedStorageKey}`
          })
        })
      ],
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('stops after extraction when the import was canceled concurrently', async () => {
    const artifact = sourceArtifact();
    mocks.readFile.mockResolvedValue(artifact.compressed);
    mocks.getExamImportById
      .mockResolvedValueOnce({
        id: payload.importId,
        organizationId: payload.organizationId,
        courseId: payload.courseId,
        sourceAssetId: sourceCheckpoint.source.assetId,
        status: 'running',
        extractor: 'docx'
      })
      .mockResolvedValueOnce({
        id: payload.importId,
        organizationId: payload.organizationId,
        courseId: payload.courseId,
        sourceAssetId: sourceCheckpoint.source.assetId,
        status: 'canceled',
        extractor: 'docx',
        sectionCount: 0,
        questionCount: 0,
        reviewRequiredCount: 0,
        blockingIssueCount: 0,
        warningCount: 0
      });
    mocks.getJobStep.mockImplementation(async (_domain: string, _runId: string, stepKey: string) => {
      if (stepKey === 'source') {
        return { status: 'completed', result: artifact.pointer };
      }

      return null;
    });

    await expect(processExamImport(payload)).resolves.toMatchObject({ status: 'canceled' });
    expect(mocks.createValidatedExamImportDraftFromRuns).not.toHaveBeenCalled();
    expect(mocks.replaceExamImportDraft).not.toHaveBeenCalled();
    expect(mocks.deleteObjectFromBucket).toHaveBeenCalledWith('documents', artifact.pointer.key);
  });

  it('removes persisted embedded images and the source checkpoint after terminal failure', async () => {
    const embeddedStorageKey = `exam-import/${payload.organizationId}/${payload.importId}/image.png`;
    const checkpoint = {
      ...sourceCheckpoint,
      embeddedAssets: [
        {
          sourceRef: 'docx:word/media/image1.png',
          storageKey: embeddedStorageKey,
          publicUrl: `https://media.example.test/${embeddedStorageKey}`
        }
      ]
    };
    const compressed = gzipSync(Buffer.from(JSON.stringify(checkpoint)));
    const pointer = {
      version: 1,
      key: `exam-import/checkpoints/${payload.organizationId}/${payload.importId}/source-v1.json.gz`,
      byteSize: compressed.byteLength,
      sha256: createHash('sha256').update(compressed).digest('hex')
    };
    mocks.getJobStep.mockResolvedValue({ status: 'completed', result: pointer });
    mocks.listJobStepsByRun.mockResolvedValue([
      { stepKey: 'source' },
      { stepKey: 'vision-config' },
      { stepKey: 'vision-page-0' },
      { stepKey: 'vision-page-1' }
    ]);
    mocks.readFile.mockResolvedValue(compressed);

    await cleanupExamImportSourceArtifact(payload.importId, true);

    expect(mocks.deleteObjectFromBucket).toHaveBeenCalledWith('media', embeddedStorageKey);
    expect(mocks.deleteObjectFromBucket).toHaveBeenCalledWith('documents', pointer.key);
    expect(mocks.deleteJobStep).toHaveBeenCalledWith('exam-import', payload.importId, 'vision-config');
    expect(mocks.deleteJobStep).toHaveBeenCalledWith('exam-import', payload.importId, 'vision-page-0');
    expect(mocks.deleteJobStep).toHaveBeenCalledWith('exam-import', payload.importId, 'vision-page-1');
  });

  it('rolls back images uploaded before a later embedded image fails validation', async () => {
    const validImageBytes = new Uint8Array([1, 2, 3, 4]);
    mocks.getExamImportById.mockResolvedValue({
      id: payload.importId,
      organizationId: payload.organizationId,
      courseId: payload.courseId,
      sourceAssetId: sourceCheckpoint.source.assetId,
      status: 'running',
      extractor: 'docx'
    });
    mocks.getJobStep.mockResolvedValue(null);
    mocks.getAssetById.mockResolvedValue({
      id: sourceCheckpoint.source.assetId,
      organizationId: payload.organizationId,
      kind: 'document',
      provider: 'upload',
      status: 'active',
      isExternal: false,
      storageKey: 'uploads/exam.docx',
      byteSize: 100,
      title: 'exam.docx'
    });
    mocks.readFile.mockResolvedValue(new Uint8Array([80, 75, 3, 4]));
    mocks.inspectExamImportDocument.mockResolvedValue({
      supported: true,
      detectedType: 'docx',
      reason: null
    });
    mocks.readDocxRuns.mockResolvedValue({
      runs: [],
      warnings: [],
      assets: [
        {
          ref: 'docx:word/media/image1.png',
          packagePath: 'word/media/image1.png',
          mimeType: 'image/png',
          bytes: validImageBytes
        },
        {
          ref: 'docx:word/media/image2.svg',
          packagePath: 'word/media/image2.svg',
          mimeType: 'image/svg+xml',
          bytes: validImageBytes
        }
      ]
    });

    await expect(processExamImport(payload)).rejects.toMatchObject({
      failure: { code: 'EXAM_IMPORT_EMBEDDED_IMAGE_TYPE_UNSUPPORTED' }
    });

    const expectedDigest = createHash('sha256').update(validImageBytes).digest('hex');
    expect(mocks.deleteObjectFromBucket).toHaveBeenCalledWith(
      'media',
      `exam-import/${payload.organizationId}/${payload.importId}/${expectedDigest}.png`
    );
    expect(mocks.deleteObjectsByPrefix).toHaveBeenCalledWith(
      'media',
      `exam-import/${payload.organizationId}/${payload.importId}/`
    );
  });

  it('fails closed with a machine-readable code when scanned PDF AI is disabled', async () => {
    mocks.getExamImportById.mockResolvedValue({
      id: payload.importId,
      organizationId: payload.organizationId,
      courseId: payload.courseId,
      actorProfileId: '00000000-0000-4000-8000-000000000005',
      sourceAssetId: sourceCheckpoint.source.assetId,
      status: 'running',
      extractor: 'pdf'
    });
    mocks.getJobStep.mockResolvedValue(null);
    mocks.getAssetById.mockResolvedValue({
      id: sourceCheckpoint.source.assetId,
      organizationId: payload.organizationId,
      kind: 'document',
      provider: 'upload',
      status: 'active',
      isExternal: false,
      storageKey: 'uploads/exam.pdf',
      byteSize: 100,
      title: 'exam.pdf'
    });
    mocks.readFile.mockResolvedValue(new TextEncoder().encode('%PDF-1.7'));
    mocks.inspectExamImportDocument.mockResolvedValue({
      supported: true,
      detectedType: 'pdf',
      reason: null
    });
    mocks.readPdfRuns.mockRejectedValue(new mocks.PdfReadError('NO_TEXT_LAYER', 5, 0));
    mocks.visitScannedPdfPageRasters.mockImplementation(
      async (
        _bytes: Uint8Array,
        visitPage: (page: {
          assetRef: string;
          pageIndex: number;
          bounds: { x: number; y: number; width: number; height: number };
          intrinsicWidth: number;
          intrinsicHeight: number;
          pixels: Uint8Array;
          pixelFormat: 'rgb-24bpp';
        }) => Promise<void>
      ) => {
        await visitPage({
          assetRef: 'pdf-page-raster-0',
          pageIndex: 0,
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          intrinsicWidth: 1,
          intrinsicHeight: 1,
          pixels: new Uint8Array([127, 127, 127]),
          pixelFormat: 'rgb-24bpp'
        });

        return { pageCount: 1, totalPixels: 1 };
      }
    );

    await expect(processExamImport(payload)).rejects.toMatchObject({
      failure: {
        code: 'EXAM_IMPORT_SCAN_AI_DISABLED'
      }
    });
    expect(mocks.readDocxRuns).not.toHaveBeenCalled();
    expect(mocks.requestExamImportVisionPage).toHaveBeenCalledOnce();
    expect(mocks.replaceExamImportDraft).not.toHaveBeenCalled();
  });

  it('checkpoints each scanned page, records usage, and marks the extracted draft as AI-derived', async () => {
    const actorProfileId = '00000000-0000-4000-8000-000000000005';
    mocks.getExamImportById.mockResolvedValue({
      id: payload.importId,
      organizationId: payload.organizationId,
      courseId: payload.courseId,
      actorProfileId,
      sourceAssetId: sourceCheckpoint.source.assetId,
      status: 'running',
      extractor: 'pdf',
      aiCursor: 0,
      aiRegionAudit: []
    });
    mocks.getJobStep.mockResolvedValue(null);
    mocks.getAssetById.mockResolvedValue({
      id: sourceCheckpoint.source.assetId,
      organizationId: payload.organizationId,
      kind: 'document',
      provider: 'upload',
      status: 'active',
      isExternal: false,
      storageKey: 'uploads/exam.pdf',
      byteSize: 100,
      title: 'exam.pdf'
    });
    mocks.readFile.mockResolvedValue(new TextEncoder().encode('%PDF-1.7'));
    mocks.inspectExamImportDocument.mockResolvedValue({
      supported: true,
      detectedType: 'pdf',
      reason: null
    });
    mocks.readPdfRuns.mockRejectedValue(new mocks.PdfReadError('NO_TEXT_LAYER', 1, 0));
    mocks.visitScannedPdfPageRasters.mockImplementation(
      async (
        _bytes: Uint8Array,
        visitPage: (page: {
          assetRef: string;
          pageIndex: number;
          bounds: { x: number; y: number; width: number; height: number };
          intrinsicWidth: number;
          intrinsicHeight: number;
          pixels: Uint8Array;
          pixelFormat: 'rgb-24bpp';
        }) => Promise<void>
      ) => {
        await visitPage({
          assetRef: 'pdf-page-raster-0',
          pageIndex: 0,
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          intrinsicWidth: 1,
          intrinsicHeight: 1,
          pixels: new Uint8Array([127, 127, 127]),
          pixelFormat: 'rgb-24bpp'
        });
        await visitPage({
          assetRef: 'pdf-page-raster-1',
          pageIndex: 1,
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          intrinsicWidth: 1,
          intrinsicHeight: 1,
          pixels: new Uint8Array([128, 128, 128]),
          pixelFormat: 'rgb-24bpp'
        });

        return { pageCount: 2, totalPixels: 2 };
      }
    );
    mocks.requestExamImportVisionPage.mockImplementation(async (input: { pageIndex: number; model?: string }) => ({
      kind: 'attempted',
      response: {
        pageIndex: input.pageIndex,
        lines: [`Question ${input.pageIndex + 1}. Choose.`, 'A. First', 'B. Second']
      },
      requestHash: (input.pageIndex === 0 ? 'a' : 'b').repeat(64),
      sentAt: '2026-07-27T00:00:00.000Z',
      model: 'claude-opus-5',
      quotaMultiplier: 30,
      promptTokens: 300,
      completionTokens: 80,
      transportAvailable: true
    }));
    mocks.createValidatedExamImportDraftFromRuns.mockReturnValue({
      draft: {
        schemaVersion: 1,
        source: {
          assetId: sourceCheckpoint.source.assetId,
          fileName: 'exam.pdf',
          mimeType: 'application/pdf',
          extractor: 'pdf'
        },
        title: 'Scanned exam',
        fieldStates: [],
        sharedContents: [],
        sections: [{ id: 'section-1', title: 'Questions', order: 0, questions: [] }],
        diagnostics: []
      },
      findings: [],
      publishable: true
    });

    await expect(processExamImport(payload)).resolves.toMatchObject({
      status: 'draft_ready',
      questionCount: 0
    });

    expect(mocks.recordTokenUsage).toHaveBeenCalledWith(
      payload.organizationId,
      actorProfileId,
      payload.courseId,
      { promptTokens: 300, completionTokens: 80, totalTokens: 380 },
      'claude-opus-5',
      expect.objectContaining({
        workloadDomain: 'exam_import',
        workloadId: payload.importId,
        idempotencyKey: `${payload.importId}:${'a'.repeat(64)}`,
        quotaMultiplier: 30
      })
    );
    expect(mocks.upsertJobStep).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'exam-import',
        runId: payload.importId,
        stepKey: 'vision-config',
        status: 'completed',
        providerId: 'claude-opus-5',
        result: {
          version: 1,
          contractVersion: 1,
          model: 'claude-opus-5'
        }
      })
    );
    expect(mocks.upsertJobStep).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'exam-import',
        runId: payload.importId,
        stepKey: 'vision-page-0',
        status: 'completed',
        providerId: 'claude-opus-5',
        result: expect.objectContaining({ contractVersion: 1 })
      })
    );
    expect(mocks.requestExamImportVisionPage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ pageIndex: 0, model: 'claude-opus-5', contractVersion: 1 })
    );
    expect(mocks.requestExamImportVisionPage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ pageIndex: 1, model: 'claude-opus-5', contractVersion: 1 })
    );
    expect(mocks.scannedPdfTranscriptionsToSourceRuns).toHaveBeenCalledWith([
      {
        pageIndex: 0,
        lines: ['Question 1. Choose.', 'A. First', 'B. Second']
      },
      {
        pageIndex: 1,
        lines: ['Question 2. Choose.', 'A. First', 'B. Second']
      }
    ]);
    expect(mocks.markExamImportDraftAsAiDerived).toHaveBeenCalledOnce();
  });

  it('records billed usage before rejecting an invalid scanned-page transcription', async () => {
    const actorProfileId = configureSinglePageScannedPdfImport();
    mocks.getJobStep.mockResolvedValue(null);
    mocks.requestExamImportVisionPage.mockResolvedValue({
      kind: 'attempted',
      response: null,
      requestHash: 'c'.repeat(64),
      sentAt: '2026-07-27T00:00:00.000Z',
      model: 'claude-opus-5',
      quotaMultiplier: 30,
      promptTokens: 250,
      completionTokens: 40,
      transportAvailable: true
    });

    await expect(processExamImport(payload)).rejects.toMatchObject({
      failure: { code: 'EXAM_IMPORT_SCAN_TRANSCRIPTION_INVALID' }
    });
    expect(mocks.recordTokenUsage).toHaveBeenCalledWith(
      payload.organizationId,
      actorProfileId,
      payload.courseId,
      { promptTokens: 250, completionTokens: 40, totalTokens: 290 },
      'claude-opus-5',
      expect.objectContaining({
        idempotencyKey: `${payload.importId}:${'c'.repeat(64)}`,
        quotaMultiplier: 30
      })
    );
    expect(mocks.replaceExamImportDraft).not.toHaveBeenCalled();
  });

  it('fails closed before the gateway when a completed page checkpoint does not match the source', async () => {
    configureSinglePageScannedPdfImport();
    mocks.getJobStep.mockImplementation(async (_domain: string, _runId: string, stepKey: string) => {
      if (stepKey === 'vision-config') {
        return {
          status: 'completed',
          result: {
            version: 1,
            contractVersion: 1,
            model: 'claude-opus-5'
          }
        };
      }
      if (stepKey === 'vision-page-0') {
        return {
          status: 'completed',
          result: {
            version: 1,
            contractVersion: 1,
            page: { pageIndex: 0, lines: ['Question 1'] },
            imageSha256: '0'.repeat(64),
            requestHash: 'a'.repeat(64),
            model: 'claude-opus-5'
          }
        };
      }

      return null;
    });

    await expect(processExamImport(payload)).rejects.toMatchObject({
      failure: { code: 'EXAM_IMPORT_SCAN_CHECKPOINT_INVALID' }
    });
    expect(mocks.requestExamImportVisionPage).not.toHaveBeenCalled();
    expect(mocks.replaceExamImportDraft).not.toHaveBeenCalled();
  });

  it.each([
    {
      extractor: 'aiken' as const,
      fileName: 'exam.aiken',
      content: ['Which number is prime?', 'A. 4', 'B. 5', 'C. 6', 'D. 8', 'ANSWER: B'].join('\n'),
      expectedPrompt: '<p>Which number is prime?</p>'
    },
    {
      extractor: 'gift' as const,
      fileName: 'exam.gift',
      content: '::Prime::Which number is prime? {~4 =5 ~6 ~8}',
      expectedPrompt: '<p>Which number is prime?</p>'
    }
  ])('persists a validated $extractor draft without invoking the run segmenter', async (fixture) => {
    mocks.getExamImportById.mockResolvedValue({
      id: payload.importId,
      organizationId: payload.organizationId,
      courseId: payload.courseId,
      sourceAssetId: sourceCheckpoint.source.assetId,
      status: 'running',
      extractor: fixture.extractor
    });
    mocks.getJobStep.mockResolvedValue(null);
    mocks.getAssetById.mockResolvedValue({
      id: sourceCheckpoint.source.assetId,
      organizationId: payload.organizationId,
      kind: 'document',
      provider: 'upload',
      status: 'active',
      isExternal: false,
      storageKey: `uploads/${fixture.fileName}`,
      byteSize: fixture.content.length,
      title: fixture.fileName
    });
    mocks.readFile.mockResolvedValue(new TextEncoder().encode(fixture.content));
    mocks.inspectExamImportDocument.mockResolvedValue({
      supported: true,
      detectedType: fixture.extractor,
      reason: null
    });

    await expect(processExamImport(payload)).resolves.toMatchObject({
      status: 'draft_ready',
      questionCount: 1
    });

    expect(mocks.createValidatedExamImportDraftFromRuns).not.toHaveBeenCalled();
    expect(mocks.replaceExamImportDraft).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({
        draft: expect.objectContaining({
          source: expect.objectContaining({ extractor: fixture.extractor }),
          sections: [
            expect.objectContaining({
              questions: [expect.objectContaining({ promptHtml: fixture.expectedPrompt })]
            })
          ]
        })
      }),
      expect.any(Object)
    );
  });

  it('fails a malformed Aiken source with line-referenced diagnostics and no draft', async () => {
    const content = ['Which number is prime?', 'A. 4', 'B. 5', 'ANSWER: B'].join('\n');
    mocks.getExamImportById.mockResolvedValue({
      id: payload.importId,
      organizationId: payload.organizationId,
      courseId: payload.courseId,
      sourceAssetId: sourceCheckpoint.source.assetId,
      status: 'running',
      extractor: 'aiken'
    });
    mocks.getJobStep.mockResolvedValue(null);
    mocks.getAssetById.mockResolvedValue({
      id: sourceCheckpoint.source.assetId,
      organizationId: payload.organizationId,
      kind: 'document',
      provider: 'upload',
      status: 'active',
      isExternal: false,
      storageKey: 'uploads/exam.aiken',
      byteSize: content.length,
      title: 'exam.aiken'
    });
    mocks.readFile.mockResolvedValue(new TextEncoder().encode(content));
    mocks.inspectExamImportDocument.mockResolvedValue({
      supported: true,
      detectedType: 'aiken',
      reason: null
    });

    await expect(processExamImport(payload)).rejects.toMatchObject({
      failure: {
        code: 'EXAM_IMPORT_AIKEN_INVALID',
        details: {
          diagnostics: expect.arrayContaining([
            expect.objectContaining({ code: 'MISSING_OPTION', line: expect.any(Number), column: expect.any(Number) })
          ])
        }
      }
    });
    expect(mocks.replaceExamImportDraft).not.toHaveBeenCalled();
  });

  it('encodes extracted PDF pixels as PNG before creating the draft', async () => {
    const imageRef = 'pdf-image-0-0';
    mocks.getExamImportById.mockResolvedValue({
      id: payload.importId,
      organizationId: payload.organizationId,
      courseId: payload.courseId,
      sourceAssetId: sourceCheckpoint.source.assetId,
      status: 'running',
      extractor: 'pdf'
    });
    mocks.getJobStep.mockResolvedValue(null);
    mocks.getAssetById.mockResolvedValue({
      id: sourceCheckpoint.source.assetId,
      organizationId: payload.organizationId,
      kind: 'document',
      provider: 'upload',
      status: 'active',
      isExternal: false,
      storageKey: 'uploads/exam.pdf',
      byteSize: 100,
      title: 'exam.pdf'
    });
    mocks.readFile.mockResolvedValue(new TextEncoder().encode('%PDF-1.7'));
    mocks.inspectExamImportDocument.mockResolvedValue({
      supported: true,
      detectedType: 'pdf',
      reason: null
    });
    mocks.readPdfRuns.mockResolvedValue({
      runs: [
        {
          ...sourceCheckpoint.runs[0],
          text: '',
          image: {
            assetRef: imageRef,
            width: 1,
            height: 1,
            placement: 'floating'
          }
        }
      ],
      assets: [
        {
          assetRef: imageRef,
          pageIndex: 0,
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          intrinsicWidth: 1,
          intrinsicHeight: 1,
          pixels: new Uint8Array([255, 0, 0]),
          pixelFormat: 'rgb-24bpp'
        }
      ],
      weakEmphasis: [],
      warnings: [],
      pageCount: 1
    });
    mocks.createValidatedExamImportDraftFromRuns.mockReturnValue({
      draft: { schemaVersion: 1, sections: [] },
      findings: []
    });

    await expect(processExamImport(payload)).resolves.toMatchObject({ status: 'draft_ready' });

    const mediaUpload = mocks.uploadBufferToBucket.mock.calls.find((call) => call[0] === 'media');
    expect(mediaUpload?.[2]).toBeInstanceOf(Buffer);
    expect((mediaUpload?.[2] as Buffer).subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    expect(mocks.createValidatedExamImportDraftFromRuns).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          image: expect.objectContaining({
            assetRef: expect.stringMatching(/^https:\/\/media\.example\.test\/exam-import\//u)
          })
        })
      ],
      expect.objectContaining({ extractor: 'pdf', mimeType: 'application/pdf' }),
      expect.any(Object)
    );
  });
});
