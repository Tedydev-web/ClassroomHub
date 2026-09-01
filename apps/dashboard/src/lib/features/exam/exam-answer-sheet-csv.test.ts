import { describe, expect, it } from 'vitest';

import { buildAnswerMatrixCsv, type AnswerSheetLabels, type AnswerSheetMatrix } from './exam-answer-sheet-csv';

const LABELS: AnswerSheetLabels = {
  name: 'Họ và tên',
  nickname: 'Biệt danh',
  className: 'Lớp',
  candidateNumber: 'SBD',
  score: 'Điểm',
  correct: 'Số câu đúng',
  question: 'Câu ',
  key: 'Đáp án đúng'
};

function matrix(overrides: Partial<AnswerSheetMatrix> = {}): AnswerSheetMatrix {
  return {
    questions: [
      { position: 1, key: 'A' },
      { position: 2, key: 'B' }
    ],
    rows: [
      {
        displayName: 'Nguyễn Văn A',
        nickname: null,
        className: '12A1',
        candidateNumber: '07',
        score: '1',
        total: '2',
        chosen: ['A', 'C'],
        correct: 1
      }
    ],
    ...overrides
  };
}

function lines(csv: string): string[][] {
  return csv.split('\n').map((line) => line.slice(1, -1).split('","'));
}

describe('buildAnswerMatrixCsv', () => {
  it('puts a column under each question, in paper order', () => {
    const [header] = lines(buildAnswerMatrixCsv(matrix(), LABELS));

    expect(header.slice(-2)).toEqual(['Câu 1', 'Câu 2']);
  });

  it('carries the key on its own row, so the sheet marks itself', () => {
    const [, key] = lines(buildAnswerMatrixCsv(matrix(), LABELS));

    expect(key[0]).toBe('Đáp án đúng');
    expect(key.slice(-2)).toEqual(['A', 'B']);
  });

  it('keeps a candidate row aligned with the columns above it', () => {
    const [, , row] = lines(buildAnswerMatrixCsv(matrix(), LABELS));

    expect(row.slice(-2)).toEqual(['A', 'C']);
    expect(row[0]).toBe('Nguyễn Văn A');
    expect(row[4]).toBe('1/2');
    expect(row[5]).toBe('1');
  });

  it('leaves an unanswered question empty rather than marking it', () => {
    // Answering nothing and answering wrongly are different things, and a dash would make
    // the two look alike in a column a teacher reads at a glance.
    const csv = buildAnswerMatrixCsv(
      matrix({ rows: [{ ...matrix().rows[0], chosen: ['A', null], correct: 1 }] }),
      LABELS
    );

    expect(lines(csv)[2].slice(-2)).toEqual(['A', '']);
  });

  it('defuses a name a spreadsheet would otherwise execute', () => {
    // Every name here was typed by whoever sat the exam.
    const csv = buildAnswerMatrixCsv(
      matrix({ rows: [{ ...matrix().rows[0], displayName: '=HYPERLINK("http://x")' }] }),
      LABELS
    );

    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
  });

  it('writes a paper with no key without pretending it has one', () => {
    const csv = buildAnswerMatrixCsv(matrix({ questions: [{ position: 1, key: '' }] }), LABELS);

    expect(lines(csv)[1].at(-1)).toBe('');
  });
});
