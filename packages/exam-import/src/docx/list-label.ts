/**
 * Renders the label Word shows for an automatically numbered paragraph.
 *
 * Word does not store `"A."` in the text layer. It stores a list reference, and
 * the label is computed at render time from `numbering.xml`. Any reader that
 * skips this step loses every option label on an auto-numbered question, which
 * on a real exam paper means the answer key has nothing left to attach to.
 */

export const LIST_NUMBER_FORMATS = [
  'decimal',
  'upperLetter',
  'lowerLetter',
  'upperRoman',
  'lowerRoman',
  'bullet',
  'none'
] as const;

export type ListNumberFormat = (typeof LIST_NUMBER_FORMATS)[number];

export type ListLevelDefinition = {
  format: ListNumberFormat;
  /** Word's `lvlText` template — `"%1."`, `"(%1)"`, or a literal for bullets. */
  text: string;
  /** Counter value of the first item. Not always 1: real files start at 2. */
  start: number;
};

export function isListNumberFormat(value: string): value is ListNumberFormat {
  return (LIST_NUMBER_FORMATS as readonly string[]).includes(value);
}

const ROMAN_NUMERALS: ReadonlyArray<readonly [number, string]> = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I']
];

function toRoman(value: number): string {
  let remaining = value;
  let result = '';

  for (const [amount, numeral] of ROMAN_NUMERALS) {
    while (remaining >= amount) {
      result += numeral;
      remaining -= amount;
    }
  }

  return result;
}

/**
 * Word's alphabetic sequence repeats the letter past Z — AA, BB, CC — rather
 * than counting like spreadsheet columns. Exam papers never reach 27 options,
 * so this branch is a safety net, not a behaviour anything depends on.
 */
function toLetters(value: number): string {
  const alphabetIndex = (value - 1) % 26;
  const repeats = Math.floor((value - 1) / 26) + 1;

  return String.fromCharCode(65 + alphabetIndex).repeat(repeats);
}

function formatCounter(format: ListNumberFormat, value: number): string | null {
  if (format === 'decimal') return String(value);

  // Letters and roman numerals have no representation at or below zero, and a
  // file can legitimately declare `start="0"`. Returning null lets the caller
  // report an unresolved label instead of inventing one.
  if (value < 1) return null;

  switch (format) {
    case 'upperLetter':
      return toLetters(value);
    case 'lowerLetter':
      return toLetters(value).toLowerCase();
    case 'upperRoman':
      return toRoman(value);
    case 'lowerRoman':
      return toRoman(value).toLowerCase();
    default:
      return null;
  }
}

/**
 * The label for an explicit counter value, or `null` when the level renders no
 * label.
 *
 * Take this overload when the source already resolved the counter. officeparser
 * does: its `itemIndex` is the counter minus one, with `start` already applied,
 * so a list beginning at `b` reports `1, 2, 3, 4` rather than `0, 1, 2, 3`.
 * Adding `start` to that would shift every label by one.
 *
 * Only the level's own counter is substituted, which is correct for the flat
 * option lists exam papers use. A multi-level template such as `"%1.%2."` would
 * need its ancestors' counters, which this does not track.
 */
export function renderListLabelForCounter(level: ListLevelDefinition, counter: number): string | null {
  if (level.format === 'none') return null;
  if (level.format === 'bullet') return level.text || null;

  const rendered = formatCounter(level.format, counter);
  if (rendered === null) return null;

  const label = level.text.replace(/%\d/g, rendered);

  return label.length > 0 ? label : rendered;
}

/**
 * The label for the `itemIndex`-th item of a list level, counting from zero.
 * Take this overload when the position within the list is what you have and
 * `start` has not been applied yet.
 */
export function renderListLabel(level: ListLevelDefinition, itemIndex: number): string | null {
  return renderListLabelForCounter(level, level.start + itemIndex);
}
