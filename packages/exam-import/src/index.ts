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
  REFERENCE_QUESTION_KINDS,
  referenceExamSchema,
  UnscoreableReferenceError,
  type ExtractedExam,
  type ReferenceExam,
  type ReferenceQuestion,
  type ReferenceQuestionKind
} from './metrics/reference-exam';

export { formatMetrics, scoreExtraction, type ExtractionMetrics } from './metrics/exam-extraction-metrics';

export {
  corpusManifestSchema,
  formatCorpusAvailability,
  resolveCorpusAvailability,
  type CorpusAvailability,
  type CorpusDocument,
  type CorpusManifest
} from './corpus/corpus-manifest';
