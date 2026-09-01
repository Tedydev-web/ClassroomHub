/**
 * The class's answers as a sheet a teacher can go through the paper from.
 *
 * A column per question and a row per candidate, with the key on its own row above them.
 * Read down a column and it says which question the class fell for and what they chose
 * instead; read across a row and it is one candidate's paper. That is the artefact a teacher
 * actually corrects a paper with, and the register export beside it — who sat, what they
 * scored — cannot serve it.
 */

export type AnswerSheetMatrix = {
  questions: Array<{ position: number; key: string }>;
  rows: Array<{
    displayName: string | null;
    nickname: string | null;
    className: string | null;
    candidateNumber: string | null;
    score: string | null;
    total: string | null;
    chosen: Array<string | null>;
    correct: number;
  }>;
};

export type AnswerSheetLabels = {
  name: string;
  nickname: string;
  className: string;
  candidateNumber: string;
  score: string;
  correct: string;
  /** Prefixed to each question column, e.g. "Q" giving "Q1", "Q2". */
  question: string;
  /** Names the row carrying the correct answers. */
  key: string;
};

/**
 * Quoted, and defused.
 *
 * A cell a spreadsheet reads as a formula is a cell it executes when the teacher opens the
 * file, and every name in here was typed by whoever sat the exam. Prefixing the characters
 * that start a formula with an apostrophe makes the cell text again, and the apostrophe is
 * not displayed.
 */
function cell(value: string): string {
  const defused = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;

  return `"${defused.replace(/"/gu, '""')}"`;
}

export function buildAnswerMatrixCsv(matrix: AnswerSheetMatrix, labels: AnswerSheetLabels): string {
  const questionColumns = matrix.questions.map((question) => `${labels.question}${question.position}`);

  const header = [
    labels.name,
    labels.nickname,
    labels.className,
    labels.candidateNumber,
    labels.score,
    labels.correct,
    ...questionColumns
  ];

  /**
   * The key on its own row, directly under the header.
   *
   * A sheet of letters with nothing to compare them against sends the teacher back to
   * another screen to mark it, which is the work this is meant to save. Its leading cells
   * are empty rather than repeating the label in five columns.
   */
  const keyRow = [labels.key, '', '', '', '', '', ...matrix.questions.map((question) => question.key)];

  const rows = matrix.rows.map((row) => [
    row.displayName ?? '',
    row.nickname ?? '',
    row.className ?? '',
    row.candidateNumber ?? '',
    row.score === null ? '' : `${row.score}${row.total === null ? '' : `/${row.total}`}`,
    String(row.correct),
    // A blank stays blank: a candidate who answered nothing and a candidate who answered
    // wrongly are different, and a dash in the cell would make the two look alike.
    ...row.chosen.map((chosen) => chosen ?? '')
  ]);

  return [header, keyRow, ...rows].map((line) => line.map(cell).join(',')).join('\n');
}

/**
 * Hands the file to the browser.
 *
 * The BOM is what makes the diacritics survive in the spreadsheet these teachers actually
 * open. The anchor is attached before the click because Safari has ignored clicks on
 * detached ones, and the URL is revoked on the next tick rather than this one, which would
 * race the download the click just began.
 */
export function downloadCsv(content: string, fileName: string): void {
  const blob = new Blob([`﻿${content}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url));
}
