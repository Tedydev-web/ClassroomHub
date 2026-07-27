import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import * as z from 'zod';

import { corpusManifestSchema } from '../src/corpus/corpus-manifest';
import { readDocxRuns } from '../src/docx/read-docx-runs';
import { createExamImportDraftFromRuns } from '../src/draft/exam-import-pipeline';
import { formatMetrics, scoreExtraction } from '../src/metrics/exam-extraction-metrics';
import { examImportDraftToExtractedExam } from '../src/metrics/exam-import-draft-metrics';
import { referenceExamSchema } from '../src/metrics/reference-exam';

const CORPUS_ROOT = join(__dirname, '..', '..', '..', 'fixtures', 'exams');
const baselineSchema = z.strictObject({
  version: z.literal(1),
  documents: z.record(z.string(), z.unknown())
});

describe('corpus regression baseline', () => {
  const manifest = corpusManifestSchema.parse(JSON.parse(readFileSync(join(CORPUS_ROOT, 'manifest.json'), 'utf8')));
  const baseline = baselineSchema.parse(JSON.parse(readFileSync(join(CORPUS_ROOT, 'baselines', 'v1.json'), 'utf8')));

  for (const document of manifest.documents.filter((entry) => entry.committed)) {
    it(`matches ${document.id}`, async () => {
      const bytes = new Uint8Array(readFileSync(join(CORPUS_ROOT, document.path)));
      expect(bytes.byteLength).toBe(document.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(document.sha256);

      if (document.format !== 'docx') {
        throw new Error(`Committed corpus format has no metrics runner: ${document.format}`);
      }

      const read = await readDocxRuns(bytes);
      const draft = createExamImportDraftFromRuns(read.runs, {
        assetId: document.id,
        fileName: document.path,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extractor: 'docx'
      });
      const reference = referenceExamSchema.parse(
        JSON.parse(readFileSync(join(CORPUS_ROOT, document.reference), 'utf8'))
      );
      const metrics = scoreExtraction(reference, examImportDraftToExtractedExam(draft));

      console.info(formatMetrics(reference, metrics));
      expect(metrics).toEqual(baseline.documents[document.id]);
    });
  }
});
