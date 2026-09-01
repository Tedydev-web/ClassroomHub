import { describe, expect, it } from 'vitest';

import { buildAnswerWorkbookSheets, type WorkbookLabels } from './exam-answer-workbook';
import { buildXlsx } from './exam-workbook-xlsx';

const LABELS: WorkbookLabels = {
  paper: 'Đề thi',
  classSheet: 'Tổng hợp lớp',
  student: 'Học sinh',
  className: 'Lớp',
  score: 'Điểm',
  correctCount: 'Số câu đúng',
  question: 'Câu ',
  key: 'Đáp án đúng',
  theirAnswer: 'Em chọn',
  outcome: 'Kết quả',
  right: 'Đúng',
  wrong: 'Sai',
  blank: 'Bỏ trống',
  generatedAt: 'Xuất lúc'
};

function candidate(name: string | null, chosen: Array<string | null>, correct: number) {
  return {
    attemptId: name ?? 'x',
    displayName: name,
    nickname: null,
    className: '12A1',
    candidateNumber: '07',
    score: String(correct),
    total: String(chosen.length),
    chosen,
    correct
  };
}

const MATRIX = {
  questions: [
    { position: 1, key: 'A' },
    { position: 2, key: 'B' },
    { position: 3, key: 'C' }
  ],
  rows: [candidate('Bùi Thị Bảo Yến', ['A', 'D', null], 1)]
};

describe('buildAnswerWorkbookSheets', () => {
  it('gives one candidate their own paper and nobody else’s marks', () => {
    // They asked for one paper. A class sheet in the same file hands a fifteen-year-old
    // everybody else's results.
    const sheets = buildAnswerWorkbookSheets(MATRIX as never, LABELS, 'TEST 1', '16:33 01/09/2026');

    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe('Bùi Thị Bảo Yến');
  });

  it('marks each answer right, wrong or blank against the key beside it', () => {
    const [sheet] = buildAnswerWorkbookSheets(MATRIX as never, LABELS, 'TEST 1', '16:33 01/09/2026');
    const answerRows = sheet.rows.slice(4);

    expect(answerRows.map((row) => row[1].value)).toEqual(['A', 'D', '']);
    expect(answerRows.map((row) => row[2].value)).toEqual(['A', 'B', 'C']);
    expect(answerRows.map((row) => row[3].value)).toEqual(['Đúng', 'Sai', 'Bỏ trống']);
    expect(answerRows.map((row) => row[1].style)).toEqual(['correct', 'incorrect', 'blank']);
  });

  it('leads with the class sheet once there is more than one paper', () => {
    const matrix = { ...MATRIX, rows: [MATRIX.rows[0], candidate('Trần Văn B', ['A', 'B', 'C'], 3)] };
    const sheets = buildAnswerWorkbookSheets(matrix as never, LABELS, 'TEST 1', '16:33 01/09/2026');

    expect(sheets.map((sheet) => sheet.name)).toEqual(['Tổng hợp lớp', 'Bùi Thị Bảo Yến', 'Trần Văn B']);
  });

  it('keeps the class sheet’s key row under the column it belongs to', () => {
    const matrix = { ...MATRIX, rows: [MATRIX.rows[0], candidate('Trần Văn B', ['A', 'B', 'C'], 3)] };
    const [classSheet] = buildAnswerWorkbookSheets(matrix as never, LABELS, 'TEST 1', '16:33 01/09/2026');

    // Four identifying columns, then one per question, on both the header and the key.
    expect(classSheet.rows[3].slice(4).map((cell) => cell.value)).toEqual(['Câu 1', 'Câu 2', 'Câu 3']);
    expect(classSheet.rows[4].slice(4).map((cell) => cell.value)).toEqual(['A', 'B', 'C']);
    expect(classSheet.rows[5].slice(4).map((cell) => cell.value)).toEqual(['A', 'D', '']);
  });

  it('renames the second tab when two candidates share a name', () => {
    // A workbook with two tabs of one name is a file that will not open at all, and a class
    // with two of the same name is ordinary.
    const matrix = { ...MATRIX, rows: [MATRIX.rows[0], candidate('Bùi Thị Bảo Yến', ['A', 'B', 'C'], 3)] };
    const sheets = buildAnswerWorkbookSheets(matrix as never, LABELS, 'TEST 1', '16:33 01/09/2026');

    expect(new Set(sheets.map((sheet) => sheet.name)).size).toBe(sheets.length);
    expect(sheets[2].name).toContain('(2)');
  });

  it('never writes a tab name Excel refuses', () => {
    const matrix = { ...MATRIX, rows: [candidate('A/B:C*D?E[F]', ['A', 'B', 'C'], 3)] };
    const [sheet] = buildAnswerWorkbookSheets(matrix as never, LABELS, 'TEST 1', '16:33 01/09/2026');

    expect(sheet.name).not.toMatch(/[\\/?*[\]:]/u);
    expect(sheet.name.length).toBeLessThanOrEqual(31);
  });

  it('names a candidate who gave no name at all', () => {
    const matrix = { ...MATRIX, rows: [candidate(null, ['A', 'B', 'C'], 3)] };
    const [sheet] = buildAnswerWorkbookSheets(matrix as never, LABELS, 'TEST 1', '16:33 01/09/2026');

    expect(sheet.name.length).toBeGreaterThan(0);
  });
});

describe('buildXlsx', () => {
  it('writes a workbook whose parts all resolve', async () => {
    /**
     * Hand-written OOXML fails silently in the worst way: a file that downloads and then
     * will not open. These are the two things a reader checks first — that every sheet the
     * workbook names has a relationship behind it, and that every style a cell points at
     * exists.
     */
    const sheets = buildAnswerWorkbookSheets(
      { ...MATRIX, rows: [MATRIX.rows[0], candidate('Trần Văn B', ['A', 'B', 'C'], 3)] } as never,
      LABELS,
      'TEST 1 <&>',
      '16:33 01/09/2026'
    );
    const file = await buildXlsx(sheets);

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(file);

    const workbook = await zip.file('xl/workbook.xml')!.async('string');
    const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');

    for (const id of workbook.matchAll(/r:id="(rId\d+)"/gu)) {
      expect(rels).toContain(`Id="${id[1]}"`);
    }

    const styles = await zip.file('xl/styles.xml')!.async('string');
    const declared = Number(/cellXfs count="(\d+)"/u.exec(styles)?.[1]);
    const sheetXml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');

    for (const style of sheetXml.matchAll(/ s="(\d+)"/gu)) {
      expect(Number(style[1])).toBeLessThan(declared);
    }

    // The title carries characters XML would otherwise choke on.
    expect(sheetXml).toContain('&lt;&amp;&gt;');
  });
});
