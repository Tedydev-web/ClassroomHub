import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDocxRuns } from '../src/docx/read-docx-runs';
import { createExamImportDraftFromRuns } from '../src/draft/exam-import-pipeline';
import { collectExamImportSourceBlocks } from '../src/draft/exam-import-segmentation';
import { examImportSourceCoverage } from '../src/draft/exam-import-source-coverage';

/**
 * How much of each real paper the draft accounts for.
 *
 * A question count cannot detect a paper that quietly lost its last section — the number
 * that comes out still looks plausible. Coverage can: every block either reaches a node
 * that records provenance, or it is named here.
 *
 * The blocks these papers legitimately leave behind are end markers, invigilator notes and
 * a name field: things a printed paper has and an exam does not need. They are listed
 * rather than filtered, so a change that starts dropping real content shows up as a number
 * moving instead of as silence.
 */
const ROOT = join(__dirname, '..', '..', '..', 'fixtures', 'exams');

const EXPECTED: Record<string, number> = {
  '2026-en-on-luyen-03-scan-converted': 3,
  '2026-g12-practice-test-2': 2,
  '2026-key-de-thi-thpt': 0,
  '2026-g12-practice-test-topic-2': 1,
  '2026-g12-key-to-test-2': 0
};

describe('source coverage over the corpus', () => {
  it('accounts for every block a paper carries, bar its printed furniture', async () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
    const measured: Record<string, number> = {};

    for (const document of manifest.documents) {
      if (!document.committed || document.format !== 'docx') continue;

      const runs = (await readDocxRuns(new Uint8Array(readFileSync(join(ROOT, document.path))))).runs;
      const draft = createExamImportDraftFromRuns(runs, {
        assetId: document.id,
        fileName: document.path,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extractor: 'docx'
      } as never);

      measured[document.id] = examImportSourceCoverage(draft, collectExamImportSourceBlocks(runs)).unattributed.length;
    }

    expect(measured).toEqual(EXPECTED);
  }, 180000);
});
