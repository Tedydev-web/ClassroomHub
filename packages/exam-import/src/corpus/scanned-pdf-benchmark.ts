import type { ExtractionMetrics } from '../metrics/exam-extraction-metrics';
import type { ReferenceExam } from '../metrics/reference-exam';
import { assessScannedPdfCorpusCoverage, type CorpusManifest, type ScannedPdfCorpusCoverage } from './corpus-manifest';

export type ScannedPdfBenchmarkResult = {
  documentId: string;
  reference: ReferenceExam;
  metrics: ExtractionMetrics;
};

/** One complete, reproducible run over the held-out physical-scan corpus. */
export type ScannedPdfBenchmarkRun = {
  runId: string;
  model: string;
  transcriptionContract: string;
  results: ScannedPdfBenchmarkResult[];
};

export type ScannedPdfBenchmarkIssueCode =
  | 'CORPUS_NOT_READY'
  | 'DUPLICATE_RUN_ID'
  | 'INCONSISTENT_MODEL'
  | 'INCONSISTENT_TRANSCRIPTION_CONTRACT'
  | 'DUPLICATE_DOCUMENT_RESULT'
  | 'MISSING_DOCUMENT_RESULT'
  | 'UNEXPECTED_DOCUMENT_RESULT'
  | 'REFERENCE_DOCUMENT_MISMATCH'
  | 'UNVERIFIED_STRUCTURE'
  | 'UNVERIFIED_ANSWER_KEYS'
  | 'UNVERIFIED_REVIEW_ROUTING'
  | 'IMPERFECT_METRIC'
  | 'SPURIOUS_QUESTIONS';

export type ScannedPdfBenchmarkIssue = {
  code: ScannedPdfBenchmarkIssueCode;
  value: string;
};

export type ScannedPdfBenchmarkAssessment = {
  corpus: ScannedPdfCorpusCoverage;
  issues: ScannedPdfBenchmarkIssue[];
  ready: boolean;
};

const REQUIRED_PERFECT_METRICS = [
  'questionRecall',
  'kindAccuracy',
  'groupingAccuracy',
  'optionCountAccuracy',
  'reviewPrecision',
  'reviewRecall'
] as const;

type RequiredPerfectMetric = (typeof REQUIRED_PERFECT_METRICS)[number];

function sourceStatesAnswers(reference: ReferenceExam): boolean {
  return reference.questions.some((question) => question.answerKey !== null);
}

function assessBenchmarkResult(
  result: ScannedPdfBenchmarkResult,
  expectedDocumentPath: string,
  issues: ScannedPdfBenchmarkIssue[],
  runId: string
): void {
  const prefix = `${runId}:${result.documentId}`;

  if (result.reference.document !== expectedDocumentPath) {
    issues.push({
      code: 'REFERENCE_DOCUMENT_MISMATCH',
      value: `${prefix}:${result.reference.document}`
    });
  }

  if (result.reference.coverage.structure !== 'verified') {
    issues.push({ code: 'UNVERIFIED_STRUCTURE', value: prefix });
  }

  if (result.reference.coverage.reviewRouting !== 'verified') {
    issues.push({ code: 'UNVERIFIED_REVIEW_ROUTING', value: prefix });
  }

  if (sourceStatesAnswers(result.reference) && result.reference.coverage.answerKeys !== 'verified') {
    issues.push({ code: 'UNVERIFIED_ANSWER_KEYS', value: prefix });
  }

  for (const metric of REQUIRED_PERFECT_METRICS) {
    if (result.metrics[metric] === 1) continue;

    issues.push({ code: 'IMPERFECT_METRIC', value: `${prefix}:${metric}=${result.metrics[metric]}` });
  }

  if (sourceStatesAnswers(result.reference) && result.metrics.answerKeyAccuracy !== 1) {
    issues.push({
      code: 'IMPERFECT_METRIC',
      value: `${prefix}:answerKeyAccuracy=${result.metrics.answerKeyAccuracy}`
    });
  }

  if (result.metrics.counts.spuriousQuestions !== 0) {
    issues.push({
      code: 'SPURIOUS_QUESTIONS',
      value: `${prefix}:${result.metrics.counts.spuriousQuestions}`
    });
  }
}

function assessBenchmarkRun(
  run: ScannedPdfBenchmarkRun,
  qualifiedDocuments: ScannedPdfCorpusCoverage['qualifiedDocuments'],
  issues: ScannedPdfBenchmarkIssue[]
): void {
  const expectedById = new Map(qualifiedDocuments.map((document) => [document.id, document]));
  const seenDocumentIds = new Set<string>();

  for (const result of run.results) {
    if (seenDocumentIds.has(result.documentId)) {
      issues.push({ code: 'DUPLICATE_DOCUMENT_RESULT', value: `${run.runId}:${result.documentId}` });
      continue;
    }

    seenDocumentIds.add(result.documentId);
    const document = expectedById.get(result.documentId);
    if (!document) {
      issues.push({ code: 'UNEXPECTED_DOCUMENT_RESULT', value: `${run.runId}:${result.documentId}` });
      continue;
    }

    assessBenchmarkResult(result, document.path, issues, run.runId);
  }

  for (const document of qualifiedDocuments) {
    if (!seenDocumentIds.has(document.id)) {
      issues.push({ code: 'MISSING_DOCUMENT_RESULT', value: `${run.runId}:${document.id}` });
    }
  }
}

/**
 * Production gate for a candidate scanned-PDF transcription model.
 *
 * It only accepts two complete, equivalent-contract runs against the held-out
 * physical-scan corpus. The caller is responsible for persisting each run's
 * source evidence; this function deliberately evaluates only durable metrics
 * and human-verified ground truth.
 */
export function assessScannedPdfBenchmarkRuns(
  manifest: CorpusManifest,
  runs: readonly [ScannedPdfBenchmarkRun, ScannedPdfBenchmarkRun]
): ScannedPdfBenchmarkAssessment {
  const corpus = assessScannedPdfCorpusCoverage(manifest);
  const issues: ScannedPdfBenchmarkIssue[] = [];

  if (!corpus.ready) {
    for (const issue of corpus.issues) {
      issues.push({ code: 'CORPUS_NOT_READY', value: `${issue.code}:${issue.value}` });
    }
  }

  const [firstRun, secondRun] = runs;
  if (firstRun.runId === secondRun.runId) {
    issues.push({ code: 'DUPLICATE_RUN_ID', value: firstRun.runId });
  }

  if (firstRun.model !== secondRun.model) {
    issues.push({ code: 'INCONSISTENT_MODEL', value: `${firstRun.model}|${secondRun.model}` });
  }

  if (firstRun.transcriptionContract !== secondRun.transcriptionContract) {
    issues.push({
      code: 'INCONSISTENT_TRANSCRIPTION_CONTRACT',
      value: `${firstRun.transcriptionContract}|${secondRun.transcriptionContract}`
    });
  }

  assessBenchmarkRun(firstRun, corpus.qualifiedDocuments, issues);
  assessBenchmarkRun(secondRun, corpus.qualifiedDocuments, issues);

  return { corpus, issues, ready: issues.length === 0 };
}
