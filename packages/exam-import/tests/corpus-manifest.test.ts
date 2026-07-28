import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assessScannedPdfCorpusCoverage,
  corpusManifestSchema,
  formatCorpusAvailability,
  resolveCorpusAvailability,
  type CorpusManifest
} from '../src/corpus/corpus-manifest';
import {
  assertReferenceIsScoreable,
  pendingLayers,
  referenceExamSchema,
  UnscoreableReferenceError
} from '../src/metrics/reference-exam';

const CORPUS_ROOT = join(__dirname, '..', '..', '..', 'fixtures', 'exams');

function loadManifest(): CorpusManifest {
  const raw = JSON.parse(readFileSync(join(CORPUS_ROOT, 'manifest.json'), 'utf-8'));

  return corpusManifestSchema.parse(raw);
}

describe('corpus manifest', () => {
  it('the committed manifest is valid', () => {
    expect(() => loadManifest()).not.toThrow();
  });

  it('every document declares at least one trait, so nothing is in the corpus by accident', () => {
    for (const document of loadManifest().documents) {
      expect(document.traits.length).toBeGreaterThan(0);
    }
  });

  it('every document that claims to be committed is actually on disk', () => {
    const manifest = loadManifest();
    const availability = resolveCorpusAvailability(manifest, (path) => existsSync(join(CORPUS_ROOT, path)));

    expect(availability.hasBrokenCheckout).toBe(false);
  });

  it('every document points at a reference file that exists and parses', () => {
    for (const document of loadManifest().documents) {
      const referencePath = join(CORPUS_ROOT, document.reference);
      expect(existsSync(referencePath), `missing reference for ${document.id}`).toBe(true);
      expect(() => referenceExamSchema.parse(JSON.parse(readFileSync(referencePath, 'utf-8')))).not.toThrow();
    }
  });

  it('refuses to score a reference whose every layer is still awaiting a human', () => {
    const references = loadManifest().documents.map((document) =>
      referenceExamSchema.parse(JSON.parse(readFileSync(join(CORPUS_ROOT, document.reference), 'utf-8')))
    );

    for (const reference of references) {
      if (pendingLayers(reference).length < Object.keys(reference.coverage).length) continue;

      expect(() => assertReferenceIsScoreable(reference)).toThrow(UnscoreableReferenceError);
    }
  });

  // The six structural facts below were confirmed against the source document
  // on 2026-07-26. Pinning them here turns that one-off review into a standing
  // guard: a later edit that changes the shape of the ground truth has to
  // change this test too, and say why.
  it('holds the verified structure of the reference exam', () => {
    const reference = referenceExamSchema.parse(
      JSON.parse(
        readFileSync(join(CORPUS_ROOT, 'references/2026-en-on-luyen-03-scan-converted.reference.json'), 'utf-8')
      )
    );

    expect(reference.coverage.structure).toBe('verified');
    expect(reference.coverage.answerKeys).toBe('verified');
    expect(() => assertReferenceIsScoreable(reference)).not.toThrow();

    expect(reference.questions).toHaveLength(40);
    expect(reference.questions.map((question) => question.number)).toEqual(
      Array.from({ length: 40 }, (_, index) => String(index + 1))
    );
    expect(reference.questions.every((question) => question.kind === 'choice')).toBe(true);
    expect(reference.questions.every((question) => question.optionCount === 4)).toBe(true);
    // The source states no key anywhere, which is a fact about the paper.
    expect(reference.questions.every((question) => question.answerKey === null)).toBe(true);

    const groupSizes = new Map<string, number>();
    for (const question of reference.questions) {
      if (question.groupId === null) continue;
      groupSizes.set(question.groupId, (groupSizes.get(question.groupId) ?? 0) + 1);
    }

    expect([...groupSizes.values()].sort((a, b) => a - b)).toEqual([5, 6, 6, 8, 10]);
    // Q36-40 each carry their own sentence set, so they group with nothing.
    expect(reference.questions.filter((question) => question.groupId === null).map((q) => q.number)).toEqual([
      '36',
      '37',
      '38',
      '39',
      '40'
    ]);
  });

  it('every reference records how its labels were established', () => {
    for (const document of loadManifest().documents) {
      const reference = referenceExamSchema.parse(
        JSON.parse(readFileSync(join(CORPUS_ROOT, document.reference), 'utf-8'))
      );

      expect(reference.provenance.length, `${document.id} has no provenance`).toBeGreaterThan(0);
    }
  });

  it('rejects a manifest with an unknown key rather than ignoring it', () => {
    const manifest = loadManifest();
    const tampered = { ...manifest, unexpected: true };

    expect(corpusManifestSchema.safeParse(tampered).success).toBe(false);
  });

  it('rejects a checksum that is not a full sha256', () => {
    const manifest = loadManifest();
    const tampered = {
      ...manifest,
      documents: [{ ...manifest.documents[0]!, sha256: 'abc123' }]
    };

    expect(corpusManifestSchema.safeParse(tampered).success).toBe(false);
  });

  it('requires provenance and usage rights for every benchmark document', () => {
    const manifest = loadManifest();
    const documentWithoutSource = { ...manifest.documents[0]!, source: undefined };
    const tampered = { ...manifest, documents: [documentWithoutSource] };

    expect(corpusManifestSchema.safeParse(tampered).success).toBe(false);
  });

  it('requires acquisition and evaluation metadata for every benchmark document', () => {
    const manifest = loadManifest();
    const documentWithoutSplit = { ...manifest.documents[0]!, evaluationSplit: undefined };
    const tampered = { ...manifest, documents: [documentWithoutSplit] };

    expect(corpusManifestSchema.safeParse(tampered).success).toBe(false);
  });
});

describe('corpus availability', () => {
  const manifest: CorpusManifest = {
    version: 1,
    documents: [
      {
        id: 'committed-one',
        path: 'small.docx',
        committed: true,
        bytes: 100,
        sha256: 'a'.repeat(64),
        format: 'docx',
        subject: 'maths',
        languages: ['en'],
        pageCount: null,
        captureKind: 'native_digital',
        evaluationSplit: 'regression',
        source: { locator: 'internal:small.docx', usageRights: 'test fixture' },
        note: '',
        traits: ['answer-table'],
        reference: 'references/small.reference.json'
      },
      {
        id: 'large-one',
        path: 'large/big.pdf',
        committed: false,
        bytes: 1_000_000,
        sha256: 'b'.repeat(64),
        format: 'pdf',
        subject: 'maths',
        languages: ['en'],
        pageCount: 5,
        captureKind: 'physical_scan',
        evaluationSplit: 'held_out',
        source: { locator: 'internal:big.pdf', usageRights: 'test fixture' },
        note: '',
        traits: ['pure-scan'],
        reference: 'references/big.reference.json'
      }
    ]
  };

  it('separates present from absent documents', () => {
    const availability = resolveCorpusAvailability(manifest, (path) => path === 'small.docx');

    expect(availability.available.map((document) => document.id)).toEqual(['committed-one']);
    expect(availability.missing.map((document) => document.id)).toEqual(['large-one']);
  });

  it('an absent uncommitted document is incomplete, not broken', () => {
    const availability = resolveCorpusAvailability(manifest, (path) => path === 'small.docx');

    expect(availability.hasBrokenCheckout).toBe(false);
  });

  it('an absent committed document means the checkout is broken', () => {
    const availability = resolveCorpusAvailability(manifest, () => false);

    expect(availability.hasBrokenCheckout).toBe(true);
  });

  it('names every missing document with the reason it is missing', () => {
    const report = formatCorpusAvailability(resolveCorpusAvailability(manifest, () => false));

    expect(report).toContain('committed-one');
    expect(report).toContain('checkout is incomplete');
    expect(report).toContain('large-one');
    expect(report).toContain('not committed by design');
  });
});

describe('scanned-PDF corpus coverage', () => {
  function physicalScan(id: string, language: string, traits: string[]): CorpusManifest['documents'][number] {
    return {
      id,
      path: `large/${id}.pdf`,
      committed: false,
      bytes: 1_000_000,
      sha256: 'a'.repeat(64),
      format: 'pdf',
      subject: 'assessment',
      languages: [language],
      pageCount: 10,
      captureKind: 'physical_scan',
      evaluationSplit: 'held_out',
      source: { locator: `internal:${id}.pdf`, usageRights: 'test fixture' },
      note: '',
      traits,
      reference: `references/${id}.reference.json`
    };
  }

  it('excludes synthetic and regression documents from the release corpus', () => {
    const manifest = loadManifest();
    const coverage = assessScannedPdfCorpusCoverage(manifest);

    expect(coverage.qualifiedDocuments).toEqual([]);
    expect(coverage.issues.map((issue) => issue.code)).toContain('INSUFFICIENT_HELD_OUT_PHYSICAL_SCANS');
    expect(coverage.issues.map((issue) => issue.code)).toContain('INSUFFICIENT_HELD_OUT_SCAN_PAGES');
  });

  it('accepts a held-out physical scan corpus only when every coverage dimension is present', () => {
    const traits = ['clean-scan', 'degraded-scan', 'multi-page', 'shared-passage', 'option-boundary-risk'];
    const documents = Array.from({ length: 10 }, (_, index) =>
      physicalScan(`scan-${index + 1}`, index === 0 ? 'vi' : 'en', index === 0 ? traits : ['multi-page'])
    );
    const coverage = assessScannedPdfCorpusCoverage({ version: 1, documents });

    expect(coverage.qualifiedDocuments).toHaveLength(10);
    expect(coverage.qualifiedPageCount).toBe(100);
    expect(coverage.ready).toBe(true);
    expect(coverage.issues).toEqual([]);
  });

  it('reports the exact missing dimensions instead of accepting an aggregate-only score', () => {
    const coverage = assessScannedPdfCorpusCoverage({
      version: 1,
      documents: [physicalScan('only-scan', 'en', ['clean-scan'])]
    });

    expect(coverage.ready).toBe(false);
    expect(coverage.issues).toEqual(
      expect.arrayContaining([
        { code: 'INSUFFICIENT_HELD_OUT_PHYSICAL_SCANS', value: '1/10' },
        { code: 'INSUFFICIENT_HELD_OUT_SCAN_PAGES', value: '10/100' },
        { code: 'MISSING_REQUIRED_LANGUAGE', value: 'vi' },
        { code: 'MISSING_REQUIRED_TRAIT', value: 'degraded-scan' },
        { code: 'MISSING_REQUIRED_TRAIT', value: 'multi-page' },
        { code: 'MISSING_REQUIRED_TRAIT', value: 'shared-passage' },
        { code: 'MISSING_REQUIRED_TRAIT', value: 'option-boundary-risk' }
      ])
    );
  });
});
