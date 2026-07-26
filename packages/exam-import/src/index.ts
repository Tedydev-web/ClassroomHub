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
