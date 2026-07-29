import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';

import { UnrecoverableError } from 'bullmq';
import DOMPurify from 'isomorphic-dompurify';
import { PNG } from 'pngjs';
import * as z from 'zod';

import { db } from '@cio/db/drizzle';
import { getAssetById } from '@cio/db/queries/assets';
import {
  getExamImportById,
  getExamImportDraft,
  markExamImportDraftReady,
  markExamImportRunning,
  markExamImportWaitingForAi,
  recordExamImportAiRegion,
  replaceExamImportDraft,
  touchExamImportRunning
} from '@cio/db/queries/exam-import';
import type { TExamImport } from '@cio/db/types';
import { deleteJobStep, getJobStep, listJobStepsByRun, upsertJobStep } from '@cio/db/queries/jobs';
import {
  inspectExamImportDocument,
  type ExamImportDocumentInspection
} from '@cio/exam-import/document/exam-import-document-capability';
import {
  EXAM_IMPORT_PUBLISHABLE_QUESTION_KINDS,
  examImportDraftSchema,
  type ExamImportDraft
} from '@cio/exam-import/draft/exam-import-draft';
import {
  applyExamImportAiRegionResponse,
  collectExamImportAiRegions
} from '@cio/exam-import/draft/exam-import-ai-regions';
import { createValidatedExamImportDraftFromRuns } from '@cio/exam-import/draft/exam-import-pipeline';
import { validateExamImportDraft } from '@cio/exam-import/draft/exam-import-validation';
import { readDocxRuns, type DocxReadResult } from '@cio/exam-import/docx/read-docx-runs';
import { AikenParseError, parseAiken } from '@cio/exam-import/interchange/aiken';
import { parseGift } from '@cio/exam-import/interchange/gift';
import { PdfReadError, readPdfRuns, type PdfReadResult } from '@cio/exam-import/pdf/read-pdf-runs';
import type { PdfEmbeddedImage } from '@cio/exam-import/pdf/pdf-operators';
import {
  SCANNED_PDF_RASTER_LIMITS,
  ScannedPdfRasterError,
  visitScannedPdfPageRasters
} from '@cio/exam-import/pdf/read-scanned-pdf-page-rasters';
import {
  markExamImportDraftAsAiDerived,
  scannedPdfPageTranscriptionSchema,
  scannedPdfTranscriptionsToSourceRuns,
  type ScannedPdfPageTranscription
} from '@cio/exam-import/pdf/scanned-pdf-transcription';
import { sourceRunStreamSchema, type SourceRun } from '@cio/exam-import/source-run';
import { getUploadLimits } from '@cio/core/config/upload-limits';
import { recordTokenUsage } from '@cio/core/services/agent/usage';
import { ZExamImportPayload, type TExamImportPayload } from '@cio/jobs/payloads/exam-import';
import { createSanitizeHtmlConfig, stripSvgDataUrls } from '@cio/utils/functions/sanitize';
import { ALLOWED_IMAGE_TYPES } from '@cio/utils/validation';

import { errorMessage } from '../../utils/cancel';
import { log } from '../../utils/logger';
import {
  ObjectSizeLimitExceededError,
  deleteObjectFromBucket,
  deleteObjectsByPrefix,
  downloadObjectToTempFile,
  safeUnlink,
  uploadBufferToBucket
} from '../../utils/storage';
import { getStorageConfig } from '../../config/storage';
import { requestNextExamImportAiRegion } from './ai-region';
import {
  EXAM_IMPORT_VISION_CONTRACT_VERSION,
  getConfiguredExamImportVisionModel,
  requestExamImportVisionPage
} from './ai-vision';

const DOMAIN = 'exam-import';
const SOURCE_STEP_KEY = 'source';
const DRAFT_STEP_KEY = 'draft';
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME_TYPE = 'application/pdf';
const TEXT_MIME_TYPE = 'text/plain; charset=utf-8';
const DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_SOURCE_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAX_SOURCE_ARTIFACT_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
const MAX_EMBEDDED_ASSETS = 2_000;
const HEARTBEAT_INTERVAL_MS = 60_000;
const MAX_AI_CAPACITY_WAIT_MS = 15 * 60 * 1_000;
const VISION_STEP_PREFIX = 'vision-';
const VISION_CONFIG_STEP_KEY = `${VISION_STEP_PREFIX}config`;
const VISION_PAGE_STEP_PREFIX = `${VISION_STEP_PREFIX}page-`;
const gzipBuffer = promisify(gzip);
const gunzipBuffer = promisify(gunzip);

const ZPersistedEmbeddedAsset = z.strictObject({
  sourceRef: z.string().min(1).max(2_048),
  storageKey: z.string().min(1).max(1_000),
  publicUrl: z.string().url().max(2_048)
});

const ZSourceCheckpoint = z.strictObject({
  version: z.literal(1),
  aiTranscribed: z.boolean().default(false),
  source: z.strictObject({
    assetId: z.string().min(1).max(200),
    fileName: z.string().min(1).max(500),
    mimeType: z.string().min(1).max(200),
    extractor: z.enum(['docx', 'pdf', 'aiken', 'gift'])
  }),
  runs: sourceRunStreamSchema,
  draft: examImportDraftSchema.nullable(),
  warnings: z.array(
    z.strictObject({
      code: z.string().min(1),
      message: z.string().min(1),
      blockIndex: z.number().int().min(0).nullable()
    })
  ),
  embeddedAssets: z.array(ZPersistedEmbeddedAsset).max(MAX_EMBEDDED_ASSETS)
});

const ZDraftCheckpoint = z.strictObject({
  version: z.literal(1),
  schemaVersion: z.number().int().min(1),
  sectionCount: z.number().int().min(0),
  questionCount: z.number().int().min(0),
  reviewRequiredCount: z.number().int().min(0),
  blockingIssueCount: z.number().int().min(0),
  warningCount: z.number().int().min(0)
});

const ZSourceArtifactCheckpoint = z.strictObject({
  version: z.literal(1),
  key: z.string().min(1).max(1_000),
  byteSize: z.number().int().min(1).max(MAX_SOURCE_ARTIFACT_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/)
});

const ZVisionPageCheckpoint = z.strictObject({
  version: z.literal(1),
  contractVersion: z.literal(EXAM_IMPORT_VISION_CONTRACT_VERSION),
  page: scannedPdfPageTranscriptionSchema,
  imageSha256: z.string().regex(/^[0-9a-f]{64}$/),
  requestHash: z.string().regex(/^[0-9a-f]{64}$/),
  model: z.string().min(1).max(200)
});

const ZVisionConfigCheckpoint = z.strictObject({
  version: z.literal(1),
  contractVersion: z.literal(EXAM_IMPORT_VISION_CONTRACT_VERSION),
  model: z.string().min(1).max(200)
});

type ExamImportScope = Pick<TExamImportPayload, 'importId' | 'organizationId' | 'courseId'>;
type SourceCheckpoint = z.infer<typeof ZSourceCheckpoint>;
type DraftCheckpoint = z.infer<typeof ZDraftCheckpoint>;
type SourceArtifactCheckpoint = z.infer<typeof ZSourceArtifactCheckpoint>;
type ExamImportFailure = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};
type EmbeddedAssetInput = {
  ref: string;
  mimeType: string;
  bytes: Uint8Array;
};
type DocumentReadResult = {
  runs: SourceRun[];
  assets: EmbeddedAssetInput[];
  warnings: Array<{ code: string; message: string; blockIndex: number | null }>;
};

const IMAGE_EXTENSION_BY_MIME_TYPE: Readonly<Record<(typeof ALLOWED_IMAGE_TYPES)[number], string>> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};
const ALLOWED_EMBEDDED_IMAGE_TYPES = new Set<string>(ALLOWED_IMAGE_TYPES);

export class ExamImportTerminalError extends UnrecoverableError {
  readonly failure: ExamImportFailure;

  constructor(failure: ExamImportFailure) {
    super(failure.message);
    this.name = 'UnrecoverableError';
    this.failure = failure;
  }
}

export class ExamImportRetryableError extends Error {
  readonly failure: ExamImportFailure;

  constructor(failure: ExamImportFailure) {
    super(failure.message);
    this.name = 'ExamImportRetryableError';
    this.failure = failure;
  }
}

function terminalError(code: string, message: string, details?: Record<string, unknown>): ExamImportTerminalError {
  return new ExamImportTerminalError({
    code,
    message,
    ...(details ? { details } : {})
  });
}

function retryableError(code: string, message: string, details?: Record<string, unknown>): ExamImportRetryableError {
  return new ExamImportRetryableError({
    code,
    message,
    ...(details ? { details } : {})
  });
}

export function toExamImportFailure(error: unknown): ExamImportFailure {
  if (error instanceof ExamImportTerminalError || error instanceof ExamImportRetryableError) {
    return error.failure;
  }

  return {
    code: 'EXAM_IMPORT_PROCESSING_FAILED',
    message: 'Exam import processing failed after retries',
    details: {
      cause: error instanceof Error ? error.name : 'UnknownError'
    }
  };
}

function parsePayload(rawData: unknown): TExamImportPayload {
  const result = ZExamImportPayload.safeParse(rawData);
  if (!result.success) {
    throw terminalError('EXAM_IMPORT_PAYLOAD_INVALID', 'Exam import queue payload is invalid');
  }

  return result.data;
}

function parseSourceArtifactCheckpoint(result: unknown): SourceArtifactCheckpoint {
  const parsed = ZSourceArtifactCheckpoint.safeParse(result);
  if (!parsed.success) {
    throw terminalError('EXAM_IMPORT_SOURCE_CHECKPOINT_INVALID', 'Completed source checkpoint is invalid');
  }

  return parsed.data;
}

function parseCompletedDraftStep(result: unknown): DraftCheckpoint {
  const parsed = ZDraftCheckpoint.safeParse(result);
  if (!parsed.success) {
    throw terminalError('EXAM_IMPORT_DRAFT_CHECKPOINT_INVALID', 'Completed draft checkpoint is invalid');
  }

  return parsed.data;
}

function assertDocumentCapability(
  inspection: ExamImportDocumentInspection,
  extractor: 'docx' | 'pdf' | 'aiken' | 'gift'
): void {
  if (inspection.supported && inspection.detectedType) {
    if (extractor !== inspection.detectedType) {
      throw terminalError('EXAM_IMPORT_EXTRACTOR_MISMATCH', 'Stored extractor does not match the document bytes', {
        configuredExtractor: extractor,
        detectedType: inspection.detectedType
      });
    }

    return;
  }

  const codeByReason = {
    extractor_unavailable: 'EXAM_IMPORT_EXTRACTOR_UNAVAILABLE',
    file_too_large: 'EXAM_IMPORT_DOCUMENT_TOO_LARGE',
    invalid_document: 'EXAM_IMPORT_DOCUMENT_INVALID',
    unsupported_file: 'EXAM_IMPORT_DOCUMENT_UNSUPPORTED'
  } as const;
  const reason = inspection.reason ?? 'unsupported_file';

  throw terminalError(codeByReason[reason], 'Source document cannot be processed', {
    detectedType: inspection.detectedType,
    capabilityReason: reason
  });
}

function sourceFileName(title: string | null, storageKey: string): string {
  const candidate = title?.trim() || basename(storageKey).trim() || 'exam-document';

  return candidate.slice(0, 500);
}

function sanitizeAuthoredHtml(html: string): string {
  const sanitized = DOMPurify.sanitize(html, createSanitizeHtmlConfig());

  return stripSvgDataUrls(sanitized);
}

function sourceArtifactKey(scope: ExamImportScope): string {
  return `exam-import/checkpoints/${scope.organizationId}/${scope.importId}/source-v1.json.gz`;
}

export async function cleanupExamImportAttemptOutputs(scope: ExamImportScope): Promise<void> {
  const storage = getStorageConfig();
  await deleteObjectFromBucket(storage.bucketDocuments, sourceArtifactKey(scope));
  await deleteObjectsByPrefix(storage.bucketMedia, `exam-import/${scope.organizationId}/${scope.importId}/`);
}

function sha256(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function mediaPublicUrl(storageKey: string): string {
  const baseUrl = getStorageConfig().mediaPublicBaseUrl;
  if (!baseUrl) {
    throw terminalError(
      'EXAM_IMPORT_MEDIA_PUBLIC_URL_MISSING',
      'Embedded images require a configured media public URL'
    );
  }

  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw terminalError('EXAM_IMPORT_MEDIA_PUBLIC_URL_INVALID', 'Configured media public URL is invalid');
  }
  if (parsedBaseUrl.protocol !== 'http:' && parsedBaseUrl.protocol !== 'https:') {
    throw terminalError('EXAM_IMPORT_MEDIA_PUBLIC_URL_INVALID', 'Configured media public URL must use HTTP or HTTPS');
  }

  return `${baseUrl.replace(/\/$/, '')}/${storageKey}`;
}

function pdfImageRgba(image: PdfEmbeddedImage, maxPixels: number): Buffer {
  const pixelCount = image.intrinsicWidth * image.intrinsicHeight;
  if (!Number.isSafeInteger(pixelCount) || pixelCount <= 0 || pixelCount > maxPixels || image.pixels === null) {
    throw new Error('PDF image pixel buffer is unavailable or exceeds the platform limit');
  }

  const rgba = Buffer.alloc(pixelCount * 4);
  if (image.pixelFormat === 'rgba-32bpp' && image.pixels.byteLength === pixelCount * 4) {
    return Buffer.from(image.pixels);
  }
  if (image.pixelFormat === 'rgb-24bpp' && image.pixels.byteLength === pixelCount * 3) {
    for (let index = 0; index < pixelCount; index += 1) {
      const sourceOffset = index * 3;
      const targetOffset = index * 4;
      rgba[targetOffset] = image.pixels[sourceOffset]!;
      rgba[targetOffset + 1] = image.pixels[sourceOffset + 1]!;
      rgba[targetOffset + 2] = image.pixels[sourceOffset + 2]!;
      rgba[targetOffset + 3] = 255;
    }

    return rgba;
  }
  if (image.pixelFormat === 'grayscale-1bpp') {
    const packedRowBytes = Math.ceil(image.intrinsicWidth / 8);
    const packedLength = packedRowBytes * image.intrinsicHeight;
    if (image.pixels.byteLength !== pixelCount && image.pixels.byteLength !== packedLength) {
      throw new Error('PDF grayscale image pixel buffer has an invalid length');
    }

    for (let index = 0; index < pixelCount; index += 1) {
      const row = Math.floor(index / image.intrinsicWidth);
      const column = index % image.intrinsicWidth;
      const value =
        image.pixels.byteLength === pixelCount
          ? image.pixels[index]!
          : ((image.pixels[row * packedRowBytes + Math.floor(column / 8)]! >> (7 - (column % 8))) & 1) * 255;
      const targetOffset = index * 4;
      rgba[targetOffset] = value;
      rgba[targetOffset + 1] = value;
      rgba[targetOffset + 2] = value;
      rgba[targetOffset + 3] = 255;
    }

    return rgba;
  }

  throw new Error('PDF image pixel format is unsupported');
}

function encodePdfImageAsPng(image: PdfEmbeddedImage, maxPixels: number, maxBytes: number): Uint8Array {
  const rgba = pdfImageRgba(image, maxPixels);
  const png = new PNG({
    width: image.intrinsicWidth,
    height: image.intrinsicHeight
  });
  rgba.copy(png.data);
  const bytes = PNG.sync.write(png);
  if (bytes.byteLength > maxBytes) {
    throw new Error('Encoded PDF image exceeds the platform limit');
  }

  return bytes;
}

function preparePdfReadResult(readResult: PdfReadResult): DocumentReadResult {
  const maxImageBytes = getUploadLimits().imageBytes;
  const assets: EmbeddedAssetInput[] = [];
  const availableRefs = new Set<string>();
  const warnings: DocumentReadResult['warnings'] = readResult.warnings.map((warning) => ({
    code: warning.code,
    message: warning.message,
    blockIndex: warning.blockIndex
  }));

  for (const image of readResult.assets) {
    try {
      const bytes = encodePdfImageAsPng(image, Math.floor(maxImageBytes / 4), maxImageBytes);

      assets.push({ ref: image.assetRef, mimeType: 'image/png', bytes });
      availableRefs.add(image.assetRef);
    } catch (error) {
      warnings.push({
        code: 'PDF_IMAGE_ENCODING_FAILED',
        message: `PDF image ${image.assetRef} was omitted: ${errorMessage(error)}`,
        blockIndex: null
      });
    }
  }

  const runs = readResult.runs.filter((run) => run.image === null || availableRefs.has(run.image.assetRef));

  return { runs, assets, warnings };
}

function disabledVisionError(
  reason: Extract<Awaited<ReturnType<typeof requestExamImportVisionPage>>, { kind: 'disabled' }>['reason']
) {
  switch (reason) {
    case 'global_disabled':
      return terminalError(
        'EXAM_IMPORT_SCAN_AI_DISABLED',
        'Scanned PDF import requires the exam-import AI feature to be enabled'
      );
    case 'vision_disabled':
      return terminalError('EXAM_IMPORT_SCAN_VISION_DISABLED', 'Scanned PDF vision import is disabled');
    case 'organization_disabled':
      return terminalError(
        'EXAM_IMPORT_SCAN_AI_CONSENT_REQUIRED',
        'Scanned PDF import requires organization AI consent'
      );
    case 'organization_vision_disabled':
      return terminalError(
        'EXAM_IMPORT_SCAN_VISION_CONSENT_REQUIRED',
        'Scanned PDF import requires organization consent to transmit full-page images'
      );
    case 'model_unavailable':
      return terminalError(
        'EXAM_IMPORT_SCAN_VISION_MODEL_UNAVAILABLE',
        'Scanned PDF import requires an allowlisted vision model'
      );
    case 'gateway_unavailable':
      return retryableError(
        'EXAM_IMPORT_SCAN_AI_GATEWAY_UNAVAILABLE',
        'The AI gateway required for scanned PDF import is unavailable'
      );
  }

  reason satisfies never;
  return terminalError('EXAM_IMPORT_SCAN_AI_DISABLED', 'Scanned PDF import is unavailable');
}

async function transcribeScannedPdf(
  scope: ExamImportScope,
  actorProfileId: string | null,
  bytes: Uint8Array
): Promise<DocumentReadResult> {
  if (!actorProfileId) {
    throw terminalError('EXAM_IMPORT_SCAN_ACTOR_REQUIRED', 'Scanned PDF import requires an authenticated actor');
  }

  const pages: ScannedPdfPageTranscription[] = [];
  const maxImageBytes = getUploadLimits().imageBytes;
  const existingConfig = await getJobStep(DOMAIN, scope.importId, VISION_CONFIG_STEP_KEY);
  let visionConfig = ZVisionConfigCheckpoint.safeParse(existingConfig?.result);
  if (existingConfig?.status === 'completed' && !visionConfig.success) {
    throw terminalError('EXAM_IMPORT_SCAN_CHECKPOINT_INVALID', 'Scanned PDF vision configuration is invalid');
  }
  if (existingConfig?.status !== 'completed') {
    const configuredModel = getConfiguredExamImportVisionModel();
    if (!configuredModel) throw disabledVisionError('model_unavailable');

    const configCheckpoint = ZVisionConfigCheckpoint.parse({
      version: 1,
      contractVersion: EXAM_IMPORT_VISION_CONTRACT_VERSION,
      model: configuredModel
    });
    const configResult: Record<string, unknown> = { ...configCheckpoint };
    const configBytes = new TextEncoder().encode(JSON.stringify(configCheckpoint));
    const configHash = sha256(configBytes);
    const configTimestamp = new Date().toISOString();
    const storedConfig = await upsertJobStep({
      domain: DOMAIN,
      runId: scope.importId,
      stepKey: VISION_CONFIG_STEP_KEY,
      status: 'completed',
      attempt: (existingConfig?.attempt ?? 0) + 1,
      inputHash: configHash,
      providerId: configuredModel,
      startedAt: configTimestamp,
      finishedAt: configTimestamp,
      result: configResult
    });
    visionConfig = ZVisionConfigCheckpoint.safeParse(storedConfig.result);
  }
  if (!visionConfig.success) {
    throw terminalError('EXAM_IMPORT_SCAN_CHECKPOINT_INVALID', 'Scanned PDF vision configuration is invalid');
  }

  try {
    await visitScannedPdfPageRasters(bytes, async (raster) => {
      const pngBytes = encodePdfImageAsPng(raster, SCANNED_PDF_RASTER_LIMITS.pixelsPerPage, maxImageBytes);
      const imageSha256 = sha256(pngBytes);
      const stepKey = `${VISION_PAGE_STEP_PREFIX}${raster.pageIndex}`;
      const existing = await getJobStep(DOMAIN, scope.importId, stepKey);
      if (existing?.status === 'completed') {
        const checkpoint = ZVisionPageCheckpoint.safeParse(existing.result);
        if (
          !checkpoint.success ||
          checkpoint.data.imageSha256 !== imageSha256 ||
          checkpoint.data.model !== visionConfig.data.model ||
          checkpoint.data.contractVersion !== visionConfig.data.contractVersion
        ) {
          throw terminalError(
            'EXAM_IMPORT_SCAN_CHECKPOINT_INVALID',
            'Scanned PDF page checkpoint does not match the source page',
            { pageIndex: raster.pageIndex }
          );
        }

        pages.push(checkpoint.data.page);
        return;
      }

      const attempt = (existing?.attempt ?? 0) + 1;
      const startedAt = new Date().toISOString();
      await upsertJobStep({
        domain: DOMAIN,
        runId: scope.importId,
        stepKey,
        status: 'running',
        attempt,
        inputHash: imageSha256,
        startedAt
      });

      try {
        const call = await requestExamImportVisionPage({
          organizationId: scope.organizationId,
          pageIndex: raster.pageIndex,
          pngBytes,
          model: visionConfig.data.model,
          contractVersion: visionConfig.data.contractVersion
        });
        if (call.kind === 'disabled') throw disabledVisionError(call.reason);
        if (call.kind === 'waiting') {
          throw retryableError(
            'EXAM_IMPORT_SCAN_AI_CAPACITY_UNAVAILABLE',
            'AI capacity is temporarily unavailable for scanned PDF import',
            { pageIndex: raster.pageIndex }
          );
        }
        if (!call.transportAvailable) {
          throw retryableError(
            'EXAM_IMPORT_SCAN_AI_GATEWAY_UNAVAILABLE',
            'The AI gateway failed while transcribing a scanned PDF page',
            { pageIndex: raster.pageIndex }
          );
        }
        if (call.promptTokens > 0 || call.completionTokens > 0) {
          await recordTokenUsage(
            scope.organizationId,
            actorProfileId,
            scope.courseId,
            {
              promptTokens: call.promptTokens,
              completionTokens: call.completionTokens,
              totalTokens: call.promptTokens + call.completionTokens
            },
            call.model,
            {
              transport: 'gateway',
              workloadDomain: 'exam_import',
              workloadId: scope.importId,
              idempotencyKey: `${scope.importId}:${call.requestHash}`,
              quotaMultiplier: call.quotaMultiplier
            }
          );
        }
        if (!call.response) {
          throw retryableError(
            'EXAM_IMPORT_SCAN_TRANSCRIPTION_INVALID',
            'The vision model returned an invalid scanned PDF transcription',
            { pageIndex: raster.pageIndex, model: call.model }
          );
        }
        if (call.model !== visionConfig.data.model) {
          throw terminalError(
            'EXAM_IMPORT_SCAN_MODEL_CHANGED',
            'Scanned PDF model changed while the import was in progress',
            { pageIndex: raster.pageIndex }
          );
        }

        const checkpoint = ZVisionPageCheckpoint.parse({
          version: 1,
          contractVersion: visionConfig.data.contractVersion,
          page: call.response,
          imageSha256,
          requestHash: call.requestHash,
          model: call.model
        });
        const checkpointResult: Record<string, unknown> = { ...checkpoint };
        await upsertJobStep({
          domain: DOMAIN,
          runId: scope.importId,
          stepKey,
          status: 'completed',
          attempt,
          inputHash: imageSha256,
          providerId: call.model,
          startedAt,
          finishedAt: new Date().toISOString(),
          result: checkpointResult
        });
        pages.push(checkpoint.page);
      } catch (error) {
        await markStepFailed(scope, stepKey, attempt, startedAt, error);
        throw error;
      }
    });
  } catch (error) {
    if (error instanceof ScannedPdfRasterError) {
      throw terminalError('EXAM_IMPORT_PDF_SCAN_INVALID', 'Scanned PDF pages could not be extracted safely', {
        rasterCode: error.code,
        pageIndex: error.pageIndex
      });
    }

    throw error;
  }

  return {
    runs: scannedPdfTranscriptionsToSourceRuns(pages),
    assets: [],
    warnings: [
      {
        code: 'PDF_SCANNED_AI_TRANSCRIPTION',
        message: 'Scanned PDF text was transcribed by AI and every extracted question requires review',
        blockIndex: null
      }
    ]
  };
}

function prepareDocxReadResult(readResult: DocxReadResult): DocumentReadResult {
  return {
    runs: readResult.runs,
    assets: readResult.assets,
    warnings: readResult.warnings
  };
}

async function persistEmbeddedAssets(
  scope: ExamImportScope,
  readResult: Pick<DocumentReadResult, 'runs' | 'assets'>
): Promise<{ runs: SourceRun[]; embeddedAssets: z.infer<typeof ZPersistedEmbeddedAsset>[] }> {
  if (readResult.assets.length === 0) {
    return { runs: readResult.runs, embeddedAssets: [] };
  }
  if (readResult.assets.length > MAX_EMBEDDED_ASSETS) {
    throw terminalError('EXAM_IMPORT_TOO_MANY_EMBEDDED_IMAGES', 'Document contains too many embedded images', {
      maxEmbeddedAssets: MAX_EMBEDDED_ASSETS
    });
  }

  const maxImageBytes = getUploadLimits().imageBytes;
  const resolvedUrls = new Map<string, string>();
  const embeddedAssets: z.infer<typeof ZPersistedEmbeddedAsset>[] = [];
  const uploadedKeys = new Set<string>();
  const mediaBucketName = getStorageConfig().bucketMedia;

  try {
    for (const asset of readResult.assets) {
      if (!ALLOWED_EMBEDDED_IMAGE_TYPES.has(asset.mimeType)) {
        throw terminalError(
          'EXAM_IMPORT_EMBEDDED_IMAGE_TYPE_UNSUPPORTED',
          'Document contains an unsupported embedded image type',
          { mimeType: asset.mimeType }
        );
      }
      if (asset.bytes.byteLength === 0 || asset.bytes.byteLength > maxImageBytes) {
        throw terminalError(
          'EXAM_IMPORT_EMBEDDED_IMAGE_SIZE_INVALID',
          'Document contains an embedded image outside the platform size limit',
          { byteSize: asset.bytes.byteLength, maxImageBytes }
        );
      }

      const mimeType = asset.mimeType as (typeof ALLOWED_IMAGE_TYPES)[number];
      const digest = sha256(asset.bytes);
      const extension = IMAGE_EXTENSION_BY_MIME_TYPE[mimeType];
      const storageKey = `exam-import/${scope.organizationId}/${scope.importId}/${digest}.${extension}`;
      const publicUrl = mediaPublicUrl(storageKey);
      if (!uploadedKeys.has(storageKey)) {
        await uploadBufferToBucket(
          mediaBucketName,
          storageKey,
          Buffer.from(asset.bytes),
          mimeType,
          'public, max-age=31536000, immutable'
        );
        uploadedKeys.add(storageKey);
      }
      resolvedUrls.set(asset.ref, publicUrl);
      embeddedAssets.push({ sourceRef: asset.ref, storageKey, publicUrl });
    }

    const runs = readResult.runs.map((run) => {
      if (!run.image) return run;

      const publicUrl = resolvedUrls.get(run.image.assetRef);
      if (!publicUrl) {
        throw terminalError('EXAM_IMPORT_EMBEDDED_IMAGE_MISSING', 'An embedded image run has no persisted asset');
      }

      return {
        ...run,
        image: {
          ...run.image,
          assetRef: publicUrl
        }
      };
    });

    return { runs, embeddedAssets };
  } catch (error) {
    for (const storageKey of uploadedKeys) {
      try {
        await deleteObjectFromBucket(mediaBucketName, storageKey);
      } catch (cleanupError) {
        log.warn('exam-import-partial-upload-cleanup-failed', {
          importId: scope.importId,
          storageKey,
          error: errorMessage(cleanupError)
        });
      }
    }
    try {
      await deleteObjectsByPrefix(mediaBucketName, `exam-import/${scope.organizationId}/${scope.importId}/`);
    } catch (cleanupError) {
      log.warn('exam-import-partial-upload-prefix-cleanup-failed', {
        importId: scope.importId,
        error: errorMessage(cleanupError)
      });
    }

    throw error;
  }
}

async function writeSourceArtifact(
  scope: ExamImportScope,
  checkpoint: SourceCheckpoint
): Promise<SourceArtifactCheckpoint> {
  const serialized = Buffer.from(JSON.stringify(checkpoint));
  if (serialized.byteLength > MAX_SOURCE_ARTIFACT_UNCOMPRESSED_BYTES) {
    throw terminalError('EXAM_IMPORT_SOURCE_CHECKPOINT_TOO_LARGE', 'Extracted source checkpoint is too large', {
      maxBytes: MAX_SOURCE_ARTIFACT_UNCOMPRESSED_BYTES
    });
  }

  const compressed = await gzipBuffer(serialized);
  if (compressed.byteLength > MAX_SOURCE_ARTIFACT_BYTES) {
    throw terminalError('EXAM_IMPORT_SOURCE_CHECKPOINT_TOO_LARGE', 'Compressed source checkpoint is too large', {
      maxBytes: MAX_SOURCE_ARTIFACT_BYTES
    });
  }

  const key = sourceArtifactKey(scope);
  const bucket = getStorageConfig().bucketDocuments;
  await uploadBufferToBucket(bucket, key, compressed, 'application/gzip', 'private, max-age=0');

  return {
    version: 1,
    key,
    byteSize: compressed.byteLength,
    sha256: sha256(compressed)
  };
}

async function readSourceArtifact(pointerValue: unknown): Promise<SourceCheckpoint> {
  const pointer = parseSourceArtifactCheckpoint(pointerValue);
  const bucket = getStorageConfig().bucketDocuments;
  let localPath: string | undefined;

  try {
    localPath = await downloadObjectToTempFile(
      bucket,
      pointer.key,
      'exam-import-source-checkpoint.json.gz',
      pointer.byteSize
    );
    const compressed = await readFile(localPath);
    if (compressed.byteLength !== pointer.byteSize || sha256(compressed) !== pointer.sha256) {
      throw terminalError('EXAM_IMPORT_SOURCE_CHECKPOINT_INVALID', 'Source checkpoint integrity check failed');
    }

    const serialized = await gunzipBuffer(compressed, {
      maxOutputLength: MAX_SOURCE_ARTIFACT_UNCOMPRESSED_BYTES
    });
    const parsedJson: unknown = JSON.parse(serialized.toString('utf8'));

    return ZSourceCheckpoint.parse(parsedJson);
  } catch (error) {
    if (error instanceof ExamImportTerminalError) {
      throw error;
    }

    throw terminalError('EXAM_IMPORT_SOURCE_CHECKPOINT_INVALID', 'Source checkpoint artifact could not be read');
  } finally {
    await safeUnlink(localPath);
  }
}

async function cleanupExamImportVisionPageSteps(importId: string): Promise<void> {
  const steps = await listJobStepsByRun(DOMAIN, importId);
  for (const step of steps) {
    if (!step.stepKey.startsWith(VISION_STEP_PREFIX)) continue;

    await deleteJobStep(DOMAIN, importId, step.stepKey);
  }
}

export async function cleanupExamImportSourceArtifact(
  importId: string,
  removeEmbeddedAssets = false
): Promise<boolean> {
  try {
    await cleanupExamImportVisionPageSteps(importId);
    const sourceStep = await getJobStep(DOMAIN, importId, SOURCE_STEP_KEY);
    if (sourceStep?.status !== 'completed') return true;

    const pointer = ZSourceArtifactCheckpoint.safeParse(sourceStep.result);
    if (!pointer.success) return false;

    if (removeEmbeddedAssets) {
      try {
        const checkpoint = await readSourceArtifact(pointer.data);
        const mediaBucketName = getStorageConfig().bucketMedia;
        const storageKeys = new Set(checkpoint.embeddedAssets.map((asset) => asset.storageKey));
        for (const storageKey of storageKeys) {
          await deleteObjectFromBucket(mediaBucketName, storageKey);
        }
      } catch (error) {
        log.warn('exam-import-embedded-asset-manifest-read-failed', {
          importId,
          error: errorMessage(error)
        });

        return false;
      }
    }
    await deleteObjectFromBucket(getStorageConfig().bucketDocuments, pointer.data.key);
    await deleteJobStep(DOMAIN, importId, SOURCE_STEP_KEY);

    return true;
  } catch (error) {
    log.warn('exam-import-source-artifact-cleanup-failed', {
      importId,
      error: errorMessage(error)
    });

    return false;
  }
}

async function markStepFailed(
  scope: ExamImportScope,
  stepKey: string,
  attempt: number,
  startedAt: string,
  error: unknown
): Promise<void> {
  const failure = toExamImportFailure(error);

  try {
    await upsertJobStep({
      domain: DOMAIN,
      runId: scope.importId,
      stepKey,
      status: 'failed',
      attempt,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: failure
    });
  } catch (checkpointError) {
    log.error('exam-import-checkpoint-failed', {
      importId: scope.importId,
      stepKey,
      error: errorMessage(checkpointError)
    });
  }
}

async function loadOrExtractSource(
  scope: ExamImportScope,
  sourceAssetId: string,
  extractor: 'docx' | 'pdf' | 'aiken' | 'gift',
  actorProfileId: string | null
): Promise<SourceCheckpoint> {
  const existing = await getJobStep(DOMAIN, scope.importId, SOURCE_STEP_KEY);
  if (existing?.status === 'completed') {
    log.info('exam-import-source-skip', { importId: scope.importId, reason: 'ledger-completed' });

    return readSourceArtifact(existing.result);
  }

  const attempt = (existing?.attempt ?? 0) + 1;
  const startedAt = new Date().toISOString();
  await upsertJobStep({
    domain: DOMAIN,
    runId: scope.importId,
    stepKey: SOURCE_STEP_KEY,
    status: 'running',
    attempt,
    startedAt
  });

  let localPath: string | undefined;
  let sourceOutputsCreated = false;
  try {
    const asset = await getAssetById(sourceAssetId, scope.organizationId);
    if (
      !asset ||
      asset.kind !== 'document' ||
      asset.provider !== 'upload' ||
      asset.status !== 'active' ||
      asset.isExternal ||
      !asset.storageKey?.trim()
    ) {
      throw terminalError('EXAM_IMPORT_SOURCE_ASSET_INVALID', 'Source asset is no longer a valid uploaded document');
    }

    const maxDocumentBytes = getUploadLimits().documentBytes;
    if (asset.byteSize !== null && asset.byteSize > maxDocumentBytes) {
      throw terminalError('EXAM_IMPORT_DOCUMENT_TOO_LARGE', 'Source document exceeds the platform limit', {
        byteSize: asset.byteSize,
        maxDocumentBytes
      });
    }

    const documentsBucket = getStorageConfig().bucketDocuments;
    try {
      localPath = await downloadObjectToTempFile(
        documentsBucket,
        asset.storageKey,
        'exam-import-source.bin',
        maxDocumentBytes
      );
    } catch (error) {
      if (error instanceof ObjectSizeLimitExceededError) {
        throw terminalError('EXAM_IMPORT_DOCUMENT_TOO_LARGE', 'Source document exceeds the platform limit', {
          maxDocumentBytes
        });
      }

      throw error;
    }
    const bytes = new Uint8Array(await readFile(localPath));
    const fileName = sourceFileName(asset.title, asset.storageKey);
    const inspection = await inspectExamImportDocument(bytes, maxDocumentBytes, fileName);
    assertDocumentCapability(inspection, extractor);

    let readResult: DocumentReadResult | null = null;
    let prebuiltDraft: ExamImportDraft | null = null;
    let aiTranscribed = false;
    if (extractor === 'docx') {
      try {
        const docxReadResult = await readDocxRuns(bytes);
        readResult = prepareDocxReadResult(docxReadResult);
      } catch {
        throw terminalError('EXAM_IMPORT_DOCX_READ_FAILED', 'DOCX content could not be read');
      }
    } else if (extractor === 'pdf') {
      try {
        const pdfReadResult = await readPdfRuns(bytes);
        readResult = preparePdfReadResult(pdfReadResult);
      } catch (error) {
        if (error instanceof PdfReadError && error.code === 'NO_TEXT_LAYER') {
          readResult = await transcribeScannedPdf(scope, actorProfileId, bytes);
          aiTranscribed = true;
        } else {
          throw terminalError('EXAM_IMPORT_PDF_READ_FAILED', 'PDF content could not be read');
        }
      }
    } else {
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw terminalError('EXAM_IMPORT_TEXT_DECODE_FAILED', 'Text exam source is not valid UTF-8');
      }

      if (extractor === 'aiken') {
        try {
          prebuiltDraft = parseAiken(text, {
            assetId: asset.id,
            fileName,
            title: fileName.replace(/\.aiken$/iu, '').trim() || 'Imported exam'
          });
        } catch (error) {
          if (error instanceof AikenParseError) {
            throw terminalError('EXAM_IMPORT_AIKEN_INVALID', 'Aiken source could not be parsed', {
              diagnostics: error.diagnostics.map(({ code, line, column }) => ({ code, line, column }))
            });
          }

          throw error;
        }
      } else {
        prebuiltDraft = parseGift({
          text,
          source: {
            assetId: asset.id,
            fileName,
            mimeType: TEXT_MIME_TYPE
          }
        }).draft;
      }
    }

    sourceOutputsCreated = true;
    const persistedAssets =
      readResult === null ? { runs: [], embeddedAssets: [] } : await persistEmbeddedAssets(scope, readResult);
    const checkpoint = ZSourceCheckpoint.parse({
      version: 1,
      aiTranscribed,
      source: {
        assetId: asset.id,
        fileName,
        mimeType: extractor === 'docx' ? DOCX_MIME_TYPE : extractor === 'pdf' ? PDF_MIME_TYPE : TEXT_MIME_TYPE,
        extractor
      },
      runs: persistedAssets.runs,
      draft: prebuiltDraft,
      warnings: readResult?.warnings ?? [],
      embeddedAssets: persistedAssets.embeddedAssets
    });
    const artifact = await writeSourceArtifact(scope, checkpoint);
    sourceOutputsCreated = true;
    const checkpointResult: Record<string, unknown> = { ...artifact };

    await upsertJobStep({
      domain: DOMAIN,
      runId: scope.importId,
      stepKey: SOURCE_STEP_KEY,
      status: 'completed',
      attempt,
      startedAt,
      finishedAt: new Date().toISOString(),
      result: checkpointResult
    });

    log.info('exam-import-source-complete', {
      importId: scope.importId,
      runCount: checkpoint.runs.length,
      warningCount: checkpoint.warnings.length,
      embeddedAssetCount: checkpoint.embeddedAssets.length
    });

    return checkpoint;
  } catch (error) {
    if (sourceOutputsCreated) {
      try {
        await cleanupExamImportAttemptOutputs(scope);
      } catch (cleanupError) {
        log.warn('exam-import-source-output-rollback-failed', {
          importId: scope.importId,
          error: errorMessage(cleanupError)
        });
      }
    }
    await markStepFailed(scope, SOURCE_STEP_KEY, attempt, startedAt, error);
    throw error;
  } finally {
    await safeUnlink(localPath);
  }
}

async function createAndSaveDraft(
  scope: ExamImportScope,
  sourceCheckpoint: SourceCheckpoint,
  runningImport: TExamImport
): Promise<DraftCheckpoint | { status: 'waiting_for_ai' }> {
  const existing = await getJobStep(DOMAIN, scope.importId, DRAFT_STEP_KEY);
  if (existing?.status === 'completed') {
    log.info('exam-import-draft-skip', { importId: scope.importId, reason: 'ledger-completed' });

    return parseCompletedDraftStep(existing.result);
  }

  const attempt = (existing?.attempt ?? 0) + 1;
  const startedAt = new Date().toISOString();
  await upsertJobStep({
    domain: DOMAIN,
    runId: scope.importId,
    stepKey: DRAFT_STEP_KEY,
    status: 'running',
    attempt,
    startedAt
  });

  try {
    const validationContext = {
      enabledQuestionKinds: new Set(EXAM_IMPORT_PUBLISHABLE_QUESTION_KINDS),
      sanitizeHtml: sanitizeAuthoredHtml
    };
    let validation: ReturnType<typeof createValidatedExamImportDraftFromRuns>;
    try {
      const storedDraft = runningImport.aiCursor > 0 ? await getExamImportDraft(scope) : null;
      if (storedDraft) {
        validation = validateExamImportDraft(storedDraft.draft, validationContext);
      } else {
        validation =
          sourceCheckpoint.draft === null
            ? createValidatedExamImportDraftFromRuns(sourceCheckpoint.runs, sourceCheckpoint.source, validationContext)
            : validateExamImportDraft(sourceCheckpoint.draft, validationContext);
      }
    } catch {
      throw terminalError('EXAM_IMPORT_DRAFT_EXTRACTION_FAILED', 'Document source could not be converted into a draft');
    }

    if (sourceCheckpoint.aiTranscribed && validation.draft) {
      const aiDerivedDraft = markExamImportDraftAsAiDerived(validation.draft);
      validation = validateExamImportDraft(aiDerivedDraft, validationContext);
    }

    if (!validation.draft) {
      const findingCodes = [...new Set(validation.findings.map((finding) => finding.code))];
      throw terminalError('EXAM_IMPORT_DRAFT_INVALID', 'Extracted draft failed structural validation', {
        findingCodes
      });
    }

    let validatedDraft = validation.draft;
    const automaticSourceAuditEnabled =
      !sourceCheckpoint.aiTranscribed &&
      (sourceCheckpoint.source.extractor === 'docx' || sourceCheckpoint.source.extractor === 'pdf');
    const auditedQuestionIds = new Set((runningImport.aiRegionAudit ?? []).map((entry) => entry.questionId));
    let aiCall =
      automaticSourceAuditEnabled && runningImport.actorProfileId
        ? await requestNextExamImportAiRegion({
            draft: validatedDraft,
            organizationId: scope.organizationId,
            auditedQuestionIds,
            sourceRuns: sourceCheckpoint.runs,
            auditSource: true
          })
        : { kind: 'disabled' as const };
    const aiWaitStartedAt = runningImport.startedAt ? new Date(runningImport.startedAt).getTime() : Date.now();
    if (aiCall.kind === 'waiting' && Date.now() - aiWaitStartedAt >= MAX_AI_CAPACITY_WAIT_MS) {
      aiCall = { kind: 'disabled' };
    }
    if (aiCall.kind === 'waiting') {
      const expiresAt = new Date(Date.now() + DRAFT_RETENTION_MS).toISOString();
      await db.transaction(async (tx) => {
        const savedDraft = await replaceExamImportDraft(
          scope,
          {
            draft: { ...validatedDraft },
            embeddedAssets: sourceCheckpoint.embeddedAssets.map((asset) => ({ storageKey: asset.storageKey })),
            schemaVersion: validatedDraft.schemaVersion,
            expiresAt
          },
          tx
        );
        if (!savedDraft) {
          throw terminalError('EXAM_IMPORT_NOT_FOUND', 'Exam import no longer exists in the requested scope');
        }
        const waitingImport = await markExamImportWaitingForAi(scope, tx);
        if (!waitingImport) {
          throw terminalError('EXAM_IMPORT_STATE_CONFLICT', 'Exam import could not wait for AI capacity');
        }
        await upsertJobStep(
          {
            domain: DOMAIN,
            runId: scope.importId,
            stepKey: DRAFT_STEP_KEY,
            status: 'queued',
            attempt
          },
          tx
        );
      });

      return { status: 'waiting_for_ai' };
    }
    if (aiCall.kind === 'attempted') {
      if (runningImport.actorProfileId && (aiCall.promptTokens > 0 || aiCall.completionTokens > 0)) {
        await recordTokenUsage(
          scope.organizationId,
          runningImport.actorProfileId,
          scope.courseId,
          {
            promptTokens: aiCall.promptTokens,
            completionTokens: aiCall.completionTokens,
            totalTokens: aiCall.promptTokens + aiCall.completionTokens
          },
          aiCall.model,
          {
            transport: 'gateway',
            workloadDomain: 'exam_import',
            workloadId: scope.importId,
            idempotencyKey: `${scope.importId}:${aiCall.requestHash}`,
            quotaMultiplier: aiCall.quotaMultiplier
          }
        );
      }
      const applied =
        aiCall.response === null
          ? { ...validation, accepted: false }
          : applyExamImportAiRegionResponse(validatedDraft, aiCall.response, validationContext, {
              includeSourceAudit: true,
              preserveMissingAnswerKeys: true,
              sourceQuestionText: aiCall.sourceQuestionText
            });
      if (applied.accepted && applied.draft) {
        validation = applied;
        validatedDraft = applied.draft;
      }

      const nextAuditedQuestionIds = new Set([...auditedQuestionIds, aiCall.region.questionId]);
      const hasRemainingRegions =
        aiCall.transportAvailable &&
        collectExamImportAiRegions(validatedDraft, { includeSourceAudit: true }).some(
          (region) => !nextAuditedQuestionIds.has(region.questionId)
        );
      const expiresAt = new Date(Date.now() + DRAFT_RETENTION_MS).toISOString();
      const checkpointedImport = await db.transaction(async (tx) => {
        const auditedImport = await recordExamImportAiRegion(
          scope,
          {
            expectedCursor: runningImport.aiCursor,
            questionId: aiCall.region.questionId,
            reasons: aiCall.region.reasons,
            requestHash: aiCall.requestHash,
            sentAt: aiCall.sentAt,
            model: aiCall.model
          },
          tx
        );
        if (!auditedImport) {
          throw terminalError('EXAM_IMPORT_STATE_CONFLICT', 'Exam import AI cursor changed concurrently');
        }
        const savedDraft = await replaceExamImportDraft(
          scope,
          {
            draft: { ...validatedDraft },
            embeddedAssets: sourceCheckpoint.embeddedAssets.map((asset) => ({ storageKey: asset.storageKey })),
            schemaVersion: validatedDraft.schemaVersion,
            expiresAt
          },
          tx
        );
        if (!savedDraft) {
          throw terminalError('EXAM_IMPORT_NOT_FOUND', 'Exam import no longer exists in the requested scope');
        }
        if (!hasRemainingRegions) return auditedImport;

        const waitingImport = await markExamImportWaitingForAi(scope, tx);
        if (!waitingImport) {
          throw terminalError('EXAM_IMPORT_STATE_CONFLICT', 'Exam import could not yield after an AI slice');
        }
        await upsertJobStep(
          {
            domain: DOMAIN,
            runId: scope.importId,
            stepKey: DRAFT_STEP_KEY,
            status: 'queued',
            attempt
          },
          tx
        );

        return waitingImport;
      });
      if (checkpointedImport.status === 'waiting_for_ai') {
        return { status: 'waiting_for_ai' };
      }
    }

    const questions = validatedDraft.sections.flatMap((section) => section.questions);
    const checkpoint = ZDraftCheckpoint.parse({
      version: 1,
      schemaVersion: validatedDraft.schemaVersion,
      sectionCount: validatedDraft.sections.length,
      questionCount: questions.length,
      reviewRequiredCount: questions.filter((question) => question.review !== 'clean').length,
      blockingIssueCount: validation.findings.filter((finding) => finding.blocking).length,
      warningCount:
        sourceCheckpoint.warnings.length +
        validation.findings.filter((finding) => finding.severity === 'warning').length
    });
    const draftRecord: Record<string, unknown> = { ...validatedDraft };
    const checkpointResult: Record<string, unknown> = { ...checkpoint };
    const expiresAt = new Date(Date.now() + DRAFT_RETENTION_MS).toISOString();

    await db.transaction(async (tx) => {
      const savedDraft = await replaceExamImportDraft(
        scope,
        {
          draft: draftRecord,
          embeddedAssets: sourceCheckpoint.embeddedAssets.map((asset) => ({ storageKey: asset.storageKey })),
          schemaVersion: checkpoint.schemaVersion,
          expiresAt
        },
        tx
      );
      if (!savedDraft) {
        throw terminalError('EXAM_IMPORT_NOT_FOUND', 'Exam import no longer exists in the requested scope');
      }

      const updatedImport = await markExamImportDraftReady(
        scope,
        {
          sectionCount: checkpoint.sectionCount,
          questionCount: checkpoint.questionCount,
          reviewRequiredCount: checkpoint.reviewRequiredCount,
          blockingIssueCount: checkpoint.blockingIssueCount,
          warningCount: checkpoint.warningCount,
          draftReadyAt: new Date().toISOString()
        },
        tx
      );
      if (!updatedImport) {
        throw terminalError('EXAM_IMPORT_NOT_FOUND', 'Exam import no longer exists in the requested scope');
      }

      await upsertJobStep(
        {
          domain: DOMAIN,
          runId: scope.importId,
          stepKey: DRAFT_STEP_KEY,
          status: 'completed',
          attempt,
          startedAt,
          finishedAt: new Date().toISOString(),
          result: checkpointResult
        },
        tx
      );
    });

    log.info('exam-import-draft-complete', {
      importId: scope.importId,
      questionCount: checkpoint.questionCount,
      reviewRequiredCount: checkpoint.reviewRequiredCount,
      blockingIssueCount: checkpoint.blockingIssueCount,
      warningCount: checkpoint.warningCount
    });

    return checkpoint;
  } catch (error) {
    await markStepFailed(scope, DRAFT_STEP_KEY, attempt, startedAt, error);
    throw error;
  }
}

export async function processExamImport(rawData: unknown) {
  const payload = parsePayload(rawData);
  const scope: ExamImportScope = {
    importId: payload.importId,
    organizationId: payload.organizationId,
    courseId: payload.courseId
  };
  const examImport = await getExamImportById(scope);

  if (!examImport) {
    throw terminalError('EXAM_IMPORT_NOT_FOUND', 'Exam import was not found in the requested scope');
  }
  if (examImport.status === 'published' || examImport.status === 'canceled') {
    if (examImport.status === 'canceled') {
      await cleanupExamImportSourceArtifact(scope.importId, true);
    }
    log.info('exam-import-skip-terminal-state', {
      importId: scope.importId,
      status: examImport.status
    });

    return {
      status: examImport.status,
      sectionCount: examImport.sectionCount,
      questionCount: examImport.questionCount,
      reviewRequiredCount: examImport.reviewRequiredCount,
      blockingIssueCount: examImport.blockingIssueCount,
      warningCount: examImport.warningCount
    };
  }

  const completedDraftStep = await getJobStep(DOMAIN, scope.importId, DRAFT_STEP_KEY);
  if (completedDraftStep?.status === 'completed') {
    await cleanupExamImportSourceArtifact(scope.importId);

    return {
      status: 'draft_ready' as const,
      ...parseCompletedDraftStep(completedDraftStep.result)
    };
  }
  if (examImport.status === 'draft_ready') {
    throw terminalError('EXAM_IMPORT_DRAFT_CHECKPOINT_MISSING', 'Draft-ready import has no completed draft checkpoint');
  }

  let runningImport = examImport;
  if (examImport.status === 'queued' || examImport.status === 'waiting_for_ai') {
    const markedRunning = await markExamImportRunning(scope, {
      startedAt: new Date().toISOString()
    });
    if (!markedRunning) {
      throw new Error('Exam import could not transition from queued to running');
    }

    runningImport = markedRunning;
  } else if (examImport.status === 'failed') {
    log.info('exam-import-skip-terminal-state', {
      importId: scope.importId,
      status: examImport.status
    });

    return {
      status: examImport.status,
      sectionCount: examImport.sectionCount,
      questionCount: examImport.questionCount,
      reviewRequiredCount: examImport.reviewRequiredCount,
      blockingIssueCount: examImport.blockingIssueCount,
      warningCount: examImport.warningCount
    };
  }

  if (!runningImport.sourceAssetId) {
    throw terminalError('EXAM_IMPORT_SOURCE_ASSET_NOT_FOUND', 'Source asset was deleted before processing');
  }

  const heartbeat = setInterval(() => {
    void touchExamImportRunning(scope).catch((error: unknown) => {
      log.warn('exam-import-heartbeat-failed', {
        importId: scope.importId,
        error: errorMessage(error)
      });
    });
  }, HEARTBEAT_INTERVAL_MS);

  try {
    await touchExamImportRunning(scope);
    const sourceCheckpoint = await loadOrExtractSource(
      scope,
      runningImport.sourceAssetId,
      runningImport.extractor,
      runningImport.actorProfileId ?? null
    );
    const importAfterExtraction = await getExamImportById(scope);
    if (importAfterExtraction?.status === 'canceled') {
      await cleanupExamImportSourceArtifact(scope.importId, true);

      return {
        status: 'canceled' as const,
        sectionCount: importAfterExtraction.sectionCount,
        questionCount: importAfterExtraction.questionCount,
        reviewRequiredCount: importAfterExtraction.reviewRequiredCount,
        blockingIssueCount: importAfterExtraction.blockingIssueCount,
        warningCount: importAfterExtraction.warningCount
      };
    }
    const draftCheckpoint = await createAndSaveDraft(scope, sourceCheckpoint, runningImport);
    if ('status' in draftCheckpoint) {
      return {
        status: draftCheckpoint.status,
        sectionCount: runningImport.sectionCount,
        questionCount: runningImport.questionCount,
        reviewRequiredCount: runningImport.reviewRequiredCount,
        blockingIssueCount: runningImport.blockingIssueCount,
        warningCount: runningImport.warningCount
      };
    }
    await cleanupExamImportSourceArtifact(scope.importId);

    return {
      status: 'draft_ready' as const,
      ...draftCheckpoint
    };
  } finally {
    clearInterval(heartbeat);
  }
}
