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
  corpusManifestSchema,
  formatCorpusAvailability,
  resolveCorpusAvailability,
  type CorpusAvailability,
  type CorpusDocument,
  type CorpusManifest
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
export { createExamImportDraftFromRuns, createValidatedExamImportDraftFromRuns } from './draft/exam-import-pipeline';
export { reconcileExamImportDraftAnswers } from './draft/exam-import-reconciliation';
export { segmentExamImportRuns } from './draft/exam-import-segmentation';

export { examImportDraftToExtractedExam } from './metrics/exam-import-draft-metrics';

export {
  collectExamImportSemanticFindings,
  validateExamImportAssistedFindings,
  validateExamImportDraft,
  validateExamImportDraftStructure,
  type ExamImportSemanticValidationContext,
  type ExamImportAssistedValidationResult,
  type ExamImportStructuralValidationResult,
  type ExamImportValidationContext,
  type ExamImportValidationResult
} from './draft/exam-import-validation';
