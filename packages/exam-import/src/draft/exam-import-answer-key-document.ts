import type { SourceRun } from '../source-run';
import { readAnswerKeyGrid, readCompactAnswerKeyLine, type AnswerKeyPair } from './exam-import-answer-key-format';
import { createExamImportDraftFromRuns } from './exam-import-pipeline';
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
 *
 * Two kinds of key file exist, and the second is the commoner one. A file may be a key and
 * nothing else — a grid, a table, a list. Or it may be the paper itself with the answers
 * marked, which is how every keyed document in this project's corpus states its key. The
 * first is read by its carriers; the second is read by importing it and taking the answers
 * its questions resolved to.
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

  if (pairs.length > 0) return pairs;

  // No standalone carrier, so the file is likely the paper with its answers marked. Import
  // it and read the keys off the questions. Tried second because a document that states a
  // key outright says so more cheaply and more certainly than one that implies it.
  return answersFromMarkedUpPaper(runs);
}

function answersFromMarkedUpPaper(runs: readonly SourceRun[]): AnswerKeyPair[] {
  const draft = createExamImportDraftFromRuns(
    runs as SourceRun[],
    {
      assetId: 'answer-key-document',
      fileName: 'answer-key',
      mimeType: 'application/octet-stream',
      extractor: 'docx'
    } as never
  );

  const pairs: AnswerKeyPair[] = [];
  for (const question of draft.sections.flatMap((section) => section.questions)) {
    const number = Number(question.sourceNumber);
    if (!Number.isSafeInteger(number)) continue;
    if (question.kind !== 'choice' || question.answerKey === null) continue;

    for (const optionId of question.answerKey.correctOptionIds) {
      const option = question.options.find((candidate) => candidate.id === optionId);
      if (option) pairs.push({ number, value: option.sourceLabel.toUpperCase() });
    }
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
  // A question with several correct options arrives as several pairs sharing one number.
  // Written out separately they read as a repeated question number, which the compact-key
  // parser rejects as a duplicate and refuses the whole document over. Comma-joined is the
  // form that parser already accepts for a multi-select answer.
  const byNumber = new Map<number, string[]>();
  for (const pair of pairs) {
    const values = byNumber.get(pair.number);
    if (values) {
      if (!values.includes(pair.value)) values.push(pair.value);
      continue;
    }
    byNumber.set(pair.number, [pair.value]);
  }

  return [...byNumber.entries()]
    .sort(([left], [right]) => left - right)
    .map(([number, values]) => `${number}${values.join(',')}`)
    .join(' ');
}
