import * as z from 'zod';
import { examImportDraftSchema } from '../draft/exam-import-draft';
import { examImportDraftToExtractedExam } from '../metrics/exam-import-draft-metrics';
import { scoreExtraction } from '../metrics/exam-extraction-metrics';
import type { ReferenceExam } from '../metrics/reference-exam';
import { assessScannedPdfCorpusCoverage, type CorpusManifest, type ScannedPdfCorpusCoverage } from './corpus-manifest';

export const scannedPdfBenchmarkResultSchema = z.strictObject({
  documentId: z.string().min(1),
  /** The stored import draft produced by this exact model run. */
  draft: examImportDraftSchema
});

export type ScannedPdfBenchmarkResult = z.infer<typeof scannedPdfBenchmarkResultSchema>;

/** One complete, reproducible run over the held-out physical-scan corpus. */
export const scannedPdfBenchmarkRunSchema = z.strictObject({
  runId: z.string().min(1),
  model: z.string().min(1),
  transcriptionContract: z.string().min(1),
  results: z.array(scannedPdfBenchmarkResultSchema).min(1)
});

export type ScannedPdfBenchmarkRun = z.infer<typeof scannedPdfBenchmarkRunSchema>;

export type ScannedPdfBenchmarkIssueCode =
  | 'CORPUS_NOT_READY'
  | 'DUPLICATE_RUN_ID'
  | 'INCONSISTENT_MODEL'
  | 'INCONSISTENT_TRANSCRIPTION_CONTRACT'
  | 'DUPLICATE_DOCUMENT_RESULT'
  | 'MISSING_DOCUMENT_RESULT'
  | 'UNEXPECTED_DOCUMENT_RESULT'
  | 'MISSING_REFERENCE'
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
  reference: ReferenceExam,
  issues: ScannedPdfBenchmarkIssue[],
  runId: string
): void {
  const prefix = `${runId}:${result.documentId}`;

  if (reference.document !== expectedDocumentPath || result.draft.source.fileName !== expectedDocumentPath) {
    issues.push({
      code: 'REFERENCE_DOCUMENT_MISMATCH',
      value: `${prefix}:${expectedDocumentPath}|${reference.document}|${result.draft.source.fileName}`
    });
  }

  if (reference.coverage.structure !== 'verified') {
    issues.push({ code: 'UNVERIFIED_STRUCTURE', value: prefix });
  }

  if (reference.coverage.reviewRouting !== 'verified') {
    issues.push({ code: 'UNVERIFIED_REVIEW_ROUTING', value: prefix });
  }

  if (sourceStatesAnswers(reference) && reference.coverage.answerKeys !== 'verified') {
    issues.push({ code: 'UNVERIFIED_ANSWER_KEYS', value: prefix });
  }

  const metrics = scoreExtraction(reference, examImportDraftToExtractedExam(result.draft));
  for (const metric of REQUIRED_PERFECT_METRICS) {
    if (metrics[metric] === 1) continue;

    issues.push({ code: 'IMPERFECT_METRIC', value: `${prefix}:${metric}=${metrics[metric]}` });
  }

  if (sourceStatesAnswers(reference) && metrics.answerKeyAccuracy !== 1) {
    issues.push({
      code: 'IMPERFECT_METRIC',
      value: `${prefix}:answerKeyAccuracy=${metrics.answerKeyAccuracy}`
    });
  }

  if (metrics.counts.spuriousQuestions !== 0) {
    issues.push({
      code: 'SPURIOUS_QUESTIONS',
      value: `${prefix}:${metrics.counts.spuriousQuestions}`
    });
  }
}

function assessBenchmarkRun(
  run: ScannedPdfBenchmarkRun,
  qualifiedDocuments: ScannedPdfCorpusCoverage['qualifiedDocuments'],
  references: ReadonlyMap<string, ReferenceExam>,
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

    const reference = references.get(document.id);
    if (!reference) continue;

    assessBenchmarkResult(result, document.path, reference, issues, run.runId);
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
  references: ReadonlyMap<string, ReferenceExam>,
  runs: readonly [ScannedPdfBenchmarkRun, ScannedPdfBenchmarkRun]
): ScannedPdfBenchmarkAssessment {
  const corpus = assessScannedPdfCorpusCoverage(manifest);
  const issues: ScannedPdfBenchmarkIssue[] = [];

  if (!corpus.ready) {
    for (const issue of corpus.issues) {
      issues.push({ code: 'CORPUS_NOT_READY', value: `${issue.code}:${issue.value}` });
    }
  }

  for (const document of corpus.qualifiedDocuments) {
    if (references.has(document.id)) continue;

    issues.push({ code: 'MISSING_REFERENCE', value: document.id });
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

  assessBenchmarkRun(firstRun, corpus.qualifiedDocuments, references, issues);
  assessBenchmarkRun(secondRun, corpus.qualifiedDocuments, references, issues);

  return { corpus, issues, ready: issues.length === 0 };
}
