import { describe, expect, it } from 'vitest';
import { collectExamImportSourceBlocks } from '../src/draft/exam-import-segmentation';
import { createExamImportDraftFromRuns } from '../src/draft/exam-import-pipeline';
import { examImportSourceCoverage } from '../src/draft/exam-import-source-coverage';
import { emptyFormatting, type SourceRun } from '../src/source-run';

/**
 * Every block of the source has to end up somewhere: a title, a section instruction, a
 * passage, a question, an answer key, or a diagnostic that names it. A block that reaches
 * none of those left the document and told nobody, which is the failure mode the whole
 * provenance apparatus exists to make impossible.
 */
const SOURCE = {
  assetId: 'asset',
  fileName: 'exam.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  extractor: 'docx'
} as never;

function block(index: number, text: string): SourceRun {
  return {
    text,
    formatting: emptyFormatting(),
    block: { kind: 'paragraph', index, listNumber: null, tableRef: null },
    math: null,
    image: null,
    location: { blockIndex: index, runIndex: 0 }
  };
}

function runsOf(lines: string[]): SourceRun[] {
  return lines.map((line, index) => block(index, line));
}

describe('source coverage', () => {
  it('accounts for every block of an ordinary paper', () => {
    const runs = runsOf([
      'ĐỀ KIỂM TRA GIỮA KỲ',
      'Câu 1: Giá trị của 2 + 3 bằng',
      'A. 4',
      'B. 5',
      'C. 6',
      'D. 7',
      'Câu 2: Đạo hàm của y = x² là',
      'A. 2x',
      'B. x',
      'C. x²',
      'D. 2',
      'ĐÁP ÁN: 1B 2A'
    ]);

    const coverage = examImportSourceCoverage(
      createExamImportDraftFromRuns(runs, SOURCE),
      collectExamImportSourceBlocks(runs)
    );

    expect(coverage.unattributed).toEqual([]);
    expect(coverage.attributed).toBe(coverage.total);
  });

  it('names every block a draft claims nothing of', () => {
    const runs = runsOf(['Câu 1: Giá trị của 2 + 3 bằng', 'A. 4', 'B. 5', 'C. 6', 'D. 7']);
    const draft = createExamImportDraftFromRuns(runs, SOURCE);

    // A draft that records no provenance at all: every block of content is unaccounted
    // for, which is the arithmetic the ledger exists to perform.
    const empty = { ...draft, sections: [], sharedContents: [], fieldStates: [], diagnostics: [] };
    const coverage = examImportSourceCoverage(empty, collectExamImportSourceBlocks(runs));

    expect(coverage.unattributed).toEqual([0, 1, 2, 3, 4]);
    expect(coverage.attributed).toBe(0);
  });

  it('ignores blank blocks, which claim nothing and need no owner', () => {
    const runs = runsOf(['Câu 1: Giá trị của 2 + 3 bằng', 'A. 4', '   ', 'B. 5', 'C. 6', 'D. 7']);
    const draft = createExamImportDraftFromRuns(runs, SOURCE);

    const coverage = examImportSourceCoverage(draft, collectExamImportSourceBlocks(runs));

    expect(coverage.unattributed).toEqual([]);
  });
});
