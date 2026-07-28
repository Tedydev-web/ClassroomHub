export {
  emptyFormatting,
  normalizeComparableText,
  sourceRunSchema,
  sourceRunStreamSchema,
  type BlockContext,
  type RunFormatting,
  type SourceLocation,
  type SourceRun
} from './source-run';

export {
  assertReferenceIsScoreable,
  LABEL_STATES,
  pendingLayers,
  REFERENCE_QUESTION_KINDS,
  referenceCoverageSchema,
  referenceExamSchema,
  UnscoreableReferenceError,
  type ExtractedExam,
  type LabelState,
  type ReferenceCoverage,
  type ReferenceExam,
  type ReferenceQuestion,
  type ReferenceQuestionKind
} from './metrics/reference-exam';

export { formatMetrics, scoreExtraction, type ExtractionMetrics } from './metrics/exam-extraction-metrics';

export {
  DEFAULT_DOCX_LIMITS,
  DOCX_PART,
  DocxPackageError,
  openDocxPackage,
  type DocxPackage,
  type DocxPackageLimits
} from './docx/docx-package';

export {
  isListNumberFormat,
  LIST_NUMBER_FORMATS,
  renderListLabel,
  renderListLabelForCounter,
  type ListLevelDefinition,
  type ListNumberFormat
} from './docx/list-label';

export {
  findListLevel,
  parseNumberingDefinitions,
  type ListDefinition,
  type ListDefinitions
} from './docx/numbering-definitions';

export {
  readDocxRuns,
  type DocxReadResult,
  type DocxReadWarning,
  type DocxReadWarningCode
} from './docx/read-docx-runs';

export {
  assessScannedPdfCorpusCoverage,
  corpusManifestSchema,
  formatCorpusAvailability,
  resolveCorpusAvailability,
  SCANNED_PDF_CORPUS_REQUIREMENTS,
  type CorpusAvailability,
  type CorpusDocument,
  type CorpusManifest,
  type ScannedPdfCorpusCoverage,
  type ScannedPdfCorpusCoverageIssue
} from './corpus/corpus-manifest';

export {
  EXAM_IMPORT_PUBLISHABLE_QUESTION_KINDS,
  EXAM_IMPORT_SCHEMA_VERSION,
  examImportAnswerSourceSchema,
  examImportConfidenceSchema,
  examImportDiagnosticSchema,
  examImportDraftSchema,
  examImportFieldTargetSchema,
  examImportQuestionSchema,
  examImportSourceSpanSchema,
  type ExamImportAnswerSource,
  type ExamImportConfidence,
  type ExamImportDiagnostic,
  type ExamImportDraft,
  type ExamImportFieldState,
  type ExamImportFieldTarget,
  type ExamImportPublishableQuestionKind,
  type ExamImportQuestion,
  type ExamImportSourceSpan
} from './draft/exam-import-draft';

export { mapExamImportDraftHtml } from './draft/exam-import-authored-html';
export { harvestExamImportAnswerCandidates } from './draft/exam-import-answer-harvesting';
export {
  MAX_EXAM_IMPORT_AI_REGIONS,
  applyExamImportAiRegionResponse,
  collectExamImportAiRegions,
  examImportAiRegionReasonSchema,
  examImportAiRegionResponseSchema,
  type ApplyExamImportAiRegionResponseResult,
  type ExamImportAiRegion,
  type ExamImportAiRegionReason,
  type ExamImportAiRegionResponse
} from './draft/exam-import-ai-regions';
export { createExamImportDraftFromRuns, createValidatedExamImportDraftFromRuns } from './draft/exam-import-pipeline';
export { reconcileExamImportDraftAnswers } from './draft/exam-import-reconciliation';
export { segmentExamImportRuns } from './draft/exam-import-segmentation';

export { examImportDraftToExtractedExam } from './metrics/exam-import-draft-metrics';

export {
  collectExamImportSemanticFindings,
  synchronizeExamImportDraftReviewStates,
  validateExamImportAssistedFindings,
  validateExamImportDraft,
  validateExamImportDraftStructure,
  type ExamImportSemanticValidationContext,
  type ExamImportAssistedValidationResult,
  type ExamImportStructuralValidationResult,
  type ExamImportValidationContext,
  type ExamImportValidationResult
} from './draft/exam-import-validation';

export {
  MAX_EXAM_IMPORT_DRAFT_PATCH_OPERATIONS,
  ExamImportDraftPatchError,
  applyExamImportDraftPatches,
  examImportAnswerKeyPatchSchema,
  examImportDraftPatchOperationSchema,
  type ExamImportAnswerKeyPatch,
  type ExamImportDraftPatchErrorCode,
  type ExamImportDraftPatchOperation
} from './draft/exam-import-draft-patch';

export {
  MAX_EXAM_IMPORT_COMPACT_ANSWER_KEY_LENGTH,
  ExamImportCompactAnswerKeyError,
  applyExamImportCompactAnswerKey,
  type ApplyExamImportCompactAnswerKeyResult,
  type ExamImportCompactAnswerKeyErrorCode
} from './draft/exam-import-compact-answer-key';

export {
  inspectExamImportDocument,
  type ExamImportDocumentCapabilityReason,
  type ExamImportDocumentInspection,
  type ExamImportDocumentType
} from './document/exam-import-document-capability';

export {
  DEFAULT_EXAM_IMPORT_QUESTION_POINTS,
  ExamImportPublishPlanError,
  createExamImportPublishPlan,
  type ExamImportAssessmentItemPlan,
  type ExamImportLegacyQuestionPlan,
  type ExamImportPublishPlan,
  type ExamImportPublishPlanErrorCode,
  type ExamImportPublishSectionPlan
} from './publish/exam-import-publish-plan';

export {
  PdfReadError,
  readPdfRuns,
  type PdfReadErrorCode,
  type PdfReadResult,
  type PdfReadWarning,
  type PdfReadWarningCode,
  type PdfWeakEmphasis
} from './pdf/read-pdf-runs';

export {
  SCANNED_PDF_RASTER_LIMITS,
  ScannedPdfRasterError,
  readScannedPdfPageRasters,
  selectScannedPdfPageRaster,
  visitScannedPdfPageRasters,
  type ScannedPdfPageRasterResult,
  type ScannedPdfPageRasterSummary,
  type ScannedPdfRasterErrorCode,
  type ScannedPdfRasterLimits
} from './pdf/read-scanned-pdf-page-rasters';

export {
  MAX_SCANNED_PDF_TRANSCRIPTION_LINES_PER_PAGE,
  MAX_SCANNED_PDF_TRANSCRIPTION_LINE_LENGTH,
  markExamImportDraftAsAiDerived,
  scannedPdfPageTranscriptionSchema,
  scannedPdfTranscriptionsToSourceRuns,
  type ScannedPdfPageTranscription
} from './pdf/scanned-pdf-transcription';

export {
  type PdfEmbeddedImage,
  type PdfImagePixelFormat,
  type PdfOperatorWarning,
  type PdfOperatorWarningCode
} from './pdf/pdf-operators';

export {
  AikenParseError,
  MAX_AIKEN_INPUT_CHARACTERS,
  parseAiken,
  type AikenDiagnostic,
  type AikenDiagnosticCode,
  type AikenDiagnosticKind,
  type AikenParseMetadata
} from './interchange/aiken';

export {
  parseGift,
  MAX_GIFT_INPUT_CHARACTERS,
  type GiftFeedback,
  type GiftImportSource,
  type GiftParseInput,
  type GiftParseResult
} from './interchange/gift';
