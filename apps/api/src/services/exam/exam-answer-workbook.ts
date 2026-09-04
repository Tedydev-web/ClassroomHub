import type { AnswerMatrix } from './exam-answer-matrix';
import { toSheetName, type Cell, type Sheet } from './exam-workbook-xlsx';

/**
 * The workbook a teacher takes into the room to go through a paper with a class.
 *
 * Two audiences, so two shapes. The class sheet is the teacher's: a column per question and
 * a row per candidate, read down a column to see what the class fell for. A candidate's own
 * sheet is theirs to keep: their answer beside the right one, question by question, with the
 * ones they lost marked so the conversation can start at those.
 *
 * What is deliberately not in either: the register. Nickname, candidate number and a status
 * belong to the roster export — a sheet handed to a fifteen-year-old should carry their
 * paper and nothing about anybody else's.
 */

export type WorkbookLabels = {
  paper: string;
  classSheet: string;
  student: string;
  className: string;
  score: string;
  correctCount: string;
  question: string;
  key: string;
  theirAnswer: string;
  outcome: string;
  right: string;
  wrong: string;
  blank: string;
  generatedAt: string;
};

function displayNameOf(row: AnswerMatrix['rows'][number], fallback: string): string {
  const name = row.displayName?.trim();
  const nickname = row.nickname?.trim();

  if (name && nickname) return `${name} (${nickname})`;

  return name || nickname || fallback;
}

/**
 * The class at a glance: a column per question, a row per candidate, the key on the row
 * directly under the header so the sheet marks itself.
 *
 * Right and wrong are coloured rather than annotated. A teacher scanning forty columns for
 * the one the class missed is reading shape, not text, and a column of red says it in one
 * look where a column of "✗" does not.
 */
function classSheet(matrix: AnswerMatrix, labels: WorkbookLabels, title: string, generatedAt: string): Sheet {
  const questionColumns = matrix.questions.map((question) => `${labels.question}${question.position}`);

  const rows: Cell[][] = [
    [{ value: title, style: 'title' }],
    [{ value: `${labels.generatedAt}: ${generatedAt}`, style: 'subtitle' }],
    [],
    [
      { value: labels.student, style: 'header' },
      { value: labels.className, style: 'header' },
      { value: labels.score, style: 'header' },
      { value: labels.correctCount, style: 'header' },
      ...questionColumns.map((column): Cell => ({ value: column, style: 'header' }))
    ],
    [
      { value: labels.key, style: 'label' },
      { value: null, style: 'label' },
      { value: null, style: 'label' },
      { value: null, style: 'label' },
      ...matrix.questions.map((question): Cell => ({ value: question.key, style: 'label' }))
    ]
  ];

  for (const row of matrix.rows) {
    rows.push([
      { value: displayNameOf(row, labels.student), style: 'default' },
      { value: row.className ?? '', style: 'default' },
      { value: row.score === null ? '' : `${row.score}/${row.total ?? ''}`, style: 'value' },
      { value: row.correct, style: 'value' },
      ...row.chosen.map((chosen, index): Cell => {
        if (chosen === null) return { value: '', style: 'blank' };

        return { value: chosen, style: chosen === matrix.questions[index]?.key ? 'correct' : 'incorrect' };
      })
    ]);
  }

  return {
    name: toSheetName(labels.classSheet, 'Class'),
    // The header rows stay put: a paper of forty columns is scrolled sideways, and a letter
    // with no question number above it says nothing.
    frozenRows: 5,
    columnWidths: [28, 10, 10, 10, ...questionColumns.map(() => 5)],
    // Landscape and squeezed to one page wide: this sheet is as wide as the paper is long,
    // and a class list that prints its last eight questions on a separate sheet is a sheet
    // nobody can read across.
    page: { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0, repeatHeaderRows: 5 },
    rows
  };
}

/**
 * How many questions go in one printed column, and how many columns that makes.
 *
 * Forty questions in a single list is a column of forty rows down the left of an A4 page
 * with two thirds of the sheet empty beside it, and it prints across two pages for no
 * reason. Twenty to a block puts a forty-question paper on one page as two blocks side by
 * side, which is the shape a marked paper is actually handed over in.
 *
 * The blocks are evened out rather than filled to twenty and then left short: fifty
 * questions become three blocks of seventeen, not twenty, twenty and ten.
 */
const MAX_QUESTIONS_PER_BLOCK = 20;

export function blockLayout(questionCount: number): { blocks: number; perBlock: number } {
  if (questionCount <= 0) return { blocks: 1, perBlock: 1 };

  const blocks = Math.ceil(questionCount / MAX_QUESTIONS_PER_BLOCK);

  return { blocks, perBlock: Math.ceil(questionCount / blocks) };
}

/**
 * One candidate's paper, the sheet they are handed — and printed.
 *
 * A row per question: what they put, what was right, and whether it counted. Laid out in
 * blocks side by side so the whole paper fits one A4 page, because this sheet exists to be
 * printed and gone through in a room, not scrolled.
 */
function studentSheet(
  row: AnswerMatrix['rows'][number],
  matrix: AnswerMatrix,
  labels: WorkbookLabels,
  title: string,
  index: number
): Sheet {
  const name = displayNameOf(row, `${labels.student} ${index + 1}`);

  const { blocks, perBlock } = blockLayout(matrix.questions.length);

  const header: Cell[] = [
    { value: labels.question.trim(), style: 'header' },
    { value: labels.theirAnswer, style: 'header' },
    { value: labels.key, style: 'header' },
    { value: labels.outcome, style: 'header' }
  ];

  /** One question as the four cells that describe it, or four blanks where a block runs out. */
  function questionCells(position: number): Cell[] {
    const question = matrix.questions[position];
    if (!question) return [{ value: null }, { value: null }, { value: null }, { value: null }];

    const chosen = row.chosen[position] ?? null;
    const isRight = chosen !== null && chosen === question.key;
    const style = chosen === null ? 'blank' : isRight ? 'correct' : 'incorrect';

    return [
      { value: question.position, style: 'value' },
      { value: chosen ?? '', style },
      { value: question.key, style: 'value' },
      { value: chosen === null ? labels.blank : isRight ? labels.right : labels.wrong, style }
    ];
  }

  const headerRow: Cell[] = [];
  for (let block = 0; block < blocks; block += 1) {
    // A blank column between blocks, so two tables read as two tables rather than as one
    // eight-column table with a repeated heading in the middle.
    if (block > 0) headerRow.push({ value: null });
    headerRow.push(...header);
  }

  const rows: Cell[][] = [
    [{ value: name, style: 'title' }],
    [
      {
        value: [title, row.className?.trim(), row.score === null ? '' : `${row.score}/${row.total ?? ''}`]
          .filter((part) => Boolean(part))
          .join(' · '),
        style: 'subtitle'
      }
    ],
    [],
    headerRow
  ];

  for (let line = 0; line < perBlock; line += 1) {
    const cells: Cell[] = [];

    for (let block = 0; block < blocks; block += 1) {
      if (block > 0) cells.push({ value: null });
      cells.push(...questionCells(block * perBlock + line));
    }

    rows.push(cells);
  }

  const blockWidths = [6, 10, 10, 11];
  const columnWidths: number[] = [];
  for (let block = 0; block < blocks; block += 1) {
    if (block > 0) columnWidths.push(2);
    columnWidths.push(...blockWidths);
  }

  return {
    name: toSheetName(name, `${labels.student} ${index + 1}`),
    frozenRows: 4,
    columnWidths,
    // Portrait, because a marked paper is filed and stapled like every other sheet in the
    // pile. The blocks are what make it fit; the fit is not left to shrinking the type.
    page: { orientation: 'portrait', fitToWidth: 1, fitToHeight: 1, repeatHeaderRows: 4 },
    rows
  };
}

/**
 * The sheets of one export.
 *
 * A single candidate gets their own sheet and nothing else: they asked for one paper, and a
 * class sheet in the same file would hand them everybody else's marks. More than one gets
 * the class sheet first, then a sheet each.
 */
export function buildAnswerWorkbookSheets(
  matrix: AnswerMatrix,
  labels: WorkbookLabels,
  title: string,
  generatedAt: string
): Sheet[] {
  const sheets =
    matrix.rows.length === 1
      ? [studentSheet(matrix.rows[0]!, matrix, labels, title, 0)]
      : [
          classSheet(matrix, labels, title, generatedAt),
          ...matrix.rows.map((row, index) => studentSheet(row, matrix, labels, title, index))
        ];

  return withUniqueNames(sheets);
}

/**
 * Two tabs cannot share a name, and two candidates can.
 *
 * A class with two Nguyễn Văn A in it is ordinary — this product warns teachers about it
 * elsewhere — and a workbook with two tabs of one name is a file that will not open at all.
 * The number goes on the second one, so the first keeps the name a teacher recognises.
 */
function withUniqueNames(sheets: Sheet[]): Sheet[] {
  const seen = new Map<string, number>();

  return sheets.map((sheet) => {
    const taken = seen.get(sheet.name) ?? 0;
    seen.set(sheet.name, taken + 1);

    if (taken === 0) return sheet;

    const suffix = ` (${taken + 1})`;

    return { ...sheet, name: `${sheet.name.slice(0, 31 - suffix.length)}${suffix}` };
  });
}
