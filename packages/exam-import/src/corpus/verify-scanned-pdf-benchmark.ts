import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { corpusManifestSchema, assessScannedPdfCorpusCoverage, type CorpusManifest } from './corpus-manifest';
import {
  assessScannedPdfBenchmarkRuns,
  scannedPdfBenchmarkRunSchema,
  type ScannedPdfBenchmarkAssessment,
  type ScannedPdfBenchmarkRun
} from './scanned-pdf-benchmark';
import { referenceExamSchema, type ReferenceExam } from '../metrics/reference-exam';

export type ScannedPdfBenchmarkArtifactPaths = {
  manifestPath: string;
  firstRunPath: string;
  secondRunPath: string;
};

export class ScannedPdfBenchmarkArtifactError extends Error {
  constructor(path: string, reason: string) {
    super(`Invalid scanned-PDF benchmark artifact at "${path}": ${reason}`);
    this.name = 'ScannedPdfBenchmarkArtifactError';
  }
}

async function readJsonFile(path: string): Promise<unknown> {
  try {
    const contents = await readFile(path, 'utf8');
    return JSON.parse(contents) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ScannedPdfBenchmarkArtifactError(path, reason);
  }
}

function parseManifest(path: string, value: unknown): CorpusManifest {
  const parsed = corpusManifestSchema.safeParse(value);
  if (parsed.success) return parsed.data;

  throw new ScannedPdfBenchmarkArtifactError(path, parsed.error.message);
}

function parseRun(path: string, value: unknown): ScannedPdfBenchmarkRun {
  const parsed = scannedPdfBenchmarkRunSchema.safeParse(value);
  if (parsed.success) return parsed.data;

  throw new ScannedPdfBenchmarkArtifactError(path, parsed.error.message);
}

function parseReference(path: string, value: unknown): ReferenceExam {
  const parsed = referenceExamSchema.safeParse(value);
  if (parsed.success) return parsed.data;

  throw new ScannedPdfBenchmarkArtifactError(path, parsed.error.message);
}

async function readQualifiedReferences(
  manifestPath: string,
  manifest: CorpusManifest
): Promise<ReadonlyMap<string, ReferenceExam>> {
  const corpusDirectory = resolve(dirname(manifestPath));
  const { qualifiedDocuments } = assessScannedPdfCorpusCoverage(manifest);
  const entries = await Promise.all(
    qualifiedDocuments.map(async (document) => {
      const referencePath = resolve(corpusDirectory, document.reference);
      const pathFromCorpus = relative(corpusDirectory, referencePath);
      if (pathFromCorpus === '..' || pathFromCorpus.startsWith(`..${sep}`) || isAbsolute(pathFromCorpus)) {
        throw new ScannedPdfBenchmarkArtifactError(
          referencePath,
          'reference path must stay within the corpus directory'
        );
      }

      const rawReference = await readJsonFile(referencePath);
      const reference = parseReference(referencePath, rawReference);
      return [document.id, reference] as const;
    })
  );

  return new Map(entries);
}

/**
 * Reads the durable release artifacts and evaluates them without trusting
 * caller-provided metrics. The manifest owns the reference paths so a run
 * cannot silently substitute its own ground truth.
 */
export async function verifyScannedPdfBenchmarkArtifacts(
  paths: ScannedPdfBenchmarkArtifactPaths
): Promise<ScannedPdfBenchmarkAssessment> {
  const rawManifest = await readJsonFile(paths.manifestPath);
  const manifest = parseManifest(paths.manifestPath, rawManifest);
  const [rawFirstRun, rawSecondRun, references] = await Promise.all([
    readJsonFile(paths.firstRunPath),
    readJsonFile(paths.secondRunPath),
    readQualifiedReferences(paths.manifestPath, manifest)
  ]);
  const firstRun = parseRun(paths.firstRunPath, rawFirstRun);
  const secondRun = parseRun(paths.secondRunPath, rawSecondRun);

  return assessScannedPdfBenchmarkRuns(manifest, references, [firstRun, secondRun]);
}
