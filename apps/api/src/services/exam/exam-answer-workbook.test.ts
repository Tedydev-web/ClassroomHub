import { describe, expect, it } from 'vitest';

import { blockLayout, buildAnswerWorkbookSheets, type WorkbookLabels } from './exam-answer-workbook';
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
  generatedAt: 'Xuất lúc',
  candidateNumber: 'Số báo danh',
  timeTaken: 'Thời gian làm',
  startedAt: 'Bắt đầu',
  submittedAt: 'Nộp lúc',
  leaves: 'Rời bài thi',
  minutes: 'phút'
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
    // The shape Postgres actually returns: a space, and an offset with no minutes. Both
    // are outside what an engine must parse, and V8 rejects the second.
    startedAt: '2026-09-04 01:00:00.000+00',
    submittedAt: '2026-09-04 01:33:00.000+00',
    leaves: 2,
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
    const answerRows = sheet.rows.slice(12);

    expect(answerRows.map((row) => row[1].value)).toEqual(['A', 'D', '']);
    expect(answerRows.map((row) => row[2].value)).toEqual(['A', 'B', 'C']);
    // A mark as well as a word: this prints on a black-and-white printer, where the green
    // fill and the red one are the same grey.
    expect(answerRows.map((row) => row[3].value)).toEqual(['✓ Đúng', '✗ Sai', '— Bỏ trống']);
    expect(answerRows.map((row) => row[1].style)).toEqual(['correct', 'incorrect', 'blank']);
  });

  it('states the candidate in a table rather than a caption', () => {
    const [sheet] = buildAnswerWorkbookSheets(MATRIX as never, LABELS, 'TEST 1', '16:33 01/09/2026');
    // A three-question paper is four columns wide, too narrow for two fields to a line, so
    // each takes the whole line rather than being squeezed into a question-number column.
    const identity = sheet.rows.slice(2, 10);
    const said = identity.map((line) => line.map((cell) => cell.value).filter((value) => value !== null));

    expect(said).toEqual([
      ['Học sinh', 'Bùi Thị Bảo Yến'],
      ['Lớp', '12A1'],
      ['Số báo danh', '07'],
      ['Điểm', '1/3'],
      ['Thời gian làm', '33 phút'],
      // ISO order, year included: a stamp read next term must not have to guess which
      // September it was, and a text column sorts correctly this way.
      ['Bắt đầu', '2026-09-04 08:00'],
      ['Nộp lúc', '2026-09-04 08:33'],
      ['Rời bài thi', 2]
    ]);

    // The heading spans the table rather than sitting in a six-character column, and every
    // cell a merge swallows keeps the style so the block does not show through.
    expect(sheet.merges?.[0]).toBe('A1:D1');
    expect(identity[0].every((cell) => cell.style === 'fieldLabel' || cell.style === 'fieldValue')).toBe(true);
  });

  it('leads with the class sheet once there is more than one paper', () => {
    const matrix = { ...MATRIX, rows: [MATRIX.rows[0], candidate('Trần Văn B', ['A', 'B', 'C'], 3)] };
    const sheets = buildAnswerWorkbookSheets(matrix as never, LABELS, 'TEST 1', '16:33 01/09/2026');

    expect(sheets.map((sheet) => sheet.name)).toEqual(['Tổng hợp lớp', 'Bùi Thị Bảo Yến', 'Trần Văn B']);
  });

  it('keeps the class sheet’s key row under the column it belongs to', () => {
    const matrix = { ...MATRIX, rows: [MATRIX.rows[0], candidate('Trần Văn B', ['A', 'B', 'C'], 3)] };
    const [classSheet] = buildAnswerWorkbookSheets(matrix as never, LABELS, 'TEST 1', '16:33 01/09/2026');

    // Nine identifying columns with every optional label supplied, then one per question,
    // lined up on the header, the key row and each candidate's row alike.
    expect(classSheet.rows[3].slice(9).map((cell) => cell.value)).toEqual(['Câu 1', 'Câu 2', 'Câu 3']);
    expect(classSheet.rows[4].slice(9).map((cell) => cell.value)).toEqual(['A', 'B', 'C']);
    expect(classSheet.rows[5].slice(9).map((cell) => cell.value)).toEqual(['A', 'D', '']);
    expect(classSheet.rows[3].slice(0, 9).map((cell) => cell.value)).toEqual([
      'Học sinh',
      'Lớp',
      'Số báo danh',
      'Điểm',
      'Số câu đúng',
      'Thời gian làm',
      'Bắt đầu',
      'Nộp lúc',
      'Rời bài thi'
    ]);
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

describe('blockLayout', () => {
  it('puts a forty-question paper on one page as two blocks of twenty', () => {
    // The shape the request came in as: forty questions listed straight down is a column
    // with two thirds of an A4 page empty beside it, printed over two sheets.
    expect(blockLayout(40)).toEqual({ blocks: 2, perBlock: 20 });
  });

  it('keeps a short paper as one block', () => {
    expect(blockLayout(12)).toEqual({ blocks: 1, perBlock: 12 });
    expect(blockLayout(20)).toEqual({ blocks: 1, perBlock: 20 });
  });

  it('evens the blocks out rather than leaving the last one short', () => {
    // Fifty as 20/20/10 prints two full columns and a stub; 17/17/16 reads as one table.
    expect(blockLayout(50)).toEqual({ blocks: 3, perBlock: 17 });
  });

  it('answers for a paper with no questions instead of dividing by zero', () => {
    expect(blockLayout(0)).toEqual({ blocks: 1, perBlock: 1 });
  });
});

describe('printed layout', () => {
  const many = {
    questions: Array.from({ length: 40 }, (_, index) => ({ position: index + 1, key: 'A' })),
    rows: [
      candidate(
        'Bùi Thị Bảo Yến',
        Array.from({ length: 40 }, () => 'A'),
        40
      )
    ]
  };

  it('lays a long paper out as one table, blocks running side by side inside it', () => {
    const [sheet] = buildAnswerWorkbookSheets(many as never, LABELS, 'TEST 1', '16:33 01/09/2026');
    // Title, a gap, four lines of fields, a gap: the questions start on row eight.
    const header = sheet.rows[7];

    // Eight columns with no gap: one bordered table on the page, the way an answer sheet
    // prints its columns of numbers inside a single frame.
    expect(header).toHaveLength(8);
    expect(header[0].value).toBe('Câu');
    expect(header[4].value).toBe('Câu');

    // Twenty lines, not forty: question 21 sits beside question 1.
    const answerRows = sheet.rows.slice(8);
    expect(answerRows).toHaveLength(20);
    expect(answerRows[0][0].value).toBe(1);
    expect(answerRows[0][4].value).toBe(21);
    expect(answerRows.at(-1)![0].value).toBe(20);
    expect(answerRows.at(-1)![4].value).toBe(40);
  });

  it('declares A4 and how each sheet is meant to fit', () => {
    const matrix = { ...MATRIX, rows: [MATRIX.rows[0], candidate('Trần Văn B', ['A', 'B', 'C'], 3)] };
    const [classSheet, studentSheet] = buildAnswerWorkbookSheets(matrix as never, LABELS, 'TEST 1', '16:33 01/09/2026');

    // The class list is wide and long: one page across, as many down as it takes.
    expect(classSheet.page).toEqual({
      orientation: 'landscape',
      fitToWidth: 1,
      fitToHeight: 0,
      repeatHeaderRows: 5
    });
    // A candidate's own paper is one page, both ways.
    expect(studentSheet.page).toEqual({
      orientation: 'portrait',
      fitToWidth: 1,
      fitToHeight: 1,
      // Four fields to a line on an eight-column table, two on a four-column one, so the
      // heading depth follows the paper rather than being a constant to keep in step.
      repeatHeaderRows: 12
    });
  });

  it('pads the last block so the table keeps its shape', () => {
    // Seven questions across two blocks is four and three; the missing fourth line of the
    // second block is blank cells, not a row that stops halfway.
    const seven = {
      questions: Array.from({ length: 21 }, (_, index) => ({ position: index + 1, key: 'A' })),
      rows: [
        candidate(
          'A',
          Array.from({ length: 21 }, () => 'A'),
          21
        )
      ]
    };
    const [sheet] = buildAnswerWorkbookSheets(seven as never, LABELS, 'TEST 1', '16:33 01/09/2026');
    const answerRows = sheet.rows.slice(8);

    expect(answerRows).toHaveLength(11);
    expect(answerRows.at(-1)![0].value).toBe(11);
    expect(answerRows.at(-1)![4].value).toBeNull();
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

    // The page setup a printer needs, in the order the schema requires it.
    expect(sheetXml).toContain('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
    expect(sheetXml).toContain('paperSize="9"');
    expect(sheetXml.indexOf('<sheetData>')).toBeLessThan(sheetXml.indexOf('<pageSetup '));

    const workbookXml = await zip.file('xl/workbook.xml')!.async('string');
    expect(workbookXml).toContain('_xlnm.Print_Titles');
  });
});
