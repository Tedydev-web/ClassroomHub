import { describe, expect, it } from 'vitest';
import { assessScannedPdfBenchmarkRuns, scannedPdfBenchmarkRunSchema } from '../src/corpus/scanned-pdf-benchmark';
import type { CorpusManifest } from '../src/corpus/corpus-manifest';
import { parseGift } from '../src/interchange/gift';
import type { ExamImportDraft } from '../src/draft/exam-import-draft';
import type { ReferenceExam } from '../src/metrics/reference-exam';

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
        answerKey: ['1'],
        prompt: null,
        options: null,
        reviewRequired: true
      }
    ]
  };
}

function createDraft(document: string): ExamImportDraft {
  const { draft } = parseGift({
    text: '::1::Which answer is correct? {=Correct ~Incorrect one ~Incorrect two ~Incorrect three}',
    source: {
      assetId: 'benchmark-asset',
      fileName: document,
      mimeType: 'application/pdf'
    }
  });
  const question = draft.sections[0]?.questions[0];
  if (!question) throw new Error('Expected benchmark draft to contain one question');

  question.review = 'needs_attention';
  return draft;
}

function createRun(runId: string, manifest: CorpusManifest) {
  return {
    runId,
    model: 'vision-model-pinned',
    transcriptionContract: 'scan-contract-v1',
    results: manifest.documents.map((document) => {
      return {
        documentId: document.id,
        draft: createDraft(document.path)
      };
    })
  };
}

function createReferences(manifest: CorpusManifest): ReadonlyMap<string, ReferenceExam> {
  return new Map(manifest.documents.map((document) => [document.id, createReference(document.path)]));
}

describe('scanned-PDF benchmark gate', () => {
  it('requires non-empty run provenance and a complete draft artifact at the JSON boundary', () => {
    const manifest = createManifest();
    const run = createRun('run-one', manifest);

    expect(scannedPdfBenchmarkRunSchema.safeParse(run).success).toBe(true);
    expect(scannedPdfBenchmarkRunSchema.safeParse({ ...run, runId: '' }).success).toBe(false);
    expect(scannedPdfBenchmarkRunSchema.safeParse({ ...run, model: '' }).success).toBe(false);
    expect(scannedPdfBenchmarkRunSchema.safeParse({ ...run, transcriptionContract: '' }).success).toBe(false);
    expect(scannedPdfBenchmarkRunSchema.safeParse({ ...run, results: [] }).success).toBe(false);
  });

  it('accepts two complete, pinned, perfect runs over the held-out physical corpus', () => {
    const manifest = createManifest();
    const references = createReferences(manifest);
    const assessment = assessScannedPdfBenchmarkRuns(manifest, references, [
      createRun('run-one', manifest),
      createRun('run-two', manifest)
    ]);

    expect(assessment.ready).toBe(true);
    expect(assessment.issues).toEqual([]);
  });

  it('rejects an inconsistent model or transcription contract', () => {
    const manifest = createManifest();
    const references = createReferences(manifest);
    const firstRun = createRun('run-one', manifest);
    const secondRun = createRun('run-two', manifest);
    secondRun.model = 'other-vision-model';
    secondRun.transcriptionContract = 'scan-contract-v2';

    const assessment = assessScannedPdfBenchmarkRuns(manifest, references, [firstRun, secondRun]);

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
    const references = createReferences(manifest);
    const firstRun = createRun('same-run', manifest);
    const secondRun = createRun('same-run', manifest);

    const assessment = assessScannedPdfBenchmarkRuns(manifest, references, [firstRun, secondRun]);

    expect(assessment.ready).toBe(false);
    expect(assessment.issues).toContainEqual({ code: 'DUPLICATE_RUN_ID', value: 'same-run' });
  });

  it('rejects results that are missing, duplicate, or not from their declared source document', () => {
    const manifest = createManifest();
    const references = createReferences(manifest);
    const firstRun = createRun('run-one', manifest);
    const secondRun = createRun('run-two', manifest);
    firstRun.results[1] = firstRun.results[0]!;
    const firstReference = references.get('scan-1');
    if (!firstReference) throw new Error('Expected scan-1 reference');

    firstReference.document = 'large/wrong-document.pdf';

    const assessment = assessScannedPdfBenchmarkRuns(manifest, references, [firstRun, secondRun]);

    expect(assessment.ready).toBe(false);
    expect(assessment.issues).toEqual(
      expect.arrayContaining([
        { code: 'DUPLICATE_DOCUMENT_RESULT', value: 'run-one:scan-1' },
        { code: 'MISSING_DOCUMENT_RESULT', value: 'run-one:scan-2' },
        {
          code: 'REFERENCE_DOCUMENT_MISMATCH',
          value: 'run-two:scan-1:large/scan-1.pdf|large/wrong-document.pdf|large/scan-1.pdf'
        }
      ])
    );
  });

  it('rejects a reference and draft that agree on the wrong source document', () => {
    const manifest = createManifest();
    const references = createReferences(manifest);
    const firstRun = createRun('run-one', manifest);
    const secondRun = createRun('run-two', manifest);
    const reference = references.get('scan-1');
    const questionDraft = secondRun.results[0]?.draft;
    if (!reference || !questionDraft) throw new Error('Expected scan-1 benchmark artifacts');

    reference.document = 'large/wrong-document.pdf';
    questionDraft.source.fileName = 'large/wrong-document.pdf';

    const assessment = assessScannedPdfBenchmarkRuns(manifest, references, [firstRun, secondRun]);

    expect(assessment.ready).toBe(false);
    expect(assessment.issues).toContainEqual({
      code: 'REFERENCE_DOCUMENT_MISMATCH',
      value: 'run-two:scan-1:large/scan-1.pdf|large/wrong-document.pdf|large/wrong-document.pdf'
    });
  });

  it('rejects unverified ground truth without treating an unmeasured layer as a score', () => {
    const manifest = createManifest();
    const references = createReferences(manifest);
    const firstRun = createRun('run-one', manifest);
    const secondRun = createRun('run-two', manifest);
    const reference = references.get('scan-1');
    if (!reference) throw new Error('Expected scan-1 benchmark reference');

    reference.coverage.structure = 'proposed';
    reference.coverage.answerKeys = 'proposed';
    reference.coverage.reviewRouting = 'proposed';

    const assessment = assessScannedPdfBenchmarkRuns(manifest, references, [firstRun, secondRun]);

    expect(assessment.ready).toBe(false);
    expect(assessment.issues).toEqual(
      expect.arrayContaining([
        { code: 'UNVERIFIED_STRUCTURE', value: 'run-two:scan-1' },
        { code: 'UNVERIFIED_ANSWER_KEYS', value: 'run-two:scan-1' },
        { code: 'UNVERIFIED_REVIEW_ROUTING', value: 'run-two:scan-1' },
        { code: 'IMPERFECT_METRIC', value: 'run-two:scan-1:questionRecall=null' },
        { code: 'IMPERFECT_METRIC', value: 'run-two:scan-1:reviewPrecision=null' },
        { code: 'IMPERFECT_METRIC', value: 'run-two:scan-1:reviewRecall=null' },
        { code: 'IMPERFECT_METRIC', value: 'run-two:scan-1:answerKeyAccuracy=null' }
      ])
    );
  });

  it('derives failure metrics from the recorded draft rather than accepting caller-supplied scores', () => {
    const manifest = createManifest();
    const references = createReferences(manifest);
    const firstRun = createRun('run-one', manifest);
    const secondRun = createRun('run-two', manifest);
    const question = secondRun.results[0]?.draft.sections[0]?.questions[0];
    if (!question) throw new Error('Expected scan-1 benchmark question');

    question.sourceNumber = '99';

    const assessment = assessScannedPdfBenchmarkRuns(manifest, references, [firstRun, secondRun]);

    expect(assessment.ready).toBe(false);
    expect(assessment.issues).toEqual(
      expect.arrayContaining([
        { code: 'IMPERFECT_METRIC', value: 'run-two:scan-1:questionRecall=0' },
        { code: 'IMPERFECT_METRIC', value: 'run-two:scan-1:kindAccuracy=null' },
        { code: 'IMPERFECT_METRIC', value: 'run-two:scan-1:groupingAccuracy=0' },
        { code: 'IMPERFECT_METRIC', value: 'run-two:scan-1:optionCountAccuracy=0' },
        { code: 'IMPERFECT_METRIC', value: 'run-two:scan-1:reviewPrecision=0' },
        { code: 'IMPERFECT_METRIC', value: 'run-two:scan-1:reviewRecall=0' },
        { code: 'IMPERFECT_METRIC', value: 'run-two:scan-1:answerKeyAccuracy=0' },
        { code: 'SPURIOUS_QUESTIONS', value: 'run-two:scan-1:1' }
      ])
    );
  });

  it('rejects a held-out document without a reference artifact', () => {
    const manifest = createManifest();
    const references = createReferences(manifest);
    const incompleteReferences = new Map(references);
    incompleteReferences.delete('scan-10');
    const assessment = assessScannedPdfBenchmarkRuns(manifest, incompleteReferences, [
      createRun('run-one', manifest),
      createRun('run-two', manifest)
    ]);

    expect(assessment.ready).toBe(false);
    expect(assessment.issues).toContainEqual({ code: 'MISSING_REFERENCE', value: 'scan-10' });
  });
});
