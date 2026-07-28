import * as z from 'zod';

/**
 * The corpus is the only thing that turns "the reader is accurate" from an
 * opinion into a measurement, so its integrity matters more than its size.
 *
 * Small source documents are committed. Large scans are not — they never change
 * and would sit in history forever — so a checkout can legitimately be missing
 * part of the corpus. The rule that follows from that: a run over a partial
 * corpus must say so. Silently scoring whatever happens to be on disk produces
 * a number that looks like the previous number and means something different.
 */

const corpusDocumentSourceSchema = z.strictObject({
  /** A public URL or a stable internal identifier for a consented source. */
  locator: z.string().min(1),
  /** Public licence, or the approval record for a private benchmark document. */
  usageRights: z.string().min(1)
});

const corpusDocumentCaptureKindSchema = z.enum([
  'native_digital',
  'scan_converted',
  'physical_scan',
  'synthetic_rasterization'
]);

const corpusDocumentEvaluationSplitSchema = z.enum(['regression', 'held_out']);

const corpusDocumentSchema = z.strictObject({
  id: z.string().min(1),
  /** Path relative to the corpus root. */
  path: z.string().min(1),
  /** Whether this document is expected to be in version control. */
  committed: z.boolean(),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  format: z.enum(['docx', 'pdf', 'gift', 'aiken']),
  subject: z.string().min(1),
  /** Languages represented by the input, not by its provenance metadata. */
  languages: z.array(z.string().min(2).max(16)).min(1),
  /** Number of physical pages when this document is a paged format. */
  pageCount: z.number().int().positive().nullable(),
  /** How the visible input reached the importer. */
  captureKind: corpusDocumentCaptureKindSchema,
  /** Held-out documents are reserved for release qualification. */
  evaluationSplit: corpusDocumentEvaluationSplitSchema,
  /** Provenance and usage rights must be explicit before a document can inform a release decision. */
  source: corpusDocumentSourceSchema,
  note: z.string(),
  /** Why this document earns its place: the failure modes it exercises. */
  traits: z.array(z.string().min(1)),
  /** Path to the hand-written ground truth, relative to the corpus root. */
  reference: z.string().min(1)
});

export type CorpusDocument = z.infer<typeof corpusDocumentSchema>;

export const corpusManifestSchema = z.strictObject({
  version: z.literal(1),
  documents: z.array(corpusDocumentSchema)
});

export type CorpusManifest = z.infer<typeof corpusManifestSchema>;

export const SCANNED_PDF_CORPUS_REQUIREMENTS = {
  documents: 10,
  pages: 100,
  languages: ['vi', 'en'],
  traits: ['clean-scan', 'degraded-scan', 'multi-page', 'shared-passage', 'option-boundary-risk']
} as const;

export type ScannedPdfCorpusCoverageIssue =
  | 'INSUFFICIENT_HELD_OUT_PHYSICAL_SCANS'
  | 'INSUFFICIENT_HELD_OUT_SCAN_PAGES'
  | 'MISSING_REQUIRED_LANGUAGE'
  | 'MISSING_REQUIRED_TRAIT';

export type ScannedPdfCorpusCoverage = {
  qualifiedDocuments: CorpusDocument[];
  qualifiedPageCount: number;
  languages: string[];
  traits: string[];
  issues: Array<{ code: ScannedPdfCorpusCoverageIssue; value: string }>;
  ready: boolean;
};

/**
 * Synthetic and regression fixtures remain useful for tests, but cannot qualify
 * a vision model for real scanned-PDF release. This pure gate makes that
 * distinction enforceable rather than a release-process convention.
 */
export function assessScannedPdfCorpusCoverage(manifest: CorpusManifest): ScannedPdfCorpusCoverage {
  const qualifiedDocuments = manifest.documents.filter(
    (document) =>
      document.format === 'pdf' && document.captureKind === 'physical_scan' && document.evaluationSplit === 'held_out'
  );
  const qualifiedPageCount = qualifiedDocuments.reduce((total, document) => total + (document.pageCount ?? 0), 0);
  const languages = [...new Set(qualifiedDocuments.flatMap((document) => document.languages))].sort();
  const traits = [...new Set(qualifiedDocuments.flatMap((document) => document.traits))].sort();
  const issues: ScannedPdfCorpusCoverage['issues'] = [];

  if (qualifiedDocuments.length < SCANNED_PDF_CORPUS_REQUIREMENTS.documents) {
    issues.push({
      code: 'INSUFFICIENT_HELD_OUT_PHYSICAL_SCANS',
      value: `${qualifiedDocuments.length}/${SCANNED_PDF_CORPUS_REQUIREMENTS.documents}`
    });
  }

  if (qualifiedPageCount < SCANNED_PDF_CORPUS_REQUIREMENTS.pages) {
    issues.push({
      code: 'INSUFFICIENT_HELD_OUT_SCAN_PAGES',
      value: `${qualifiedPageCount}/${SCANNED_PDF_CORPUS_REQUIREMENTS.pages}`
    });
  }

  for (const language of SCANNED_PDF_CORPUS_REQUIREMENTS.languages) {
    if (!languages.includes(language)) {
      issues.push({ code: 'MISSING_REQUIRED_LANGUAGE', value: language });
    }
  }

  for (const trait of SCANNED_PDF_CORPUS_REQUIREMENTS.traits) {
    if (!traits.includes(trait)) {
      issues.push({ code: 'MISSING_REQUIRED_TRAIT', value: trait });
    }
  }

  return { qualifiedDocuments, qualifiedPageCount, languages, traits, issues, ready: issues.length === 0 };
}

export type CorpusAvailability = {
  available: CorpusDocument[];
  /** Present in the manifest but not on disk. Never silently dropped. */
  missing: CorpusDocument[];
  /**
   * True when a document that is supposed to be committed is absent, which
   * means the checkout is broken rather than merely incomplete.
   */
  hasBrokenCheckout: boolean;
};

/**
 * Splits the manifest by what is actually on disk. `exists` is injected so this
 * stays a pure function and the package keeps no filesystem dependency.
 */
export function resolveCorpusAvailability(
  manifest: CorpusManifest,
  exists: (relativePath: string) => boolean
): CorpusAvailability {
  const available: CorpusDocument[] = [];
  const missing: CorpusDocument[] = [];

  for (const document of manifest.documents) {
    if (exists(document.path)) {
      available.push(document);
    } else {
      missing.push(document);
    }
  }

  return {
    available,
    missing,
    hasBrokenCheckout: missing.some((document) => document.committed)
  };
}

/** Human-readable summary a corpus run prints before any metric. */
export function formatCorpusAvailability(availability: CorpusAvailability): string {
  const lines = [`corpus: ${availability.available.length} available, ${availability.missing.length} missing`];

  for (const document of availability.missing) {
    const reason = document.committed
      ? 'expected in version control — checkout is incomplete'
      : 'not committed by design — fetch it to score this document';
    lines.push(`  missing: ${document.id} (${reason})`);
  }

  return lines.join('\n');
}
