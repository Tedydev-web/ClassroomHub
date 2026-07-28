import { describe, expect, it } from 'vitest';
import { assessScannedPdfBenchmarkRuns } from '../src/corpus/scanned-pdf-benchmark';
import type { CorpusManifest } from '../src/corpus/corpus-manifest';
import { scoreExtraction } from '../src/metrics/exam-extraction-metrics';
import type { ExtractedExam, ReferenceExam } from '../src/metrics/reference-exam';

const REQUIRED_TRAITS = ['clean-scan', 'degraded-scan', 'multi-page', 'shared-passage', 'option-boundary-risk'];

function createManifest(): CorpusManifest {
  return {
    version: 1,
    documents: Array.from({ length: 10 }, (_, index) => {
      const id = `scan-${index + 1}`;

      return {
        id,
        path: `large/${id}.pdf`,
        committed: false,
        bytes: 1_000_000,
        sha256: 'a'.repeat(64),
        format: 'pdf' as const,
        subject: 'assessment',
        languages: [index === 0 ? 'vi' : 'en'],
        pageCount: 10,
        captureKind: 'physical_scan' as const,
        evaluationSplit: 'held_out' as const,
        source: { locator: `internal:${id}.pdf`, usageRights: 'test fixture' },
        note: '',
        traits: index === 0 ? REQUIRED_TRAITS : ['multi-page'],
        reference: `references/${id}.reference.json`
      };
    })
  };
}

function createReference(document: string): ReferenceExam {
  return {
    document,
    note: 'verified scan benchmark fixture',
    coverage: {
      structure: 'verified',
      answerKeys: 'verified',
      optionText: 'unlabelled',
      reviewRouting: 'verified'
    },
    provenance: 'hand-verified for benchmark gate tests',
    questions: [
      {
        number: '1',
        kind: 'choice',
        groupId: null,
        optionCount: 4,
        answerKey: ['A'],
        prompt: null,
        options: null,
        reviewRequired: true
      }
    ]
  };
}

function faithfulExtraction(reference: ReferenceExam): ExtractedExam {
  return { questions: reference.questions.map((question) => ({ ...question })) };
}

function createRun(runId: string, manifest: CorpusManifest) {
  return {
    runId,
    model: 'vision-model-pinned',
    transcriptionContract: 'scan-contract-v1',
    results: manifest.documents.map((document) => {
      const reference = createReference(document.path);

      return {
        documentId: document.id,
        reference,
        metrics: scoreExtraction(reference, faithfulExtraction(reference))
      };
    })
  };
}

describe('scanned-PDF benchmark gate', () => {
  it('accepts two complete, pinned, perfect runs over the held-out physical corpus', () => {
    const manifest = createManifest();
    const assessment = assessScannedPdfBenchmarkRuns(manifest, [
      createRun('run-one', manifest),
      createRun('run-two', manifest)
    ]);

    expect(assessment.ready).toBe(true);
    expect(assessment.issues).toEqual([]);
  });

  it('rejects an inconsistent model or transcription contract', () => {
    const manifest = createManifest();
    const firstRun = createRun('run-one', manifest);
    const secondRun = createRun('run-two', manifest);
    secondRun.model = 'other-vision-model';
    secondRun.transcriptionContract = 'scan-contract-v2';

    const assessment = assessScannedPdfBenchmarkRuns(manifest, [firstRun, secondRun]);

    expect(assessment.ready).toBe(false);
    expect(assessment.issues).toEqual(
      expect.arrayContaining([
        { code: 'INCONSISTENT_MODEL', value: 'vision-model-pinned|other-vision-model' },
        { code: 'INCONSISTENT_TRANSCRIPTION_CONTRACT', value: 'scan-contract-v1|scan-contract-v2' }
      ])
    );
  });

  it('rejects one run submitted twice as evidence for two runs', () => {
    const manifest = createManifest();
    const firstRun = createRun('same-run', manifest);
    const secondRun = createRun('same-run', manifest);

    const assessment = assessScannedPdfBenchmarkRuns(manifest, [firstRun, secondRun]);

    expect(assessment.ready).toBe(false);
    expect(assessment.issues).toContainEqual({ code: 'DUPLICATE_RUN_ID', value: 'same-run' });
  });

  it('rejects results that are missing, duplicate, or not from their declared source document', () => {
    const manifest = createManifest();
    const firstRun = createRun('run-one', manifest);
    const secondRun = createRun('run-two', manifest);
    firstRun.results[1] = firstRun.results[0]!;
    secondRun.results[0]!.reference.document = 'large/wrong-document.pdf';

    const assessment = assessScannedPdfBenchmarkRuns(manifest, [firstRun, secondRun]);

    expect(assessment.ready).toBe(false);
    expect(assessment.issues).toEqual(
      expect.arrayContaining([
        { code: 'DUPLICATE_DOCUMENT_RESULT', value: 'run-one:scan-1' },
        { code: 'MISSING_DOCUMENT_RESULT', value: 'run-one:scan-2' },
        { code: 'REFERENCE_DOCUMENT_MISMATCH', value: 'run-two:scan-1:large/wrong-document.pdf' }
      ])
    );
  });

  it('rejects unverified ground truth, imperfect routing, answer keys, and invented questions', () => {
    const manifest = createManifest();
    const firstRun = createRun('run-one', manifest);
    const secondRun = createRun('run-two', manifest);
    const result = secondRun.results[0]!;
    result.reference.coverage.structure = 'proposed';
    result.reference.coverage.answerKeys = 'proposed';
    result.reference.coverage.reviewRouting = 'proposed';
    result.metrics.questionRecall = null;
    result.metrics.reviewPrecision = 0;
    result.metrics.reviewRecall = 0;
    result.metrics.answerKeyAccuracy = 0;
    result.metrics.counts.spuriousQuestions = 1;

    const assessment = assessScannedPdfBenchmarkRuns(manifest, [firstRun, secondRun]);

    expect(assessment.ready).toBe(false);
    expect(assessment.issues).toEqual(
      expect.arrayContaining([
        { code: 'UNVERIFIED_STRUCTURE', value: 'run-two:scan-1' },
        { code: 'UNVERIFIED_ANSWER_KEYS', value: 'run-two:scan-1' },
        { code: 'UNVERIFIED_REVIEW_ROUTING', value: 'run-two:scan-1' },
        { code: 'IMPERFECT_METRIC', value: 'run-two:scan-1:questionRecall=null' },
        { code: 'IMPERFECT_METRIC', value: 'run-two:scan-1:reviewPrecision=0' },
        { code: 'IMPERFECT_METRIC', value: 'run-two:scan-1:reviewRecall=0' },
        { code: 'IMPERFECT_METRIC', value: 'run-two:scan-1:answerKeyAccuracy=0' },
        { code: 'SPURIOUS_QUESTIONS', value: 'run-two:scan-1:1' }
      ])
    );
  });
});
