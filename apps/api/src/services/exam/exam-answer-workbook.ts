import type { AnswerMatrix } from './exam-answer-matrix';
import { columnLetter, toSheetName, type Cell, type Sheet } from './exam-workbook-xlsx';

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
  /** Optional so an older caller keeps working; the sheet omits what it is not given. */
  candidateNumber?: string;
  timeTaken?: string;
  startedAt?: string;
  submittedAt?: string;
  leaves?: string;
  minutes?: string;
};

/**
 * A moment as a teacher reads it, in the timezone the school sits in.
 *
 * The workbook is printed and handed over, so an ISO string with a Z on it is the wrong
 * thing to put on the page. `Asia/Ho_Chi_Minh` is fixed rather than taken from the server,
 * which runs in UTC and would otherwise print every sitting seven hours early.
 */
/**
 * A Postgres timestamp as a `Date`, or null where it will not parse.
 *
 * `timestamptz` comes back as `2026-09-02 15:41:41.278+00` — a space instead of the `T`,
 * and an offset with no minutes. Neither is in the grammar every engine must accept, and
 * V8 rejects the second outright: every clock cell in the workbook came out empty because
 * of the two missing characters in `+00`.
 */
function parseStamp(value: string | null): Date | null {
  if (!value) return null;

  const iso = value.includes('T') ? value : value.replace(' ', 'T');
  const moment = new Date(/[+-]\d{2}$/u.test(iso) ? `${iso}:00` : iso);

  return Number.isNaN(moment.getTime()) ? null : moment;
}

function clockOf(value: string | null): string {
  const moment = parseStamp(value);
  if (!moment) return '';

  // Composed rather than taken from `toLocaleString`, whose output for this locale is
  // "08:00 04-09" — a shape nobody writes on a mark sheet, and one that would change under
  // us with the runtime's data.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(moment);

  const at = (type: string) => parts.find((part) => part.type === type)?.value ?? '';

  return `${at('day')}/${at('month')} ${at('hour')}:${at('minute')}`;
}

/** Whole minutes between starting and handing in, or empty while a paper is still open. */
function minutesTaken(row: AnswerMatrix['rows'][number]): string {
  const started = parseStamp(row.startedAt);
  const submitted = parseStamp(row.submittedAt);
  if (!started || !submitted) return '';

  return String(Math.max(0, Math.round((submitted.getTime() - started.getTime()) / 60_000)));
}

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

  /** Name, class, and every optional field the caller gave a label for. */
  const identityColumns =
    4 +
    (labels.candidateNumber ? 1 : 0) +
    (labels.timeTaken ? 1 : 0) +
    (labels.startedAt ? 1 : 0) +
    (labels.submittedAt ? 1 : 0) +
    (labels.leaves ? 1 : 0);

  const rows: Cell[][] = [
    [{ value: title, style: 'title' }],
    [{ value: `${labels.generatedAt}: ${generatedAt}`, style: 'subtitle' }],
    [],
    [
      { value: labels.student, style: 'header' },
      { value: labels.className, style: 'header' },
      ...(labels.candidateNumber ? [{ value: labels.candidateNumber, style: 'header' } as Cell] : []),
      { value: labels.score, style: 'header' },
      { value: labels.correctCount, style: 'header' },
      // What the invigilation needs, beside what the marking needs: a duplicate name is
      // separated by when the two papers ran, and a count of departures is read next to a
      // mark, not on another screen.
      ...(labels.timeTaken ? [{ value: labels.timeTaken, style: 'header' } as Cell] : []),
      ...(labels.startedAt ? [{ value: labels.startedAt, style: 'header' } as Cell] : []),
      ...(labels.submittedAt ? [{ value: labels.submittedAt, style: 'header' } as Cell] : []),
      ...(labels.leaves ? [{ value: labels.leaves, style: 'header' } as Cell] : []),
      ...questionColumns.map((column): Cell => ({ value: column, style: 'header' }))
    ],
    [
      { value: labels.key, style: 'label' },
      ...Array.from({ length: identityColumns - 1 }, (): Cell => ({ value: null, style: 'label' })),
      ...matrix.questions.map((question): Cell => ({ value: question.key, style: 'label' }))
    ]
  ];

  for (const row of matrix.rows) {
    const minutes = minutesTaken(row);

    rows.push([
      { value: displayNameOf(row, labels.student), style: 'default' },
      { value: row.className ?? '', style: 'default' },
      ...(labels.candidateNumber ? [{ value: row.candidateNumber ?? '', style: 'value' } as Cell] : []),
      { value: row.score === null ? '' : `${row.score}/${row.total ?? ''}`, style: 'value' },
      { value: row.correct, style: 'value' },
      ...(labels.timeTaken ? [{ value: minutes, style: 'value' } as Cell] : []),
      ...(labels.startedAt ? [{ value: clockOf(row.startedAt), style: 'value' } as Cell] : []),
      ...(labels.submittedAt ? [{ value: clockOf(row.submittedAt), style: 'value' } as Cell] : []),
      // A dash rather than a nought where the paper never lost focus: nought is a
      // measurement, and this column is only ever a count of something that happened.
      ...(labels.leaves ? [{ value: row.leaves > 0 ? row.leaves : '—', style: 'value' } as Cell] : []),
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
    columnWidths: [28, 10, ...Array.from({ length: identityColumns - 2 }, () => 12), ...questionColumns.map(() => 5)],
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

  /**
   * One question as the four cells that describe it, or four blanks where a block runs out.
   *
   * The outcome carries a mark as well as a word — `✓`, `✗`, `—` — because this is printed
   * on a black-and-white printer, where a green fill and a red one are the same grey. The
   * fill still helps on screen and on a colour printer; the mark and the bold are what make
   * the sheet readable when neither is available.
   */
  function questionCells(position: number): Cell[] {
    const question = matrix.questions[position];
    if (!question) return [{ value: null }, { value: null }, { value: null }, { value: null }];

    const chosen = row.chosen[position] ?? null;
    const isRight = chosen !== null && chosen === question.key;
    const style = chosen === null ? 'blank' : isRight ? 'correct' : 'incorrect';
    const outcome = chosen === null ? `— ${labels.blank}` : isRight ? `✓ ${labels.right}` : `✗ ${labels.wrong}`;

    return [
      { value: question.position, style: 'value' },
      { value: chosen ?? '', style },
      { value: question.key, style: 'value' },
      { value: outcome, style }
    ];
  }

  /**
   * The candidate's details as a table rather than a line of prose.
   *
   * It was a title and a subtitle — a name, then "TEST 1 · 12A · 2/40" — which reads as a
   * caption and prints as one. A teacher handing this to a student and a teacher filing it
   * both want the fields separable, and the sheet already had the numbers.
   *
   * Laid out as label/value pairs across the same width as the table below it, so the page
   * carries one column of content rather than a heading that stops halfway.
   */
  /**
   * The identity fields, laid out the way a printed form lays them out.
   *
   * Two fields to a line whatever the table's width, each one a merged label and a merged
   * value, so "Họ và tên" is not cut to "Họ và t" by a column sized for a question number.
   * The merges are what let this block and the table below it disagree about column widths
   * while still lining up at the edges.
   */
  function fieldBlock(
    pairs: Array<[string, string | number]>,
    width: number,
    firstRow: number
  ): { lines: Cell[][]; merges: string[] } {
    // Two fields to a line where the table is wide enough for both to be legible, one where
    // it is not: a four-column table gives each field the whole line rather than squeezing
    // "Thời gian làm" into a column sized for a question number.
    const perLine = width >= 8 ? 2 : 1;
    const half = Math.floor(width / perLine);
    // The label takes half of its field. It is short and fixed; the value is a name.
    const labelSpan = Math.max(1, Math.floor(half / 2));
    const lines: Cell[][] = [];
    const merges: string[] = [];

    for (let index = 0; index < pairs.length; index += perLine) {
      const rowNumber = firstRow + lines.length;
      const cells: Cell[] = Array.from({ length: width }, () => ({ value: null }) as Cell);

      for (const [side, pair] of pairs.slice(index, index + perLine).entries()) {
        const start = side * half;
        cells[start] = { value: pair[0], style: 'fieldLabel' };
        cells[start + labelSpan] = { value: pair[1], style: 'fieldValue' };

        // The cells the merge swallows still exist and still carry the style, so the
        // merged block keeps its fill and its border rather than showing the default
        // through the part of it that came from an empty cell.
        for (let offset = 1; offset < labelSpan; offset += 1)
          cells[start + offset] = { value: null, style: 'fieldLabel' };
        for (let offset = labelSpan + 1; offset < half; offset += 1) {
          cells[start + offset] = { value: null, style: 'fieldValue' };
        }

        if (labelSpan > 1) {
          merges.push(`${columnLetter(start)}${rowNumber}:${columnLetter(start + labelSpan - 1)}${rowNumber}`);
        }
        if (half - labelSpan > 1) {
          merges.push(`${columnLetter(start + labelSpan)}${rowNumber}:${columnLetter(start + half - 1)}${rowNumber}`);
        }
      }

      lines.push(cells);
    }

    return { lines, merges };
  }

  const width = blocks * 4;
  const minutes = minutesTaken(row);

  const fields: Array<[string, string | number]> = [
    [labels.student, name],
    [labels.className, row.className?.trim() ?? ''],
    ...(labels.candidateNumber ? ([[labels.candidateNumber, row.candidateNumber ?? '']] as [string, string][]) : []),
    [labels.score, row.score === null ? '' : `${row.score}/${row.total ?? ''}`],
    ...(labels.timeTaken
      ? ([[labels.timeTaken, minutes === '' ? '' : `${minutes} ${labels.minutes ?? ''}`.trim()]] as [string, string][])
      : []),
    ...(labels.startedAt ? ([[labels.startedAt, clockOf(row.startedAt)]] as [string, string][]) : []),
    ...(labels.submittedAt ? ([[labels.submittedAt, clockOf(row.submittedAt)]] as [string, string][]) : []),
    // A dash rather than a nought: nought is a measurement, and this only ever counts
    // something that happened.
    ...(labels.leaves ? ([[labels.leaves, row.leaves > 0 ? row.leaves : '—']] as [string, string | number][]) : [])
  ];

  // The heading is centred across the table, the way a form heads itself, rather than
  // sitting in the first column with six empty ones beside it.
  // One heading, centred across the table the way a form heads itself, rather than a name
  // in the first column with six empty ones beside it. The candidate is named in the block
  // below, where the rest of their details are.
  const identity = fieldBlock(fields, width, 3);
  const lastColumn = columnLetter(width - 1);

  const rows: Cell[][] = [[{ value: title, style: 'titleCentre' }], [], ...identity.lines, []];

  const merges = [`A1:${lastColumn}1`, ...identity.merges];

  /**
   * Everything above the questions, counted rather than assumed.
   *
   * How many lines the identity table takes depends on how wide the question table is — a
   * short paper is four columns and fits two fields to a line, a long one is eight and fits
   * four — so the frozen pane and the repeated print heading are derived from it instead of
   * being a number somebody has to remember to update.
   */
  const headingRows = rows.length + 1;

  const headerRow: Cell[] = [];
  for (let block = 0; block < blocks; block += 1) headerRow.push(...header);
  rows.push(headerRow);

  for (let line = 0; line < perBlock; line += 1) {
    const cells: Cell[] = [];

    for (let block = 0; block < blocks; block += 1) cells.push(...questionCells(block * perBlock + line));

    rows.push(cells);
  }

  // No spacer column between the blocks: they are one bordered table on the page, the way
  // an answer sheet prints its columns of numbers inside a single frame, rather than two
  // tables that happen to sit side by side.
  const blockWidths = [6, 11, 11, 13];
  const columnWidths: number[] = [];
  for (let block = 0; block < blocks; block += 1) columnWidths.push(...blockWidths);

  return {
    name: toSheetName(name, `${labels.student} ${index + 1}`),
    merges,
    frozenRows: headingRows,
    columnWidths,
    // Portrait, because a marked paper is filed and stapled like every other sheet in the
    // pile. The blocks are what make it fit; the fit is not left to shrinking the type.
    page: { orientation: 'portrait', fitToWidth: 1, fitToHeight: 1, repeatHeaderRows: headingRows },
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
