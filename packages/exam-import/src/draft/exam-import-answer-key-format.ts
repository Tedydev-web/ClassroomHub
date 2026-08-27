/**
 * How a paper writes its answer key, in one place.
 *
 * The same rule — "a run of `number → letter` pairs and nothing else" — was written twice,
 * once to decide which blocks are key blocks and once to read the answers out of them. The
 * two copies drifted, so a line the reader understood was still parsed as a question. They
 * are one function now, and every carrier the importer learns is taught here.
 *
 * Nothing in here infers an answer. A carrier either states a pairing or it does not.
 */

/** `Đáp án`, `Answer`, `Key` — an optional label in front of a key line. */
const ANSWER_LABEL_PATTERN = /^(?:Đáp án|Dap an|Answer|Key)\b\s*/iu;

/**
 * `1A`, `1. A`, `1) A`, `1: A`, `1 - A`. The colon matters: `Đáp án 1: B` is a common
 * per-line format and used to be read as neither a key nor a question.
 */
export const ANSWER_KEY_PAIR_PATTERN = /(\d+)\s*[.):\-–—]?\s*([A-D])(?=\s|$|\d)/giu;

/** A single answer token standing alone in a table cell. */
const SINGLE_ANSWER_TOKEN_PATTERN = /^[A-D]$/iu;
const BARE_NUMBER_PATTERN = /^\d+$/u;

/** Below this, a grid is likelier to be a rubric than a key, and guessing costs more
 * than declining. */
const MINIMUM_HEADERLESS_KEY_PAIRS = 4;

export type AnswerKeyPair = {
  number: number;
  value: string;
};

export type CompactAnswerKeyLine = {
  pairs: AnswerKeyPair[];
  /**
   * True when the line is *only* a key — a label, pairs and separators, nothing else.
   * A line that also carries prose is a question that happens to mention a letter, and
   * must not be swallowed.
   */
  isKeyOnly: boolean;
};

/** Reads one line of text as a compact key, e.g. `ĐÁP ÁN: 1B 2C` or `Đáp án 1: B`. */
export function readCompactAnswerKeyLine(text: string): CompactAnswerKeyLine {
  const trimmed = text.trim();
  const withoutLabel = trimmed.replace(ANSWER_LABEL_PATTERN, '').replace(/^[:.\-–—]\s*/u, '');
  const matches = [...withoutLabel.matchAll(ANSWER_KEY_PAIR_PATTERN)];
  if (matches.length === 0) return { pairs: [], isKeyOnly: false };

  const residue = withoutLabel.replace(ANSWER_KEY_PAIR_PATTERN, '').replace(/[\s,;|.)\-–—:]+/gu, '');

  return {
    pairs: matches.map((match) => ({ number: Number(match[1]), value: match[2]!.toUpperCase() })),
    isKeyOnly: residue.length === 0
  };
}

type GridCell = {
  row: number;
  column: number;
  text: string;
};

/**
 * Reads a key grid that carries no textual header — the standard layout of a Vietnamese
 * paper, where a row of question numbers sits above a row of answers, often repeated in
 * blocks of ten.
 *
 * Two arrangements, both requiring every cell to be either a bare number or a single
 * answer token, so an ordinary content table cannot be mistaken for one:
 *
 *   1 2 3 4      |  1  B
 *   B C A D      |  2  C
 *
 * Shape is the only evidence a header-less grid offers, so it has to carry the whole
 * claim. Two further conditions come from what separates a key from the tables that
 * resemble one — a rubric, a mark scheme, a legend:
 *
 *   - the numbers ascend. A key is question order; a table whose first column is not in
 *     order is indexing something else, and reading it as a key would assign answers to
 *     the wrong questions rather than fail visibly.
 *   - there are at least four pairs. Rubrics are short and keys are not, and a table too
 *     small to be a key is also too small to be worth the risk of guessing.
 *
 * A table carrying a header states its intent in words and is read elsewhere, without
 * either condition, because it needs no corroboration from its shape.
 */
export function readAnswerKeyGrid(cells: GridCell[]): AnswerKeyPair[] {
  if (cells.length === 0) return [];

  const rows = new Map<number, GridCell[]>();
  for (const cell of cells) {
    const bucket = rows.get(cell.row);
    if (bucket) bucket.push(cell);
    else rows.set(cell.row, [cell]);
  }

  const all = [...rows.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, bucket]) => bucket.slice().sort((left, right) => left.column - right.column));

  const isNumberRow = (row: GridCell[]) => row.length > 0 && row.every((cell) => BARE_NUMBER_PATTERN.test(cell.text));
  const isAnswerRow = (row: GridCell[]) =>
    row.length > 0 && row.every((cell) => SINGLE_ANSWER_TOKEN_PATTERN.test(cell.text));
  const isPairRow = (row: GridCell[]) =>
    row.length === 2 && BARE_NUMBER_PATTERN.test(row[0]!.text) && SINGLE_ANSWER_TOKEN_PATTERN.test(row[1]!.text);

  // A header row — `Câu | Đáp án` and its variants — is data about the table, not data in
  // it. Exactly one is tolerated, and only when the rows beneath it are unambiguous.
  const first = all[0];
  const ordered = first && !isNumberRow(first) && !isAnswerRow(first) && !isPairRow(first) ? all.slice(1) : all;
  if (ordered.length === 0) return [];

  const pairs: AnswerKeyPair[] = [];

  // Arrangement 1: a number row immediately above an answer row of the same width.
  for (let index = 0; index + 1 < ordered.length; index += 2) {
    const numbers = ordered[index]!;
    const answers = ordered[index + 1]!;
    if (!isNumberRow(numbers) || !isAnswerRow(answers) || numbers.length !== answers.length) {
      pairs.length = 0;
      break;
    }
    for (const [position, numberCell] of numbers.entries()) {
      pairs.push({ number: Number(numberCell.text), value: answers[position]!.text.toUpperCase() });
    }
  }

  if (isPlausibleKey(pairs)) return pairs;

  // Arrangement 2: every row is a single `number | answer` pair.
  const vertical: AnswerKeyPair[] = [];
  for (const row of ordered) {
    if (!isPairRow(row)) return [];
    const [numberCell, answerCell] = row as [GridCell, GridCell];
    vertical.push({ number: Number(numberCell.text), value: answerCell.text.toUpperCase() });
  }

  return isPlausibleKey(vertical) ? vertical : [];
}

/** Long enough and ordered enough that shape alone is evidence. */
function isPlausibleKey(pairs: readonly AnswerKeyPair[]): boolean {
  if (pairs.length < MINIMUM_HEADERLESS_KEY_PAIRS) return false;

  return pairs.every((pair, index) => index === 0 || pair.number > pairs[index - 1]!.number);
}
