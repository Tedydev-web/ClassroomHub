import { createExerciseFromAuthoringPlan } from '@cio/core/services/exercise/exercise';
import { env } from '@cio/core/config/env';
import { getUploadLimits } from '@cio/core/config/upload-limits';
import { readGatewayConnectionFromEnv, selectGatewayModelId } from '@cio/core/services/agent/gateway-runtime';
import { getGatewaySettings } from '@cio/core/services/agent/gateway-settings-store';
import { sanitizeHtml } from '@cio/core/utils/sanitize-html';
import { S3ObjectSizeLimitExceededError, readDocumentObjectBytes } from '@cio/core/utils/s3';
import { db, type DbOrTxClient, type TxClient } from '@cio/db/drizzle';
import { getAssetById } from '@cio/db/queries/assets';
import { readDocxRuns } from '@cio/exam-import/docx/read-docx-runs';
import { readPdfRuns } from '@cio/exam-import/pdf/read-pdf-runs';
import { readAnswerKeyPairsFromRuns, toCompactAnswerKey } from '@cio/exam-import/draft/exam-import-answer-key-document';
import { getCourseWithOrgData } from '@cio/db/queries/course';
import { getOrganizationById } from '@cio/db/queries/organization';
import {
  createExamImport,
  getExamImportById,
  getExamImportDraft,
  lockExamImportById,
  markExamImportCanceled,
  markExamImportPublished,
  replaceExamImportDraft,
  updateExamImportDraftSummary,
  type ExamImportScope
} from '@cio/db/queries/exam-import';
import { isCourseTeamMemberOrOrgAdmin } from '@cio/db/queries/group';
import type { TExamImport, TExamImportDraft } from '@cio/db/types';
import {
  EXAM_IMPORT_PUBLISHABLE_QUESTION_KINDS,
  ExamImportCompactAnswerKeyError,
  ExamImportDraftPatchError,
  ExamImportPublishPlanError,
  applyExamImportCompactAnswerKey,
  applyExamImportDraftPatches,
  collectExamImportAiRegions,
  createExamImportPublishPlan,
  examImportDraftSchema,
  inspectExamImportDocument,
  examImportFindingClass,
  validateExamImportDraft,
  type ExamImportDraft,
  type ExamImportDraftPatchOperation,
  type ExamImportFindingClass,
  type ExamImportValidationResult
} from '@cio/exam-import';
import { enqueueExamImport, enqueueExamImportAiSuggestion } from '@cio/jobs';

import * as schema from '@cio/db/schema';
import { eq, sql } from 'drizzle-orm';

import { createExamForOrganization, requireExamsEnabled, type ExamSettingsInput } from '@api/services/exam/exam';
import { AppError, ErrorCodes } from '@api/utils/errors';

const ENABLED_QUESTION_KINDS = new Set(EXAM_IMPORT_PUBLISHABLE_QUESTION_KINDS);
const EXAM_IMPORT_AI_MAX_COMPLETION_TOKENS = 4_096;
const EXAM_IMPORT_AI_PROTOCOL_TOKEN_OVERHEAD = 1_500;

type ExamImportRequestScope = {
  organizationId: string;
  courseId: string;
  userId: string;
};

export type ExamImportStatusView = Pick<
  TExamImport,
  | 'id'
  | 'organizationId'
  | 'courseId'
  | 'sourceAssetId'
  | 'status'
  | 'extractor'
  | 'sectionCount'
  | 'questionCount'
  | 'reviewRequiredCount'
  | 'blockingIssueCount'
  | 'warningCount'
  | 'failure'
  | 'publishedExerciseId'
  | 'startedAt'
  | 'draftReadyAt'
  | 'publishedAt'
  | 'createdAt'
  | 'updatedAt'
>;

export type ExamImportDraftView = {
  draft: ExamImportDraft;
  /**
   * Each finding carries what the teacher has to do about it. Derived here rather than
   * stored on the draft or recomputed in the dashboard: one source of truth, and the
   * client needs no copy of the mapping to drift from.
   */
  findings: Array<ExamImportValidationResult['findings'][number] & { class: ExamImportFindingClass }>;
  aiSuggestionQuestionIds: string[];
  /**
   * Whether AI suggestion is configured at all on this deployment. Only the parts that need
   * no IO are checked here — the environment flag and the gateway connection — because a
   * draft view is built synchronously. That is enough to stop offering a button that cannot
   * work: with either of those missing, no organization setting or model pin can save it.
   * A deployment that passes this check still gets the existing per-request estimate, which
   * is where the organization setting and the model allowlist are answered.
   */
  aiSuggestionAvailable: boolean;
  publishable: boolean;
  expiresAt: string;
  updatedAt: string;
};

export type ExamImportAnswerKeyView = ExamImportDraftView & {
  appliedCount: number;
};

export type ExamImportAiSuggestionResult = {
  queuedCount: number;
};

export type ExamImportAiSuggestionEstimate = {
  available: boolean;
  questionCount: number;
  estimatedPromptTokens: number;
  maximumCompletionTokens: number;
  estimatedMaximumQuotaUnits: number;
  model: string | null;
};

/**
 * What an import may become when it is published.
 *
 * `exercise` puts the questions in the course, where enrolled students can open them
 * untimed — that is what an exercise is. `exam` puts them in a detached container and
 * builds the exam that delivers it, which is the whole of the paper's life: a teacher
 * importing a past paper never wanted a course exercise on the way there, and the one
 * they got stayed behind in the course tree afterwards.
 */
export type ExamImportPublishTarget = 'exercise' | 'exam';

export type ExamImportPublishResult = {
  exerciseId: string;
  /** Present when the import was published as an exam; the exam that delivers the container. */
  examId?: string;
  replayed: boolean;
};

export type ExamImportCancelResult = {
  status: 'canceled';
  replayed: boolean;
};

function importScope(scope: ExamImportRequestScope, importId: string): ExamImportScope {
  return {
    organizationId: scope.organizationId,
    courseId: scope.courseId,
    importId
  };
}

function requireExamImportWritesEnabled(): void {
  if (env.EXAM_IMPORT_ENABLED !== 'true') {
    throw new AppError('Exam import is disabled', ErrorCodes.EXAM_IMPORT_DISABLED, 503);
  }
}

function statusView(examImport: TExamImport): ExamImportStatusView {
  return {
    id: examImport.id,
    organizationId: examImport.organizationId,
    courseId: examImport.courseId,
    sourceAssetId: examImport.sourceAssetId,
    status: examImport.status,
    extractor: examImport.extractor,
    sectionCount: examImport.sectionCount,
    questionCount: examImport.questionCount,
    reviewRequiredCount: examImport.reviewRequiredCount,
    blockingIssueCount: examImport.blockingIssueCount,
    warningCount: examImport.warningCount,
    failure: examImport.failure,
    publishedExerciseId: examImport.publishedExerciseId,
    startedAt: examImport.startedAt,
    draftReadyAt: examImport.draftReadyAt,
    publishedAt: examImport.publishedAt,
    createdAt: examImport.createdAt,
    updatedAt: examImport.updatedAt
  };
}

async function assertCourseOrganization(
  scope: Pick<ExamImportRequestScope, 'organizationId' | 'courseId'>,
  dbClient?: DbOrTxClient
): Promise<void> {
  const course = await getCourseWithOrgData(scope.courseId, dbClient);
  if (!course || course.orgId !== scope.organizationId) {
    throw new AppError('Course was not found in the organization', ErrorCodes.COURSE_NOT_FOUND, 404);
  }
}

function requireImport(examImport: TExamImport | null): TExamImport {
  if (!examImport) {
    throw new AppError('Exam import was not found', ErrorCodes.EXAM_IMPORT_NOT_FOUND, 404);
  }

  return examImport;
}

function requireDraftReady(examImport: TExamImport): void {
  if (examImport.status !== 'draft_ready') {
    throw new AppError('Exam import draft is not ready', ErrorCodes.EXAM_IMPORT_NOT_READY, 409);
  }
}

function requireDraft(draft: TExamImportDraft | null): TExamImportDraft {
  if (!draft) {
    throw new AppError('Exam import draft was not found', ErrorCodes.EXAM_IMPORT_DRAFT_NOT_FOUND, 404);
  }

  if (new Date(draft.expiresAt).getTime() <= Date.now()) {
    throw new AppError('Exam import draft has expired', ErrorCodes.EXAM_IMPORT_DRAFT_EXPIRED, 410);
  }

  return draft;
}

function parseStoredDraft(value: unknown): ExamImportDraft {
  const parsed = examImportDraftSchema.safeParse(value);
  if (!parsed.success) {
    console.error('parseStoredDraft error:', parsed.error);
    throw new AppError('Stored exam import draft is invalid', ErrorCodes.INTERNAL_ERROR, 500);
  }

  return parsed.data;
}

function validateDraftForView(value: unknown): ExamImportValidationResult {
  const validation = validateExamImportDraft(value, {
    enabledQuestionKinds: ENABLED_QUESTION_KINDS,
    sanitizeHtml
  });
  if (!validation.draft) {
    console.error('validateDraftForView error:', validation.findings);
    throw new AppError('Stored exam import draft is invalid', ErrorCodes.INTERNAL_ERROR, 500);
  }

  return validation;
}

function draftView(draftRecord: TExamImportDraft, validation: ExamImportValidationResult): ExamImportDraftView {
  if (!validation.draft) {
    throw new AppError('Stored exam import draft is invalid', ErrorCodes.INTERNAL_ERROR, 500);
  }

  return {
    draft: validation.draft,
    findings: validation.findings.map((finding) => ({ ...finding, class: examImportFindingClass(finding.code) })),
    aiSuggestionQuestionIds: collectExamImportAiRegions(validation.draft).map((region) => region.questionId),
    aiSuggestionAvailable: isExamImportAiConfigured(),
    publishable: validation.publishable,
    expiresAt: draftRecord.expiresAt,
    updatedAt: draftRecord.updatedAt
  };
}

function draftSummary(validation: ExamImportValidationResult, warningCount: number) {
  if (!validation.draft) {
    throw new AppError('Stored exam import draft is invalid', ErrorCodes.INTERNAL_ERROR, 500);
  }

  const questions = validation.draft.sections.flatMap((section) => section.questions);

  return {
    sectionCount: validation.draft.sections.length,
    questionCount: questions.length,
    reviewRequiredCount: questions.filter((question) => question.review !== 'clean').length,
    blockingIssueCount: validation.findings.filter((finding) => finding.blocking).length,
    warningCount
  };
}

async function storeEditedDraft(
  scope: ExamImportScope,
  lockedImport: TExamImport,
  draftRecord: TExamImportDraft,
  value: unknown,
  tx: TxClient
): Promise<ExamImportDraftView> {
  const validation = validateDraftForView(value);
  const validatedDraft = validation.draft!;
  const persistedDraft = await replaceExamImportDraft(
    scope,
    {
      draft: { ...validatedDraft },
      embeddedAssets: draftRecord.embeddedAssets,
      schemaVersion: validatedDraft.schemaVersion,
      expiresAt: draftRecord.expiresAt
    },
    tx
  );
  if (!persistedDraft) {
    throw new AppError('Exam import was not found', ErrorCodes.EXAM_IMPORT_NOT_FOUND, 404);
  }

  const summary = draftSummary(validation, lockedImport.warningCount);
  const updatedImport = await updateExamImportDraftSummary(scope, summary, tx);
  if (!updatedImport) {
    throw new AppError('Exam import draft changed state', ErrorCodes.EXAM_IMPORT_PUBLISH_CONFLICT, 409);
  }

  return draftView(persistedDraft, validation);
}

export async function createExamImportService(
  scope: ExamImportRequestScope,
  assetId: string
): Promise<ExamImportStatusView> {
  requireExamImportWritesEnabled();
  await assertCourseOrganization(scope);
  const asset = await getAssetById(assetId, scope.organizationId);
  if (
    !asset ||
    asset.kind !== 'document' ||
    asset.provider !== 'upload' ||
    asset.status !== 'active' ||
    asset.isExternal ||
    !asset.storageKey
  ) {
    throw new AppError('Exam source asset was not found', ErrorCodes.EXAM_IMPORT_SOURCE_INVALID, 400, 'assetId');
  }
  const maxDocumentBytes = getUploadLimits().documentBytes;
  if (asset.byteSize !== null && asset.byteSize > maxDocumentBytes) {
    throw new AppError(
      'Exam source asset exceeds the upload limit',
      ErrorCodes.EXAM_IMPORT_SOURCE_INVALID,
      400,
      'assetId'
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = await readDocumentObjectBytes(asset.storageKey, maxDocumentBytes);
  } catch (error) {
    if (error instanceof S3ObjectSizeLimitExceededError) {
      throw new AppError(
        'Exam source asset exceeds the upload limit',
        ErrorCodes.EXAM_IMPORT_SOURCE_INVALID,
        400,
        'assetId'
      );
    }

    console.error('createExamImportService source read error:', error);
    throw new AppError('Exam source asset could not be read', ErrorCodes.INTERNAL_ERROR, 503, 'assetId');
  }

  const sourceFileName = asset.title?.trim() || asset.storageKey;
  const inspection = await inspectExamImportDocument(bytes, maxDocumentBytes, sourceFileName);
  if (!inspection.supported || !inspection.detectedType) {
    throw new AppError(
      'The exam source document is not supported',
      ErrorCodes.EXAM_IMPORT_SOURCE_INVALID,
      400,
      'assetId'
    );
  }
  if (inspection.detectedType === 'pdf' && env.EXAM_IMPORT_PDF_ENABLED !== 'true') {
    throw new AppError('PDF exam import is disabled', ErrorCodes.EXAM_IMPORT_SOURCE_INVALID, 400, 'assetId');
  }
  const extractor = inspection.detectedType;

  const examImport = await createExamImport({
    organizationId: scope.organizationId,
    courseId: scope.courseId,
    actorProfileId: scope.userId,
    sourceAssetId: asset.id,
    extractor
  });
  const examImportScope = importScope(scope, examImport.id);

  try {
    await enqueueExamImport(examImportScope);
  } catch (error) {
    console.error('createExamImportService enqueue error:', error);
  }

  return statusView(examImport);
}

export async function getExamImportStatusService(
  scope: ExamImportRequestScope,
  importId: string
): Promise<ExamImportStatusView> {
  await assertCourseOrganization(scope);
  const examImport = requireImport(await getExamImportById(importScope(scope, importId)));

  return statusView(examImport);
}

export async function cancelExamImportService(
  scope: ExamImportRequestScope,
  importId: string
): Promise<ExamImportCancelResult> {
  requireExamImportWritesEnabled();

  return db.transaction(async (tx) => {
    await assertCourseOrganization(scope, tx as DbOrTxClient);
    const scopedImport = importScope(scope, importId);
    const examImport = requireImport(await lockExamImportById(scopedImport, tx));
    if (examImport.status === 'canceled') {
      return { status: 'canceled', replayed: true };
    }
    if (examImport.status !== 'queued' && examImport.status !== 'running' && examImport.status !== 'waiting_for_ai') {
      throw new AppError('Exam import can no longer be canceled', ErrorCodes.EXAM_IMPORT_CANCEL_CONFLICT, 409);
    }

    const canceled = await markExamImportCanceled(scopedImport, tx);
    if (!canceled) {
      throw new AppError('Exam import changed state before cancellation', ErrorCodes.EXAM_IMPORT_CANCEL_CONFLICT, 409);
    }

    return { status: 'canceled', replayed: false };
  });
}

export async function getExamImportDraftService(
  scope: ExamImportRequestScope,
  importId: string
): Promise<ExamImportDraftView> {
  await assertCourseOrganization(scope);
  const scopedImport = importScope(scope, importId);
  const examImport = requireImport(await getExamImportById(scopedImport));
  if (examImport.status !== 'draft_ready' && examImport.status !== 'published') {
    throw new AppError('Exam import draft is not ready', ErrorCodes.EXAM_IMPORT_NOT_READY, 409);
  }

  const draftRecord = requireDraft(await getExamImportDraft(scopedImport));
  const validation = validateDraftForView(draftRecord.draft);

  return draftView(draftRecord, validation);
}

export async function patchExamImportDraftService(
  scope: ExamImportRequestScope,
  importId: string,
  operations: ExamImportDraftPatchOperation[]
): Promise<ExamImportDraftView> {
  requireExamImportWritesEnabled();
  try {
    return await db.transaction(async (tx) => {
      await assertCourseOrganization(scope, tx as DbOrTxClient);
      const scopedImport = importScope(scope, importId);
      const examImport = requireImport(await lockExamImportById(scopedImport, tx));
      requireDraftReady(examImport);
      const draftRecord = requireDraft(await getExamImportDraft(scopedImport, tx));
      const updatedDraft = applyExamImportDraftPatches(parseStoredDraft(draftRecord.draft), operations, {
        enabledQuestionKinds: ENABLED_QUESTION_KINDS
      });

      return storeEditedDraft(scopedImport, examImport, draftRecord, updatedDraft, tx);
    });
  } catch (error) {
    if (error instanceof ExamImportDraftPatchError) {
      throw new AppError(error.message, ErrorCodes.VALIDATION_ERROR, 400, 'operations');
    }

    throw error;
  }
}

/**
 * Applies a key that arrived as its own document.
 *
 * Papers carry their key in a second file as often as inside the paper, and a key is a key
 * however it travels. The document is read into the same `SourceRun` shape every reader
 * produces, the same carriers are recognised, and the pairs are rendered back into the one
 * compact form the answer-key path already accepts — so a second file gains no second
 * application path, no second conflict rule and no second way of being subtly different.
 *
 * The answers are attributed to the key string rather than to spans in the other document:
 * the draft has no way to quote a file it did not import, and claiming provenance it
 * cannot show would be worse than claiming none.
 */
export async function applyExamImportAnswerKeyDocumentService(
  scope: ExamImportRequestScope,
  importId: string,
  assetId: string
): Promise<ExamImportAnswerKeyView> {
  requireExamImportWritesEnabled();
  await assertCourseOrganization(scope);

  const asset = await getAssetById(assetId, scope.organizationId);
  if (
    !asset ||
    asset.kind !== 'document' ||
    asset.provider !== 'upload' ||
    asset.status !== 'active' ||
    asset.isExternal ||
    !asset.storageKey
  ) {
    throw new AppError('Answer key document was not found', ErrorCodes.EXAM_IMPORT_SOURCE_INVALID, 400, 'assetId');
  }

  const maxDocumentBytes = getUploadLimits().documentBytes;
  let bytes: Uint8Array;
  try {
    bytes = await readDocumentObjectBytes(asset.storageKey, maxDocumentBytes);
  } catch (error) {
    if (error instanceof S3ObjectSizeLimitExceededError) {
      throw new AppError(
        'Answer key document exceeds the upload limit',
        ErrorCodes.EXAM_IMPORT_SOURCE_INVALID,
        400,
        'assetId'
      );
    }

    console.error('applyExamImportAnswerKeyDocumentService read error:', error);
    throw new AppError('Answer key document could not be read', ErrorCodes.INTERNAL_ERROR, 503, 'assetId');
  }

  const fileName = asset.title?.trim() || asset.storageKey;
  const inspection = await inspectExamImportDocument(bytes, maxDocumentBytes, fileName);
  if (!inspection.supported || (inspection.detectedType !== 'docx' && inspection.detectedType !== 'pdf')) {
    throw new AppError(
      'The answer key document is not supported',
      ErrorCodes.EXAM_IMPORT_SOURCE_INVALID,
      400,
      'assetId'
    );
  }

  // The same admission gate the paper path applies. A key file goes through the same PDF
  // reader, so without this the flag closes one door and leaves the other open — and
  // turning PDF off would stop rejecting every new PDF, which is what rollback relies on.
  if (inspection.detectedType === 'pdf' && env.EXAM_IMPORT_PDF_ENABLED !== 'true') {
    throw new AppError('PDF exam import is disabled', ErrorCodes.EXAM_IMPORT_SOURCE_INVALID, 400, 'assetId');
  }

  const runs = inspection.detectedType === 'docx' ? (await readDocxRuns(bytes)).runs : (await readPdfRuns(bytes)).runs;
  const key = toCompactAnswerKey(readAnswerKeyPairsFromRuns(runs));
  if (!key) {
    throw new AppError(
      'That document states no answer key the importer could read',
      ErrorCodes.EXAM_IMPORT_ANSWER_KEY_INVALID,
      400,
      'assetId'
    );
  }

  return applyExamImportAnswerKeyService(scope, importId, key);
}

export async function applyExamImportAnswerKeyService(
  scope: ExamImportRequestScope,
  importId: string,
  key: string
): Promise<ExamImportAnswerKeyView> {
  requireExamImportWritesEnabled();
  try {
    return await db.transaction(async (tx) => {
      await assertCourseOrganization(scope, tx as DbOrTxClient);
      const scopedImport = importScope(scope, importId);
      const examImport = requireImport(await lockExamImportById(scopedImport, tx));
      requireDraftReady(examImport);
      const draftRecord = requireDraft(await getExamImportDraft(scopedImport, tx));
      const result = applyExamImportCompactAnswerKey(parseStoredDraft(draftRecord.draft), key, {
        enabledQuestionKinds: ENABLED_QUESTION_KINDS
      });
      const view = await storeEditedDraft(scopedImport, examImport, draftRecord, result.draft, tx);

      return { ...view, appliedCount: result.appliedCount };
    });
  } catch (error) {
    if (error instanceof ExamImportCompactAnswerKeyError || error instanceof ExamImportDraftPatchError) {
      throw new AppError(error.message, ErrorCodes.EXAM_IMPORT_ANSWER_KEY_INVALID, 400, 'key');
    }

    throw error;
  }
}

/** The IO-free half of the AI availability gate. See `ExamImportDraftView.aiSuggestionAvailable`. */
function isExamImportAiConfigured(): boolean {
  const connection = readGatewayConnectionFromEnv();

  return env.EXAM_IMPORT_AI_ENABLED === 'true' && Boolean(connection.baseURL && connection.authToken);
}

function organizationAllowsExamImportAi(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false;

  const examImport = (settings as Record<string, unknown>).examImport;
  if (!examImport || typeof examImport !== 'object' || Array.isArray(examImport)) return false;

  return (examImport as Record<string, unknown>).aiEnabled === true;
}

function estimateExamImportAiPromptTokens(regions: ReturnType<typeof collectExamImportAiRegions>): number {
  const regionPayloadCharacters = regions.reduce((total, region) => total + JSON.stringify(region).length, 0);

  return Math.ceil(regionPayloadCharacters / 3.5) + EXAM_IMPORT_AI_PROTOCOL_TOKEN_OVERHEAD * regions.length;
}

async function getExamImportAiSuggestionContext(
  scope: ExamImportRequestScope,
  importId: string,
  questionIds: string[]
): Promise<{ draftUpdatedAt: string; estimate: ExamImportAiSuggestionEstimate }> {
  requireExamImportWritesEnabled();
  await assertCourseOrganization(scope);
  const scopedImport = importScope(scope, importId);
  const examImport = requireImport(await getExamImportById(scopedImport));
  requireDraftReady(examImport);
  const draftRecord = requireDraft(await getExamImportDraft(scopedImport));
  const validation = validateDraftForView(draftRecord.draft);
  const regionsByQuestionId = new Map(
    collectExamImportAiRegions(validation.draft!).map((region) => [region.questionId, region])
  );
  const regions = questionIds.map((questionId) => regionsByQuestionId.get(questionId));
  if (regions.some((region) => !region)) {
    throw new AppError(
      'One or more questions are not eligible for an AI suggestion',
      ErrorCodes.VALIDATION_ERROR,
      400,
      'questionIds'
    );
  }

  const suggestableRegions = regions.filter((region): region is NonNullable<typeof region> => region !== undefined);
  const organization = await getOrganizationById(scope.organizationId);
  const settings = await getGatewaySettings();
  const requestedModel = env.EXAM_IMPORT_AI_MODEL?.trim();
  const model = requestedModel ? selectGatewayModelId(settings, requestedModel) : null;
  const modelConfig = settings.modelAllowlist.find((entry) => entry.modelId === model);
  const available =
    isExamImportAiConfigured() && organizationAllowsExamImportAi(organization?.settings) && modelConfig !== undefined;
  const estimatedPromptTokens = estimateExamImportAiPromptTokens(suggestableRegions);
  const maximumCompletionTokens = EXAM_IMPORT_AI_MAX_COMPLETION_TOKENS * suggestableRegions.length;
  const estimatedMaximumQuotaUnits = modelConfig
    ? Math.round((estimatedPromptTokens + maximumCompletionTokens) * modelConfig.quotaWeight)
    : 0;

  return {
    draftUpdatedAt: draftRecord.updatedAt,
    estimate: {
      available,
      questionCount: suggestableRegions.length,
      estimatedPromptTokens,
      maximumCompletionTokens,
      estimatedMaximumQuotaUnits,
      model: modelConfig?.modelId ?? null
    }
  };
}

export async function estimateExamImportAiSuggestionService(
  scope: ExamImportRequestScope,
  importId: string,
  questionIds: string[]
): Promise<ExamImportAiSuggestionEstimate> {
  const context = await getExamImportAiSuggestionContext(scope, importId, questionIds);

  return context.estimate;
}

export async function requestExamImportAiSuggestionService(
  scope: ExamImportRequestScope,
  importId: string,
  questionIds: string[]
): Promise<ExamImportAiSuggestionResult> {
  const context = await getExamImportAiSuggestionContext(scope, importId, questionIds);
  if (!context.estimate.available) {
    throw new AppError('AI suggestions are not available for this workspace', ErrorCodes.VALIDATION_ERROR, 409);
  }

  try {
    await enqueueExamImportAiSuggestion({
      importId,
      organizationId: scope.organizationId,
      courseId: scope.courseId,
      actorProfileId: scope.userId,
      questionIds,
      expectedDraftUpdatedAt: context.draftUpdatedAt
    });
  } catch (error) {
    console.error('requestExamImportAiSuggestionService enqueue error:', error);
    throw new AppError('AI suggestion could not be queued', ErrorCodes.INTERNAL_ERROR, 503);
  }

  return { queuedCount: questionIds.length };
}

/**
 * The settings a freshly imported paper starts on, which are the ones the create-exam form
 * already defaults to: nothing revealed, one attempt, name and class asked for, no clock
 * and no window. The exam is created `draft`, so importing never opens anything — the
 * teacher opens it from the exam's own screen once the timing is set.
 */
function examSettingsForImport(title: string, exerciseId: string): ExamSettingsInput {
  return {
    title,
    exerciseId,
    mode: 'public',
    workingSeconds: null,
    opensAt: null,
    closesAt: null,
    maxAttempts: 1,
    requiresName: true,
    requiresClass: true,
    requiresCandidateNumber: false,
    scoreVisibility: 'never',
    answerVisibility: 'never',
    commentVisibility: 'never',
    revealThreshold: null,
    autoSubmitAfterLeaves: null,
    supportContact: null,
    startWindowMinutes: null,
    shuffleQuestions: false,
    shuffleOptions: false,
    holdSharedDevice: false,
    watermark: false
  };
}

export async function publishExamImportService(
  scope: ExamImportRequestScope,
  importId: string,
  target: ExamImportPublishTarget = 'exercise'
): Promise<ExamImportPublishResult> {
  if (target === 'exam') requireExamsEnabled();

  requireExamImportWritesEnabled();
  return db
    .transaction(async (tx) => {
      const scopedImport = importScope(scope, importId);
      const examImport = requireImport(await lockExamImportById(scopedImport, tx));
      if (examImport.status === 'published') {
        if (!examImport.publishedExerciseId) {
          throw new AppError('Published exam import has no exercise', ErrorCodes.EXAM_IMPORT_PUBLISH_CONFLICT, 409);
        }

        // The exam is not recorded on the import row: the container it delivers is, and
        // an exam names its container. Resolving it here is what makes a replayed publish
        // return the same exam rather than a second one. Only asked for when an exam was
        // what the caller wanted — publishing an exercise has none to find.
        const [existing] =
          target === 'exam'
            ? await tx
                .select({ id: schema.exam.id })
                .from(schema.exam)
                .where(eq(schema.exam.exerciseId, examImport.publishedExerciseId))
                .limit(1)
            : [];

        return {
          exerciseId: examImport.publishedExerciseId,
          ...(existing ? { examId: existing.id } : {}),
          replayed: true
        };
      }

      requireDraftReady(examImport);
      await assertCourseOrganization(scope, tx as DbOrTxClient);
      const canAuthor = await isCourseTeamMemberOrOrgAdmin(scope.courseId, scope.userId, tx);
      if (!canAuthor) {
        throw new AppError('Course authoring permission was revoked', ErrorCodes.FORBIDDEN, 403);
      }

      const draftRecord = requireDraft(await getExamImportDraft(scopedImport, tx));
      const publishPlan = createExamImportPublishPlan(draftRecord.draft, {
        enabledQuestionKinds: ENABLED_QUESTION_KINDS,
        sanitizeHtml
      });
      const [orderRow] = await tx
        .select({ maxOrder: sql<number>`coalesce(max(${schema.exercise.order}), 0)` })
        .from(schema.exercise)
        .where(eq(schema.exercise.courseId, scope.courseId));

      const exercise = await createExerciseFromAuthoringPlan(
        {
          exercise: {
            title: publishPlan.title,
            courseId: scope.courseId,
            order: Number(orderRow?.maxOrder ?? 0) + 1
          },
          sections: publishPlan.sections
        },
        tx
      );

      // Published as an exam, the questions belong to a detached container: no course and
      // no lesson, so nobody enrolled can open the paper untimed. It is built through the
      // course and detached here rather than created detached, because the authoring plan
      // needs the course to check the question kinds against the course's type — and
      // because the row never exists outside this transaction, nothing ever sees it in
      // the course tree. This is the shape `copyExerciseIntoContainer` produces, reached
      // without first leaving behind the course exercise that copy exists to get away from.
      if (target === 'exam') {
        await tx
          .update(schema.exercise)
          .set({ courseId: null, lessonId: null, sectionId: null, assignmentMode: 'SELECTED_STUDENTS' })
          .where(eq(schema.exercise.id, exercise.id));
      }

      const exam =
        target === 'exam'
          ? await createExamForOrganization(
              examSettingsForImport(publishPlan.title, exercise.id),
              scope.courseId,
              scope.organizationId,
              scope.userId,
              tx as DbOrTxClient
            )
          : null;
      const publishedAt = new Date().toISOString();
      const publishedImport = await markExamImportPublished(
        scopedImport,
        {
          publishedExerciseId: exercise.id,
          publishedAt
        },
        tx
      );
      if (!publishedImport) {
        throw new AppError('Exam import publish state changed', ErrorCodes.EXAM_IMPORT_PUBLISH_CONFLICT, 409);
      }

      return { exerciseId: exercise.id, ...(exam ? { examId: exam.id } : {}), replayed: false };
    })
    .catch((error: unknown) => {
      if (error instanceof ExamImportPublishPlanError) {
        if (error.code === 'DRAFT_NOT_PUBLISHABLE') {
          throw new AppError(error.message, ErrorCodes.EXAM_IMPORT_PUBLISH_CONFLICT, 409);
        }

        console.error('publishExamImportService publish plan error:', error);
        throw new AppError('Exam import publish plan is invalid', ErrorCodes.INTERNAL_ERROR, 500);
      }

      throw error;
    });
}
