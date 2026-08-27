import type { SourceRun } from '../source-run';
import { readAnswerKeyGrid, readCompactAnswerKeyLine, type AnswerKeyPair } from './exam-import-answer-key-format';
import { collectExamImportSourceBlocks } from './exam-import-segmentation';

/**
 * Reads an answer key out of a document that is *only* an answer key.
 *
 * Papers arrive with the key in a second file as often as they arrive with it inside the
 * paper. Nothing new is needed to read one: the carriers are the same, so this runs the
 * same adapters over the second document's blocks and produces the same normalized
 * `(number, answer)` pairs. What the caller does with them — apply, compare, refuse — is
 * the same decision it already makes for a key found in the paper itself.
 *
 * Because every reader emits `SourceRun`, a `.docx` key and a `.pdf` key both arrive here
 * already in the one shape, and neither needs a parser of its own.
 */
export function readAnswerKeyPairsFromRuns(runs: readonly SourceRun[]): AnswerKeyPair[] {
  const blocks = collectExamImportSourceBlocks(runs as SourceRun[]);
  const pairs: AnswerKeyPair[] = [];

  const tables = new Map<number, Array<{ row: number; column: number; text: string }>>();
  const cellText = new Map<string, string>();

  for (const block of blocks) {
    const tableRef = block.runs[0]?.block.tableRef;
    if (tableRef === undefined || tableRef === null) {
      const line = readCompactAnswerKeyLine(block.text);
      if (line.isKeyOnly) pairs.push(...line.pairs);
      continue;
    }

    const key = `${tableRef.tableIndex}:${tableRef.originRow}:${tableRef.originColumn}`;
    const text = block.text.normalize('NFC').replace(/\s+/gu, ' ').trim();
    const existing = cellText.get(key);
    cellText.set(key, existing ? `${existing} ${text}`.trim() : text);
  }

  for (const [key, text] of cellText) {
    const [tableIndex, row, column] = key.split(':').map(Number);
    const bucket = tables.get(tableIndex!) ?? [];
    bucket.push({ row: row!, column: column!, text });
    tables.set(tableIndex!, bucket);
  }

  for (const cells of [...tables.entries()].sort(([left], [right]) => left - right).map(([, cells]) => cells)) {
    pairs.push(...readAnswerKeyGrid(cells));
  }

  return pairs;
}

/**
 * The pairs as the compact string the importer already knows how to apply.
 *
 * Rendering back to the one input the answer-key path accepts keeps a second file from
 * growing a second application path — with its own conflict handling, its own count check
 * and its own way of being subtly different.
 */
export function toCompactAnswerKey(pairs: readonly AnswerKeyPair[]): string {
  return [...pairs]
    .sort((left, right) => left.number - right.number)
    .map((pair) => `${pair.number}${pair.value}`)
    .join(' ');
}
