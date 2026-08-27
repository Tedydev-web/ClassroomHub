import { MAX_ASSESSMENT_INTERACTIONS, MAX_INTERACTION_OPTIONS } from '@cio/question-types';
import { sourceRunStreamSchema, type SourceRun } from '../source-run';
import { readAnswerKeyGrid, readCompactAnswerKeyLine } from './exam-import-answer-key-format';
import type {
  ExamImportDiagnostic,
  ExamImportDraft,
  ExamImportFieldState,
  ExamImportQuestion,
  ExamImportSourceSpan
} from './exam-import-draft';
import {
  boundExamImportDiagnostics,
  examImportDraftSchema,
  MAX_EXAM_IMPORT_FIELD_STATES,
  MAX_EXAM_IMPORT_QUESTIONS_PER_SECTION,
  MAX_EXAM_IMPORT_SECTIONS,
  MAX_EXAM_IMPORT_SHARED_CONTENTS,
  MAX_EXAM_IMPORT_TOTAL_QUESTIONS
} from './exam-import-draft';

export type ExamImportSourceBlock = {
  index: number;
  kind: SourceRun['block']['kind'];
  listNumber: string | null;
  runs: SourceRun[];
  text: string;
  span: ExamImportSourceSpan;
};

type PromptPart = {
  label: string | null;
  text: string;
  html: string;
  span: ExamImportSourceSpan;
};

type MutableOption = {
  label: string;
  text: string;
  html: string;
  provenance: ExamImportSourceSpan[];
};

type QuestionIssue = {
  code: string;
  message: string;
  blocking: boolean;
  provenance: ExamImportSourceSpan[];
};

type MutableQuestion = {
  id: string;
  order: number;
  sourceNumber: string;
  points: number | null;
  cognitiveLevel: 'NB' | 'TH' | 'VD' | 'VDC' | null;
  passageId: string | null;
  promptParts: PromptPart[];
  options: MutableOption[];
  provenance: ExamImportSourceSpan[];
  issues: QuestionIssue[];
  trueFalseAnswerEvidence: boolean;
  columnMajorGroupId: string | null;
};

type MutableSection = {
  id: string;
  title: string;
  order: number;
  trueFalse: boolean;
  shortAnswer: boolean;
  essay: boolean;
  questions: MutableQuestion[];
};

type QuestionMarker = {
  start: number;
  contentStart: number;
  end: number;
  number: string;
};

type OptionEntry = {
  label: string;
  text: string;
  markerStart: number;
  contentStart: number;
  contentEnd: number;
};

type ParsedOptions = {
  prefix: string;
  prefixEnd: number;
  entries: OptionEntry[];
};

type TextRange = {
  start: number;
  end: number;
};

type TablePassageLayout = {
  contentBlocks: ExamImportSourceBlock[];
  endBlockIndex: number;
};

type RenderedTable = {
  blocks: ExamImportSourceBlock[];
  text: string;
  html: string;
  span: ExamImportSourceSpan;
};

const EXPLICIT_QUESTION_PATTERN = /\b(?:Câu|Bài|Question)\s*(\d+)\s*[.:)]?/giu;
const BARE_QUESTION_PATTERN = /^\s*(\d+)\s*[.)]\s*/u;
const OPTION_PATTERN = /([A-D])\s*[.)/]\s*/gu;
const LOWER_ITEM_PATTERN = /^([a-z])\s*[.)]\s*/iu;
const POINTS_PATTERN = /\(\s*(\d+(?:[.,]\d+)?)\s*(?:điểm|diem|points?)\s*\)/iu;
const COGNITIVE_LEVEL_PATTERN = /\[\s*[0-3]\s*,\s*(NB|TH|VD|VDC)\s*\]/iu;
const END_MARKER_PATTERN = /^(?:[-–—_=*]\s*)*(?:HẾT|THE END)\b/iu;
const PASSAGE_MARKER_PATTERN =
  /^Read the (?:following|foilowing) (?:passage|announcement|advertisement|leaflet|letter|text|notice|article|dialogue)\b/iu;
const RANGED_QUESTION_INSTRUCTION_PATTERN =
  /^(?:(?:Choose|Select|Complete|Read|Mark)\b.*?\b(?:numbered\s+blanks?|questions?)\s+(?:from\s+)?\d+\s*(?:to|through|[-–—])\s*\d+|(?:For\s+)?Questions?\s+\d+\s*(?:to|through|[-–—])\s*\d+)\b/iu;
const ARRANGEMENT_INSTRUCTION_PATTERN =
  /^(?:Mark the letter .*?\barrangement\b|Choose the (?:best|correct) arrangement\b)/iu;
const FORM_FIELD_LABEL_PATTERN =
  /^(?:candidate(?:\s+name)?|student\s+name|full\s+name|name|class|họ\s*(?:và\s*)?tên|ho\s*(?:va\s*)?ten|tên|ten|lớp|lop|số\s+báo\s+danh|so\s+bao\s+danh|mã\s+học\s+sinh|ma\s+hoc\s+sinh)\s*:?\s*(?:[_–—-]{2,}\s*)?$/iu;
const INSTRUCTION_RANGE_PATTERN = /\bfrom\s+(\d+)\s*(?:to|through|[-–—])\s*(\d+)\b/iu;
const SOLUTION_MARKER_PATTERN = /^(?:Lời giải|Giải thích|Hướng dẫn giải)\b/iu;
const ANSWER_LINE_PATTERN = /^(?:Đáp án|Dap an|Answer)\s*:/iu;
const COMPACT_KEY_PAIR_PATTERN = /(\d+)\s*[.)-]?\s*([A-D])(?=\s|$|\d)/giu;
const TABLE_QUESTION_HEADER_PATTERN = /^(?:câu|cau|question|questions?)$/iu;
const TABLE_ANSWER_HEADER_PATTERN = /^(?:chọn|chon|đáp án|dap an|answer|answers?|key)$/iu;
const STRONG_TABLE_QUESTION_HEADER_PATTERN = /^(?:câu|cau)$/iu;
const STRONG_TABLE_ANSWER_HEADER_PATTERN = /^(?:chọn|chon|đáp án|dap an|key)$/iu;
const STRICT_TABLE_ANSWER_VALUE_PATTERN =
  /^(?:[A-D](?:\s*[,/&;|]\s*[A-D])*|(?:Đ|D|S|T|F|0|1)(?:\s*[,/;|\-]?\s*(?:Đ|D|S|T|F|0|1))+|[+-]?\d+(?:[.,]\d+)?)$/iu;
const NAMED_SECTION_MARKER_PATTERN = /^(?:PHẦN|PHAN|PART|SECTION)\s+(?:[IVXLCDM]+|\d+|[A-Z])\b/iu;
const ROMAN_SECTION_MARKER_PATTERN = /^(?:I|II|III|IV|V|VI|VII|VIII|IX|X)\s*[.:)](?:\s+.+)?$/u;

function isSectionMarker(text: string): boolean {
  return NAMED_SECTION_MARKER_PATTERN.test(text) || ROMAN_SECTION_MARKER_PATTERN.test(text);
}

function hasFourBooleanAnswerValues(text: string): boolean {
  return parseExamImportBooleanAnswerValues(text).length === 4;
}

export function parseExamImportBooleanAnswerValues(text: string): boolean[] {
  const normalized = text
    .normalize('NFC')
    .replace(/Đúng/giu, 'Đ')
    .replace(/Sai/giu, 'S')
    .replace(/True/giu, 'T')
    .replace(/False/giu, 'F')
    .trim();
  if (!/^[ĐDSTF01](?:[\s,;|/\\-]*[ĐDSTF01])*$/iu.test(normalized)) return [];
  const values = normalized.match(/[ĐDSTF01]/giu) ?? [];

  return values.map((value) => /[ĐDT1]/iu.test(value));
}

export function collectExamImportSourceBlocks(runs: SourceRun[]): ExamImportSourceBlock[] {
  const parsedRuns = sourceRunStreamSchema.parse(runs);
  const grouped = new Map<number, SourceRun[]>();
  for (const run of parsedRuns) {
    const existing = grouped.get(run.block.index);
    if (existing) {
      existing.push(run);
    } else {
      grouped.set(run.block.index, [run]);
    }
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([index, blockRuns]) => {
      const orderedRuns = [...blockRuns].sort((left, right) => left.location.runIndex - right.location.runIndex);
      const logicalBlocks: SourceRun[][] = [];
      let currentBlock: SourceRun[] = [];

      for (const run of orderedRuns) {
        const startsAnswerLine = run.block.kind !== 'table_cell' && ANSWER_LINE_PATTERN.test(run.text.trim());
        if (startsAnswerLine && currentBlock.length > 0) {
          logicalBlocks.push(currentBlock);
          currentBlock = [];
        }

        currentBlock.push(run);
      }
      if (currentBlock.length > 0) logicalBlocks.push(currentBlock);

      return logicalBlocks.map((logicalRuns, logicalIndex) => {
        const firstRun = logicalRuns[0]!;
        const lastRun = logicalRuns.at(-1)!;
        // Preserve source locations while keeping split answer lines ordered after their question content.
        const orderedIndex = index + logicalIndex / (logicalBlocks.length + 1);

        return {
          index: orderedIndex,
          kind: firstRun.block.kind,
          listNumber: firstRun.block.listNumber,
          runs: logicalRuns,
          text: logicalRuns.map((run) => run.text).join(''),
          span: {
            start: firstRun.location,
            end: lastRun.location,
            pageStart: null,
            pageEnd: null
          }
        };
      });
    });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

function paragraphHtml(value: string): string {
  return `<p>${escapeHtml(value.trim())}</p>`;
}

/**
 * Highlight is deliberately not rendered.
 *
 * A marker pen over an option is how teachers flag the answer key in the source
 * document, and answer harvesting already reads that emphasis into `answerKey`.
 * Carrying it through as `background-color` would repeat the key as visible
 * styling and show learners which option is correct. The run keeps its
 * `formatting.highlight` so harvesting still sees it; only the rendered HTML
 * drops it, matching the documented set of preserved marks (bold, italic,
 * underline, lists, tables, Office Math, images).
 */
function formattedTextHtml(run: SourceRun, text = run.text): string {
  let html = escapeHtml(text);
  if (run.formatting.strikethrough) html = `<s>${html}</s>`;
  if (run.formatting.underline) html = `<u>${html}</u>`;
  if (run.formatting.italic) html = `<em>${html}</em>`;
  if (run.formatting.bold) html = `<strong>${html}</strong>`;
  if (run.formatting.color) {
    html = `<span style="color:${run.formatting.color}">${html}</span>`;
  }

  return html;
}

function sourceRunHtml(run: SourceRun, text = run.text): string {
  if (run.math) {
    if (run.math.latex !== null) {
      return `<span data-type="inline-math" data-latex="${escapeHtml(run.math.latex)}"></span>`;
    }

    return escapeHtml(run.math.sourceText);
  }
  if (run.image) {
    const dimensions = [
      run.image.width === null ? '' : ` width="${run.image.width}"`,
      run.image.height === null ? '' : ` height="${run.image.height}"`
    ].join('');
    const assetUrl = /^https?:\/\//i.test(run.image.assetRef)
      ? run.image.assetRef
      : `cid:${encodeURIComponent(run.image.assetRef)}`;

    return `<img src="${escapeHtml(assetUrl)}" alt=""${dimensions}>`;
  }

  return formattedTextHtml(run, text);
}

function sourceBlockHtml(block: ExamImportSourceBlock): string {
  return `<p>${block.runs.map((run) => sourceRunHtml(run)).join('')}</p>`;
}

function sourceBlockRangesHtml(block: ExamImportSourceBlock, requestedRanges: TextRange[]): string {
  const richRanges = requestedRanges
    .map(({ start, end }) => ({
      start: Math.max(0, start),
      end: Math.min(block.text.length, end)
    }))
    .filter(({ start, end }) => start <= end);
  const ranges = richRanges.filter(({ start, end }) => start < end).map((range) => ({ ...range }));
  for (const range of ranges) {
    while (range.start < range.end && /\s/u.test(block.text[range.start]!)) range.start++;
    while (range.end > range.start && /\s/u.test(block.text[range.end - 1]!)) range.end--;
  }
  const fragments: string[] = [];
  let cursor = 0;
  for (const run of block.runs) {
    const runStart = cursor;
    const runEnd = runStart + run.text.length;
    if (run.text.length === 0) {
      if (richRanges.some(({ start, end }) => cursor >= start && cursor <= end)) fragments.push(sourceRunHtml(run));
      continue;
    }

    for (const range of ranges) {
      const overlapStart = Math.max(range.start, runStart);
      const overlapEnd = Math.min(range.end, runEnd);
      if (overlapStart < overlapEnd) {
        const text = run.text.slice(overlapStart - runStart, overlapEnd - runStart);
        fragments.push(sourceRunHtml(run, text));
      }
    }
    cursor = runEnd;
  }

  return `<p>${fragments.join('')}</p>`;
}

function sourceBlockSliceHtml(block: ExamImportSourceBlock, requestedStart: number, requestedEnd: number): string {
  return sourceBlockRangesHtml(block, [{ start: requestedStart, end: requestedEnd }]);
}

function sourceBlockRangeSpan(
  block: ExamImportSourceBlock,
  requestedStart: number,
  requestedEnd: number
): ExamImportSourceSpan {
  const start = Math.max(0, Math.min(block.text.length, requestedStart));
  const end = Math.max(start, Math.min(block.text.length, requestedEnd));
  const selectedRuns: SourceRun[] = [];
  let cursor = 0;

  for (const run of block.runs) {
    const runStart = cursor;
    const runEnd = runStart + run.text.length;
    const overlaps = run.text.length === 0 ? cursor >= start && cursor <= end : runEnd > start && runStart < end;
    if (overlaps) selectedRuns.push(run);
    cursor = runEnd;
  }

  const firstRun = selectedRuns[0];
  const lastRun = selectedRuns.at(-1);
  if (!firstRun || !lastRun) return block.span;

  return {
    start: firstRun.location,
    end: lastRun.location,
    pageStart: block.span.pageStart,
    pageEnd: block.span.pageEnd
  };
}

function mergeProvenance(spans: ExamImportSourceSpan[]): ExamImportSourceSpan[] {
  const sorted = [...spans].sort(
    (left, right) => left.start.blockIndex - right.start.blockIndex || left.start.runIndex - right.start.runIndex
  );
  const merged: ExamImportSourceSpan[] = [];

  for (const span of sorted) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.pageStart === span.pageStart &&
      previous.pageEnd === span.pageEnd &&
      span.start.blockIndex <= previous.end.blockIndex + 1
    ) {
      previous.end =
        span.end.blockIndex > previous.end.blockIndex ||
        (span.end.blockIndex === previous.end.blockIndex && span.end.runIndex > previous.end.runIndex)
          ? span.end
          : previous.end;
      continue;
    }

    merged.push(structuredClone(span));
  }

  if (merged.length <= 20) return merged;

  return [{ ...merged[0]!, end: merged.at(-1)!.end }];
}

function parseQuestionMarkers(block: ExamImportSourceBlock): { prefix: string; markers: QuestionMarker[] } {
  const explicitMatches = [...block.text.matchAll(EXPLICIT_QUESTION_PATTERN)];
  if (explicitMatches.length > 0) {
    const markers = explicitMatches.map((match, index): QuestionMarker => {
      const start = match.index;
      const nextStart = explicitMatches[index + 1]?.index ?? block.text.length;

      return {
        start,
        contentStart: start + match[0].length,
        end: nextStart,
        number: match[1]!
      };
    });

    return { prefix: block.text.slice(0, markers[0]!.start), markers };
  }

  const listQuestionNumber = block.listNumber?.match(/^(\d+)\s*[.)]?$/u)?.[1];
  if (listQuestionNumber) {
    return {
      prefix: '',
      markers: [{ start: 0, contentStart: 0, end: block.text.length, number: listQuestionNumber }]
    };
  }

  const bareMatch = block.text.match(BARE_QUESTION_PATTERN);
  if (!bareMatch) return { prefix: block.text, markers: [] };

  return {
    prefix: '',
    markers: [
      {
        start: 0,
        contentStart: bareMatch[0].length,
        end: block.text.length,
        number: bareMatch[1]!
      }
    ]
  };
}

function isRowWiseOptionGrid(
  columns: ReadonlyMap<number, ExamImportSourceBlock[]>,
  questionBlocks: readonly ExamImportSourceBlock[]
): boolean {
  const questionOptionLabels = questionBlocks.flatMap((block) =>
    parseQuestionMarkers(block).markers.flatMap((marker) =>
      parseOptions(block.text.slice(marker.contentStart, marker.end), null).entries.map((entry) => entry.label)
    )
  );
  if (!questionOptionLabels.includes('A')) return false;

  const siblingOptionLabels: string[] = [];
  for (const columnBlocks of columns.values()) {
    if (columnBlocks === questionBlocks) continue;

    const text = columnBlocks
      .map((block) => block.text)
      .join(' ')
      .trim();
    if (!text) continue;

    const parsed = parseOptions(text, columnBlocks.length === 1 ? columnBlocks[0]!.listNumber : null);
    if (parsed.prefix.trim() || parsed.entries.length === 0) return false;
    siblingOptionLabels.push(...parsed.entries.map((entry) => entry.label));
  }
  if (siblingOptionLabels.length === 0) return false;

  const labels = [...new Set([...questionOptionLabels, ...siblingOptionLabels])].sort();

  return labels.length >= 2 && labels.every((label, index) => label === String.fromCharCode(65 + index));
}

function tablePassageLayouts(blocks: ExamImportSourceBlock[]): {
  byQuestionStart: Map<number, TablePassageLayout>;
  contentBlockIndexes: Set<number>;
} {
  const rows = new Map<string, Map<number, ExamImportSourceBlock[]>>();
  for (const block of blocks) {
    const tableRef = block.runs[0]?.block.tableRef;
    if (!tableRef) continue;
    const rowKey = `${tableRef.tableIndex}:${tableRef.originRow}`;
    const columns = rows.get(rowKey) ?? new Map<number, ExamImportSourceBlock[]>();
    const column = columns.get(tableRef.originColumn) ?? [];
    column.push(block);
    columns.set(tableRef.originColumn, column);
    rows.set(rowKey, columns);
  }

  const byQuestionStart = new Map<number, TablePassageLayout>();
  const contentBlockIndexes = new Set<number>();
  for (const columns of rows.values()) {
    const questionColumns = [...columns.entries()].filter(([, columnBlocks]) =>
      columnBlocks.some((block) => parseQuestionMarkers(block).markers.length > 0)
    );
    if (questionColumns.length !== 1 || columns.size < 2) continue;

    const [questionColumn, questionBlocks] = questionColumns[0]!;
    if (isRowWiseOptionGrid(columns, questionBlocks)) continue;

    const contentBlocks = [...columns.entries()]
      .filter(([column]) => column !== questionColumn)
      .flatMap(([, columnBlocks]) => columnBlocks)
      .filter((block) => block.text.trim().length > 0)
      .sort((left, right) => left.index - right.index);
    if (contentBlocks.length === 0) continue;

    const questionStart = Math.min(...questionBlocks.map((block) => block.index));
    byQuestionStart.set(questionStart, {
      contentBlocks,
      endBlockIndex: Math.max(...questionBlocks.map((block) => block.index))
    });
    for (const contentBlock of contentBlocks) contentBlockIndexes.add(contentBlock.index);
  }

  return { byQuestionStart, contentBlockIndexes };
}

function tableCellTexts(blocks: ExamImportSourceBlock[]): string[] {
  const cells = new Map<string, string>();
  for (const block of blocks) {
    const tableRef = block.runs[0]?.block.tableRef;
    if (!tableRef) continue;
    const key = `${tableRef.originRow}:${tableRef.originColumn}`;
    const existing = cells.get(key);
    const text = block.text.normalize('NFC').replace(/\s+/gu, ' ').trim();
    cells.set(key, existing ? `${existing} ${text}`.trim() : text);
  }

  return [...cells.values()];
}

export function isExamImportAnswerTableBlocks(blocks: ExamImportSourceBlock[]): boolean {
  const cellTexts = tableCellTexts(blocks);
  const hasQuestionHeader = cellTexts.some((text) => TABLE_QUESTION_HEADER_PATTERN.test(text));
  const hasAnswerHeader = cellTexts.some((text) => TABLE_ANSWER_HEADER_PATTERN.test(text));
  if (!hasQuestionHeader || !hasAnswerHeader) return false;

  const hasStrongHeaders =
    cellTexts.some((text) => STRONG_TABLE_QUESTION_HEADER_PATTERN.test(text)) &&
    cellTexts.some((text) => STRONG_TABLE_ANSWER_HEADER_PATTERN.test(text));
  if (hasStrongHeaders) return true;

  const payload = cellTexts.filter(
    (text) =>
      !TABLE_QUESTION_HEADER_PATTERN.test(text) && !TABLE_ANSWER_HEADER_PATTERN.test(text) && !/^\d+$/u.test(text)
  );

  return payload.length > 0 && payload.every((text) => STRICT_TABLE_ANSWER_VALUE_PATTERN.test(text));
}

/** Table blocks as `{ row, column, text }`, the shape the grid reader works in. */
function answerGridCells(blocks: ExamImportSourceBlock[]): Array<{ row: number; column: number; text: string }> {
  const cells = new Map<string, { row: number; column: number; text: string }>();

  for (const block of blocks) {
    const tableRef = block.runs[0]?.block.tableRef;
    if (!tableRef) continue;
    const key = `${tableRef.originRow}:${tableRef.originColumn}`;
    const text = block.text.normalize('NFC').replace(/\s+/gu, ' ').trim();
    const existing = cells.get(key);
    if (existing) existing.text = `${existing.text} ${text}`.trim();
    else cells.set(key, { row: tableRef.originRow, column: tableRef.originColumn, text });
  }

  return [...cells.values()];
}

function answerSourceBlockIndexes(blocks: ExamImportSourceBlock[]): Set<number> {
  const answerBlocks = new Set<number>();
  const tables = new Map<number, ExamImportSourceBlock[]>();
  for (const block of blocks) {
    const tableIndex = block.runs[0]?.block.tableRef?.tableIndex;
    if (tableIndex === undefined) continue;
    const tableBlocks = tables.get(tableIndex);
    if (tableBlocks) tableBlocks.push(block);
    else tables.set(tableIndex, [block]);
  }

  for (const tableBlocks of tables.values()) {
    // Either a headed answer table, or a header-less grid recognised by its shape.
    const isAnswerTable =
      isExamImportAnswerTableBlocks(tableBlocks) || readAnswerKeyGrid(answerGridCells(tableBlocks)).length > 0;
    if (isAnswerTable) {
      for (const block of tableBlocks) answerBlocks.add(block.index);
    }
  }

  for (const block of blocks) {
    if (block.kind === 'table_cell') continue;
    if (readCompactAnswerKeyLine(block.text).isKeyOnly) answerBlocks.add(block.index);
  }

  return answerBlocks;
}

/**
 * A table that holds nothing but one question's options.
 *
 * A Vietnamese maths or physics paper writes the stem in a paragraph and lays the four
 * options out in a grid beneath it, two by two or four across. The table carries no
 * question marker, so the layouts above skip it and the whole thing used to be appended
 * to the stem as prose — leaving the question with no options and no kind.
 *
 * Accepted only when every non-empty cell is exactly one option and the labels read, in
 * row-major order, as a contiguous run from `A`. A table of prose beneath a stem parses
 * to no options at all and is left alone.
 */
function readOptionGridTable(
  tableBlocks: readonly ExamImportSourceBlock[]
): Array<{ entry: OptionEntry; block: ExamImportSourceBlock }> | null {
  const cells = new Map<string, ExamImportSourceBlock[]>();
  for (const block of [...tableBlocks].sort((left, right) => left.index - right.index)) {
    const tableRef = block.runs[0]?.block.tableRef;
    if (!tableRef) return null;
    const key = `${tableRef.originRow}:${tableRef.originColumn}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(block);
    else cells.set(key, [block]);
  }

  const ordered = [...cells.entries()]
    .map(([key, blocks]) => {
      const [row, column] = key.split(':').map(Number);
      return { row: row!, column: column!, blocks };
    })
    .sort((left, right) => left.row - right.row || left.column - right.column);

  const found: Array<{ entry: OptionEntry; block: ExamImportSourceBlock }> = [];
  for (const cell of ordered) {
    const text = cell.blocks
      .map((block) => block.text)
      .join(' ')
      .trim();
    if (!text) continue;

    const parsed = parseOptions(text, null);
    if (parsed.prefix.trim() || parsed.entries.length !== 1) return null;
    found.push({ entry: parsed.entries[0]!, block: cell.blocks[0]! });
  }

  if (found.length < 2) return null;

  const labels = found.map((option) => option.entry.label);
  const expected = labels.map((_, index) => String.fromCharCode(65 + index));

  return labels.join('') === expected.join('') ? found : null;
}

function ordinaryTableLayouts(
  blocks: ExamImportSourceBlock[],
  answerBlockIndexes: Set<number>,
  passageBlockIndexes: Set<number>
): { byStart: Map<number, RenderedTable>; blockIndexes: Set<number> } {
  const tables = new Map<number, ExamImportSourceBlock[]>();
  for (const block of blocks) {
    const tableIndex = block.runs[0]?.block.tableRef?.tableIndex;
    if (tableIndex === undefined) continue;
    const tableBlocks = tables.get(tableIndex);
    if (tableBlocks) tableBlocks.push(block);
    else tables.set(tableIndex, [block]);
  }

  const byStart = new Map<number, RenderedTable>();
  const blockIndexes = new Set<number>();
  for (const tableBlocks of tables.values()) {
    if (tableBlocks.some((block) => answerBlockIndexes.has(block.index) || passageBlockIndexes.has(block.index))) {
      continue;
    }
    if (
      tableBlocks.some(
        (block) =>
          parseQuestionMarkers(block).markers.length > 0 ||
          isSectionMarker(block.text.trim()) ||
          ANSWER_LINE_PATTERN.test(block.text.trim())
      )
    ) {
      continue;
    }

    const sortedBlocks = [...tableBlocks].sort((left, right) => left.index - right.index);
    const cells = new Map<string, { row: number; column: number; blocks: ExamImportSourceBlock[] }>();
    for (const block of sortedBlocks) {
      const tableRef = block.runs[0]?.block.tableRef;
      if (!tableRef) continue;
      const key = `${tableRef.originRow}:${tableRef.originColumn}`;
      const cell = cells.get(key);
      if (cell) cell.blocks.push(block);
      else {
        cells.set(key, {
          row: tableRef.originRow,
          column: tableRef.originColumn,
          blocks: [block]
        });
      }
    }

    const rows = new Map<number, Array<{ column: number; blocks: ExamImportSourceBlock[] }>>();
    for (const cell of cells.values()) {
      const row = rows.get(cell.row);
      const value = { column: cell.column, blocks: cell.blocks };
      if (row) row.push(value);
      else rows.set(cell.row, [value]);
    }
    const htmlRows = [...rows.entries()]
      .sort(([left], [right]) => left - right)
      .map(
        ([, row]) =>
          `<tr>${row
            .sort((left, right) => left.column - right.column)
            .map((cell) => `<td>${cell.blocks.map((block) => sourceBlockHtml(block)).join('')}</td>`)
            .join('')}</tr>`
      )
      .join('');
    const firstBlock = sortedBlocks[0];
    const lastBlock = sortedBlocks.at(-1);
    if (!firstBlock || !lastBlock) continue;

    const renderedTable: RenderedTable = {
      blocks: sortedBlocks,
      text: sortedBlocks.map((block) => block.text).join('\n'),
      html: `<table><tbody>${htmlRows}</tbody></table>`,
      span: {
        start: firstBlock.span.start,
        end: lastBlock.span.end,
        pageStart: firstBlock.span.pageStart,
        pageEnd: lastBlock.span.pageEnd
      }
    };
    byStart.set(firstBlock.index, renderedTable);
    for (const block of sortedBlocks) blockIndexes.add(block.index);
  }

  return { byStart, blockIndexes };
}

function parseOptions(text: string, listNumber: string | null): ParsedOptions {
  const listLabel = listNumber?.match(/^([A-D])\s*[.)/]?$/u)?.[1];
  if (listLabel) {
    return {
      prefix: '',
      prefixEnd: 0,
      entries: [{ label: listLabel, text: text.trim(), markerStart: 0, contentStart: 0, contentEnd: text.length }]
    };
  }

  const allMatches = [...text.matchAll(OPTION_PATTERN)];
  if (allMatches.length === 0) return { prefix: text, prefixEnd: text.length, entries: [] };

  const firstLabel = allMatches[0]![1]!;
  const firstAIndex = allMatches.findIndex((match) => match[1] === 'A');
  const startsWithOption = text.slice(0, allMatches[0]!.index).trim().length === 0;
  const inferredA = firstAIndex === -1 && firstLabel === 'B' && /^A/u.test(text.slice(0, allMatches[0]!.index).trim());
  const matchStart = firstLabel === 'A' ? 0 : firstAIndex >= 0 ? firstAIndex : inferredA || startsWithOption ? 0 : -1;
  if (matchStart === -1) return { prefix: text, prefixEnd: text.length, entries: [] };

  const matches = allMatches.slice(matchStart);
  const labels = matches.map((match) => match[1]!.charCodeAt(0));
  if (labels.some((label, index) => index > 0 && label < labels[index - 1]!)) {
    return { prefix: text, prefixEnd: text.length, entries: [] };
  }

  const entries = matches.map((match, index): OptionEntry => {
    const contentStart = match.index + match[0].length;
    const contentEnd = matches[index + 1]?.index ?? text.length;

    return {
      label: match[1]!,
      text: text.slice(contentStart, contentEnd).trim(),
      markerStart: match.index,
      contentStart,
      contentEnd
    };
  });
  let prefixEnd = matches[0]!.index;
  let prefix = text.slice(0, prefixEnd).trim();

  if (inferredA) {
    entries.unshift({ label: 'A', text: prefix, markerStart: 0, contentStart: 0, contentEnd: prefixEnd });
    prefix = '';
    prefixEnd = 0;
  }

  return { prefix, prefixEnd, entries: entries.filter((entry) => entry.text.length > 0) };
}

function parseQuestionMetadata(text: string): {
  text: string;
  points: number | null;
  cognitiveLevel: MutableQuestion['cognitiveLevel'];
  removedRanges: TextRange[];
} {
  const pointsMatch = text.match(POINTS_PATTERN);
  const cognitiveMatch = text.match(COGNITIVE_LEVEL_PATTERN);
  const points = pointsMatch ? Number(pointsMatch[1]!.replace(',', '.')) : null;
  const cognitiveLevel = cognitiveMatch
    ? (cognitiveMatch[1]!.toUpperCase() as MutableQuestion['cognitiveLevel'])
    : null;
  const removedRanges = [pointsMatch, cognitiveMatch]
    .filter((match): match is RegExpMatchArray => match !== null && match.index !== undefined)
    .map((match) => ({ start: match.index!, end: match.index! + match[0].length }))
    .sort((left, right) => left.start - right.start);

  return {
    text: text.replace(POINTS_PATTERN, '').replace(COGNITIVE_LEVEL_PATTERN, '').trim(),
    points,
    cognitiveLevel,
    removedRanges
  };
}

function includedTextRanges(end: number, excludedRanges: TextRange[]): TextRange[] {
  const included: TextRange[] = [];
  let cursor = 0;
  for (const excluded of excludedRanges) {
    if (excluded.start > cursor) included.push({ start: cursor, end: excluded.start });
    cursor = Math.max(cursor, excluded.end);
  }
  if (cursor < end) included.push({ start: cursor, end });

  return included;
}

function sectionKind(title: string): Pick<MutableSection, 'trueFalse' | 'shortAnswer' | 'essay'> {
  return {
    trueFalse: /(?:đúng\s*[/\\-]?\s*sai|dung\s*[/\\-]?\s*sai|true\s*[/\\-]?\s*false)/iu.test(title),
    shortAnswer: /(?:trả lời ngắn|tra loi ngan|short answer)/iu.test(title),
    essay: /(?:tự luận|tu luan|essay)/iu.test(title)
  };
}

function newSection(title: string, order: number): MutableSection {
  const boundedTitle = title.trim().slice(0, 500);

  return {
    id: `section-${order + 1}`,
    title: boundedTitle,
    order,
    ...sectionKind(boundedTitle),
    questions: []
  };
}

function addProvenance(question: MutableQuestion, span: ExamImportSourceSpan): void {
  question.provenance.push(span);
}

function addPromptPart(
  question: MutableQuestion,
  text: string,
  span: ExamImportSourceSpan,
  label: string | null = null,
  html: string | null = null
): void {
  const trimmed = text.trim();
  if (!trimmed && html === null) return;
  const authoredHtml = html ?? paragraphHtml(trimmed);

  question.promptParts.push({ label, text: trimmed, html: authoredHtml, span });
  addProvenance(question, span);
}

function addOption(
  question: MutableQuestion,
  entry: OptionEntry,
  span: ExamImportSourceSpan,
  html = paragraphHtml(entry.text)
): boolean {
  if (question.options.some((option) => option.label === entry.label)) {
    if (
      !question.issues.some(
        (issue) => issue.code === 'DUPLICATE_OPTION_LABEL' && issue.message.includes(` ${entry.label} `)
      )
    ) {
      question.issues.push({
        code: 'DUPLICATE_OPTION_LABEL',
        message: `Option label ${entry.label} appears more than once`,
        blocking: true,
        provenance: [span]
      });
    }
    return false;
  }

  question.options.push({ label: entry.label, text: entry.text, html, provenance: [span] });
  addProvenance(question, span);
  return true;
}

function optionOwner(
  section: MutableSection,
  currentQuestion: MutableQuestion | null,
  entries: OptionEntry[],
  block: ExamImportSourceBlock
): MutableQuestion | null {
  const firstLabel = entries[0]?.label;
  if (!firstLabel) return null;

  if (currentQuestion?.columnMajorGroupId) {
    if (entries.some((entry) => entry.label === 'A') || entries.length > 1) return currentQuestion;

    const candidates = section.questions.filter(
      (question) => question.options.length > 0 && !question.options.some((option) => option.label === firstLabel)
    );
    const owner = candidates[0] ?? null;
    if (owner && candidates.length > 1 && !owner.issues.some((issue) => issue.code === 'OPTION_OWNERSHIP_AMBIGUOUS')) {
      owner.issues.push({
        code: 'OPTION_OWNERSHIP_AMBIGUOUS',
        message: `Option label ${firstLabel} had multiple possible owners and requires review`,
        blocking: true,
        provenance: [block.span]
      });
    }

    return owner;
  }

  if (
    currentQuestion &&
    ((currentQuestion.options.length > 0 && !currentQuestion.options.some((option) => option.label === firstLabel)) ||
      block.kind === 'list_item' ||
      entries.some((entry) => entry.label === 'A') ||
      entries.length > 1)
  ) {
    return currentQuestion;
  }

  return (
    section.questions.find(
      (question) => question.options.length > 0 && !question.options.some((option) => option.label === firstLabel)
    ) ?? currentQuestion
  );
}

function appendRegularBlock(
  section: MutableSection,
  currentQuestion: MutableQuestion | null,
  block: ExamImportSourceBlock
): void {
  if (!currentQuestion || SOLUTION_MARKER_PATTERN.test(block.text.trim())) return;

  const lowerListLabel = block.listNumber?.match(/^([a-z])\s*[.)]?$/u)?.[1] ?? null;
  if (lowerListLabel) {
    const html = sourceBlockSliceHtml(block, 0, block.text.length);
    addPromptPart(currentQuestion, block.text, block.span, lowerListLabel, html);
    return;
  }

  const parsedOptions = parseOptions(block.text, block.listNumber);
  if (parsedOptions.entries.length > 0) {
    if (parsedOptions.prefix) {
      const html = sourceBlockSliceHtml(block, 0, parsedOptions.prefixEnd);
      addPromptPart(currentQuestion, parsedOptions.prefix, block.span, null, html);
    }
    const owner = optionOwner(section, currentQuestion, parsedOptions.entries, block);
    if (!owner) {
      currentQuestion.issues.push({
        code: 'OPTION_OWNERSHIP_AMBIGUOUS',
        message: `Option label ${parsedOptions.entries[0]!.label} could not be assigned safely`,
        blocking: true,
        provenance: [block.span]
      });
      return;
    }

    for (const entry of parsedOptions.entries) {
      const html = sourceBlockSliceHtml(block, entry.contentStart, entry.contentEnd);
      const span = sourceBlockRangeSpan(block, entry.markerStart, entry.contentEnd);
      addOption(owner, entry, span, html);
    }
    return;
  }

  const lowerInline = block.text.match(LOWER_ITEM_PATTERN);
  if (lowerInline) {
    addPromptPart(currentQuestion, block.text.slice(lowerInline[0].length), block.span, lowerInline[1]!.toLowerCase());
    return;
  }

  if (currentQuestion.options.length === 0) {
    const html = sourceBlockSliceHtml(block, 0, block.text.length);
    addPromptPart(currentQuestion, block.text, block.span, null, html);
    return;
  }

  const previousOption = currentQuestion.options.at(-1)!;
  previousOption.text = `${previousOption.text} ${block.text.trim()}`;
  previousOption.html += sourceBlockSliceHtml(block, 0, block.text.length);
  previousOption.provenance.push(block.span);
  addProvenance(currentQuestion, block.span);
  currentQuestion.issues.push({
    code: 'OPTION_CONTINUATION_ATTACHED',
    message: `Unlabelled source text was attached to option ${previousOption.label}`,
    blocking: false,
    provenance: [block.span]
  });
}

function questionHtml(question: MutableQuestion, includeLowerItems: boolean): string {
  const parts = question.promptParts
    .filter((part) => includeLowerItems || part.label === null)
    .map((part) => (part.label === null ? part.html : paragraphHtml(`${part.label}. ${part.text}`)));
  if (parts.length > 0) return parts.join('');

  return paragraphHtml(`Question ${question.sourceNumber}`);
}

function questionDiagnostic(
  code: string,
  message: string,
  question: MutableQuestion,
  blocking: boolean
): ExamImportDiagnostic {
  return {
    tier: 'semantic',
    severity: blocking ? 'error' : 'warning',
    blocking,
    code,
    message,
    messageKey: `exam_import.diagnostics.${code.toLowerCase()}`,
    questionId: question.id,
    target: { kind: 'question_field', questionId: question.id, field: 'kind' },
    provenance: mergeProvenance(question.provenance)
  };
}

function buildQuestion(
  question: MutableQuestion,
  section: MutableSection,
  fieldStates: ExamImportFieldState[],
  diagnostics: ExamImportDiagnostic[]
): ExamImportQuestion {
  const provenance = mergeProvenance(question.provenance);
  const lowercaseParts = question.promptParts.filter((part) => part.label !== null);
  const trueFalseLabels = lowercaseParts.map((part) => part.label);
  const isTrueFalse =
    (section.trueFalse || question.trueFalseAnswerEvidence) &&
    question.options.length === 0 &&
    trueFalseLabels.length === 4 &&
    trueFalseLabels.every((label, index) => label === String.fromCharCode(97 + index));

  for (const issue of question.issues) {
    diagnostics.push({
      ...questionDiagnostic(issue.code, issue.message, question, issue.blocking),
      provenance: issue.provenance
    });
  }
  if (question.options.length >= 2 && question.options.length < 4) {
    diagnostics.push(
      questionDiagnostic(
        'OPTION_SET_INCOMPLETE',
        `Question has ${question.options.length} options; review whether an option is missing`,
        question,
        false
      )
    );
  }

  fieldStates.push(
    {
      target: { kind: 'question_field', questionId: question.id, field: 'kind' },
      confidence: 'high',
      origin: 'deterministic',
      provenance
    },
    {
      target: { kind: 'question_field', questionId: question.id, field: 'promptHtml' },
      confidence: question.promptParts.length > 0 ? 'high' : 'medium',
      origin: 'deterministic',
      provenance
    }
  );

  if (isTrueFalse) {
    const statements = lowercaseParts.map((part, index) => {
      const statementId = `${question.id}-statement-${part.label}`;
      fieldStates.push({
        target: { kind: 'statement_field', questionId: question.id, statementId, field: 'html' },
        confidence: 'high',
        origin: 'deterministic',
        provenance: [part.span]
      });

      return {
        id: statementId,
        sourceLabel: part.label!,
        html: part.html,
        order: index
      };
    });

    return {
      id: question.id,
      kind: 'true_false_group',
      order: question.order,
      sourceNumber: question.sourceNumber,
      promptHtml: questionHtml(question, false),
      points: question.points,
      cognitiveLevel: question.cognitiveLevel,
      passageId: question.passageId,
      statements,
      scoring: { mode: 'tiered', tiers: [0, 0.1, 0.25, 0.5, 1] },
      answerCandidates: [],
      answerKey: null,
      confidence: 'none',
      review: 'unresolved',
      provenance
    };
  }

  if (question.options.length >= 2) {
    const options = [...question.options]
      .sort((left, right) => left.label.localeCompare(right.label))
      .slice(0, MAX_INTERACTION_OPTIONS)
      .map((option, index) => {
        const optionId = `${question.id}-option-${option.label.toLowerCase()}`;
        fieldStates.push({
          target: { kind: 'option_field', questionId: question.id, optionId, field: 'html' },
          confidence: 'high',
          origin: 'deterministic',
          provenance: mergeProvenance(option.provenance)
        });

        return {
          id: optionId,
          sourceLabel: option.label,
          html: option.html,
          order: index
        };
      });

    return {
      id: question.id,
      kind: 'choice',
      order: question.order,
      sourceNumber: question.sourceNumber,
      promptHtml: questionHtml(question, true),
      points: question.points,
      cognitiveLevel: question.cognitiveLevel,
      passageId: question.passageId,
      cardinality: 'single',
      options,
      answerCandidates: [],
      answerKey: null,
      confidence: 'none',
      review: 'unresolved',
      provenance
    };
  }

  if (section.shortAnswer) {
    return {
      id: question.id,
      kind: 'short_answer',
      order: question.order,
      sourceNumber: question.sourceNumber,
      promptHtml: questionHtml(question, true),
      points: question.points,
      cognitiveLevel: question.cognitiveLevel,
      passageId: question.passageId,
      answerCandidates: [],
      answerKey: null,
      confidence: 'none',
      review: 'unresolved',
      provenance
    };
  }

  if (section.essay) {
    return {
      id: question.id,
      kind: 'essay',
      order: question.order,
      sourceNumber: question.sourceNumber,
      promptHtml: questionHtml(question, true),
      points: question.points,
      cognitiveLevel: question.cognitiveLevel,
      passageId: question.passageId,
      answerCandidates: [],
      answerKey: null,
      confidence: question.promptParts.length > 0 ? 'high' : 'medium',
      review: question.promptParts.length > 0 ? 'clean' : 'needs_attention',
      provenance
    };
  }

  diagnostics.push(
    questionDiagnostic(
      'QUESTION_STRUCTURE_UNRESOLVED',
      'The question could not be classified from its source structure',
      question,
      true
    )
  );
  const rawHtml = questionHtml(question, true);

  return {
    id: question.id,
    kind: 'unresolved',
    order: question.order,
    sourceNumber: question.sourceNumber,
    promptHtml: rawHtml,
    rawHtml,
    points: question.points,
    cognitiveLevel: question.cognitiveLevel,
    passageId: question.passageId,
    answerCandidates: [],
    answerKey: null,
    confidence: 'none',
    review: 'unresolved',
    provenance
  };
}

function inferTitle(blocks: ExamImportSourceBlock[], fileName: string): string {
  const firstBlock = blocks.find((block) => block.text.trim().length > 0);
  const boldTitle = firstBlock?.runs
    .map((run) => run.text.trim())
    .filter(
      (text, index) =>
        firstBlock.runs[index]?.formatting.bold && text.length >= 4 && !FORM_FIELD_LABEL_PATTERN.test(text)
    )
    .sort((left, right) => right.length - left.length)[0];
  if (boldTitle) return boldTitle;

  const firstText = firstBlock?.text.trim();
  if (firstText && firstText.length <= 500) return firstText;

  return fileName.replace(/\.[^.]+$/u, '') || fileName;
}

/**
 * Deterministically segments a normalized document run stream. It does not
 * infer answer keys; independent harvesters add candidates before the
 * reconciliation pass.
 */
export function segmentExamImportRuns(runs: SourceRun[], source: ExamImportDraft['source']): ExamImportDraft {
  const blocks = collectExamImportSourceBlocks(runs);
  const titleBlockIndex = blocks.find((block) => block.text.trim().length > 0)?.index ?? null;
  const tableLayouts = tablePassageLayouts(blocks);
  const answerBlocks = answerSourceBlockIndexes(blocks);
  const ordinaryTables = ordinaryTableLayouts(blocks, answerBlocks, tableLayouts.contentBlockIndexes);
  const title = inferTitle(blocks, source.fileName);
  const sections: MutableSection[] = [];
  const sharedContents: ExamImportDraft['sharedContents'] = [];
  const fieldStates: ExamImportFieldState[] = [];
  // Every other field records where it came from; the title did not, which left the block
  // it was read from looking like content that had gone nowhere.
  const titleBlock = titleBlockIndex === null ? null : blocks.find((block) => block.index === titleBlockIndex);
  if (titleBlock) {
    fieldStates.push({
      target: { kind: 'draft_field', field: 'title' },
      confidence: 'medium',
      origin: 'deterministic',
      provenance: [titleBlock.span]
    });
  }
  const diagnostics: ExamImportDiagnostic[] = [];
  let currentSection: MutableSection | null = null;
  let currentQuestion: MutableQuestion | null = null;
  let pendingPassageBlocks: ExamImportSourceBlock[] = [];
  let activePassageId: string | null = null;
  let activeTablePassageEndIndex: number | null = null;
  let collectingPassage = false;
  let inSolution = false;
  let questionOrder = 0;

  const ensureSection = (): MutableSection => {
    if (currentSection) return currentSection;
    if (sections.length >= MAX_EXAM_IMPORT_SECTIONS) {
      throw new Error(`Exam import cannot contain more than ${MAX_EXAM_IMPORT_SECTIONS} sections`);
    }

    currentSection = newSection('Questions', sections.length);
    sections.push(currentSection);
    return currentSection;
  };

  const reportUnassignedSourceContent = (unassignedBlocks: ExamImportSourceBlock[]): void => {
    if (unassignedBlocks.length === 0) return;

    diagnostics.push({
      tier: 'structural',
      severity: 'error',
      blocking: true,
      code: 'UNASSIGNED_SOURCE_CONTENT',
      message: 'Source content could not be assigned to an exam section, passage, or question',
      messageKey: 'exam_import.diagnostics.unassigned_source_content',
      questionId: null,
      target: null,
      provenance: mergeProvenance(unassignedBlocks.map((block) => block.span))
    });
  };

  const reportPendingPassageAsUnassigned = (): void => {
    reportUnassignedSourceContent(pendingPassageBlocks);
    pendingPassageBlocks = [];
    collectingPassage = false;
  };

  const startInstructionSection = (
    title: string,
    collectsPassage: boolean,
    instructionBlock: ExamImportSourceBlock | null = null
  ): void => {
    if (sections.length >= MAX_EXAM_IMPORT_SECTIONS) {
      throw new Error(`Exam import cannot contain more than ${MAX_EXAM_IMPORT_SECTIONS} sections`);
    }

    reportPendingPassageAsUnassigned();
    currentSection = newSection(title, sections.length);
    sections.push(currentSection);
    // The instruction line becomes this section's title, so it is accounted for. Without
    // the record it looked like source content that had gone nowhere.
    if (instructionBlock) {
      fieldStates.push({
        target: { kind: 'section_field', sectionId: currentSection.id, field: 'title' },
        confidence: 'high',
        origin: 'deterministic',
        provenance: [instructionBlock.span]
      });
    }
    currentQuestion = null;
    activePassageId = null;
    activeTablePassageEndIndex = null;
    pendingPassageBlocks = [];
    collectingPassage = collectsPassage;
    inSolution = false;
  };

  const finalizePendingPassage = (): void => {
    if (pendingPassageBlocks.length === 0) return;
    if (sharedContents.length >= MAX_EXAM_IMPORT_SHARED_CONTENTS) {
      throw new Error(`Exam import cannot contain more than ${MAX_EXAM_IMPORT_SHARED_CONTENTS} shared contents`);
    }

    const passageId = `shared-content-${sharedContents.length + 1}`;
    const provenance = mergeProvenance(pendingPassageBlocks.map((block) => block.span));
    sharedContents.push({
      id: passageId,
      kind: 'passage',
      html: pendingPassageBlocks.map((block) => sourceBlockHtml(block)).join(''),
      provenance
    });
    fieldStates.push({
      target: { kind: 'shared_content_field', contentId: passageId, field: 'html' },
      confidence: 'high',
      origin: 'deterministic',
      provenance
    });
    activePassageId = passageId;
    pendingPassageBlocks = [];
    collectingPassage = false;
  };

  const startQuestion = (
    number: string,
    content: string,
    contentOffset: number,
    columnMajorGroupId: string | null,
    block: ExamImportSourceBlock
  ): MutableQuestion => {
    finalizePendingPassage();
    const section = ensureSection();
    if (questionOrder >= MAX_EXAM_IMPORT_TOTAL_QUESTIONS) {
      throw new Error(`Exam import cannot contain more than ${MAX_EXAM_IMPORT_TOTAL_QUESTIONS} questions`);
    }
    if (section.questions.length >= MAX_EXAM_IMPORT_QUESTIONS_PER_SECTION) {
      throw new Error(
        `An exam import section cannot contain more than ${MAX_EXAM_IMPORT_QUESTIONS_PER_SECTION} questions`
      );
    }
    const parsedOptions = parseOptions(content, null);
    const metadata = parseQuestionMetadata(content.slice(0, parsedOptions.prefixEnd));
    const question: MutableQuestion = {
      id: `question-${questionOrder + 1}`,
      order: questionOrder,
      sourceNumber: number,
      points: metadata.points,
      cognitiveLevel: metadata.cognitiveLevel,
      passageId: activePassageId,
      promptParts: [],
      options: [],
      provenance: [block.span],
      issues: [],
      trueFalseAnswerEvidence: false,
      columnMajorGroupId
    };
    questionOrder++;
    section.questions.push(question);
    currentQuestion = question;

    if (metadata.text) {
      const lowerItem = metadata.text.match(LOWER_ITEM_PATTERN);
      if (lowerItem) {
        addPromptPart(question, metadata.text.slice(lowerItem[0].length), block.span, lowerItem[1]!.toLowerCase());
      } else {
        const htmlRanges = includedTextRanges(parsedOptions.prefixEnd, metadata.removedRanges).map((range) => ({
          start: contentOffset + range.start,
          end: contentOffset + range.end
        }));
        const html = sourceBlockRangesHtml(block, htmlRanges);
        addPromptPart(question, metadata.text, block.span, null, html);
      }
    }
    for (const entry of parsedOptions.entries) {
      const html = sourceBlockSliceHtml(block, contentOffset + entry.contentStart, contentOffset + entry.contentEnd);
      const span = sourceBlockRangeSpan(block, contentOffset + entry.markerStart, contentOffset + entry.contentEnd);
      addOption(question, entry, span, html);
    }

    return question;
  };

  for (const block of blocks) {
    const text = block.text.trim();
    const hasRichContent = block.runs.some((run) => run.math !== null || run.image !== null);
    if (activeTablePassageEndIndex !== null && block.index > activeTablePassageEndIndex) {
      activePassageId = null;
      activeTablePassageEndIndex = null;
    }

    const tableLayout = tableLayouts.byQuestionStart.get(block.index);
    if (tableLayout) {
      reportPendingPassageAsUnassigned();
      pendingPassageBlocks = tableLayout.contentBlocks;
      activePassageId = null;
      currentQuestion = null;
      collectingPassage = true;
      activeTablePassageEndIndex = tableLayout.endBlockIndex;
    }
    if (tableLayouts.contentBlockIndexes.has(block.index)) continue;
    const ordinaryTable = ordinaryTables.byStart.get(block.index);
    if (ordinaryTable) {
      const optionGrid = currentQuestion ? readOptionGridTable(ordinaryTable.blocks) : null;
      if (currentQuestion && optionGrid) {
        for (const option of optionGrid) addOption(currentQuestion, option.entry, option.block.span);
      } else if (currentQuestion) {
        addPromptPart(currentQuestion, ordinaryTable.text, ordinaryTable.span, null, ordinaryTable.html);
      } else if (collectingPassage) {
        pendingPassageBlocks.push(...ordinaryTable.blocks);
      }
      continue;
    }
    if (ordinaryTables.blockIndexes.has(block.index)) continue;
    if (!text && !hasRichContent) continue;
    if (END_MARKER_PATTERN.test(text)) {
      reportPendingPassageAsUnassigned();
      break;
    }

    if (isSectionMarker(text)) {
      if (sections.length >= MAX_EXAM_IMPORT_SECTIONS) {
        throw new Error(`Exam import cannot contain more than ${MAX_EXAM_IMPORT_SECTIONS} sections`);
      }
      const section = newSection(text, sections.length);
      sections.push(section);
      if (text.length > section.title.length) {
        diagnostics.push({
          tier: 'semantic',
          severity: 'warning',
          blocking: false,
          code: 'SECTION_TITLE_TRUNCATED',
          message: 'The section heading exceeded 500 characters and was truncated',
          messageKey: 'exam_import.diagnostics.section_title_truncated',
          questionId: null,
          target: null,
          provenance: [block.span]
        });
      }
      reportPendingPassageAsUnassigned();
      currentSection = section;
      currentQuestion = null;
      activePassageId = null;
      pendingPassageBlocks = [];
      collectingPassage = false;
      inSolution = false;
      continue;
    }

    if (RANGED_QUESTION_INSTRUCTION_PATTERN.test(text)) {
      startInstructionSection(text, true, block);
      continue;
    }

    if (PASSAGE_MARKER_PATTERN.test(text)) {
      if (!currentSection || currentSection.questions.length > 0) {
        startInstructionSection(text, true, block);
        continue;
      }

      reportPendingPassageAsUnassigned();
      activePassageId = null;
      currentQuestion = null;
      collectingPassage = true;
      inSolution = false;
      ensureSection();
      continue;
    }

    if (ARRANGEMENT_INSTRUCTION_PATTERN.test(text)) {
      startInstructionSection(text, false, block);
      continue;
    }

    // Asked before the block is read as a question. A trailing `1. B` key line matches
    // the bare-number question pattern, so a key list used to become a second set of
    // questions — a forty-question paper arriving as eighty.
    if (answerBlocks.has(block.index)) continue;

    const parsedMarkers = parseQuestionMarkers(block);
    if (parsedMarkers.markers.length > 0) {
      inSolution = false;
      if (pendingPassageBlocks.length > 0) finalizePendingPassage();
      if (parsedMarkers.prefix.trim() && currentQuestion) {
        appendRegularBlock(ensureSection(), currentQuestion, { ...block, text: parsedMarkers.prefix });
      }
      const columnMajorGroupId = parsedMarkers.markers.length > 1 ? `column-major-${block.index}` : null;
      for (const marker of parsedMarkers.markers) {
        currentQuestion = startQuestion(
          marker.number,
          block.text.slice(marker.contentStart, marker.end),
          marker.contentStart,
          columnMajorGroupId,
          block
        );
      }
      continue;
    }

    if (SOLUTION_MARKER_PATTERN.test(text)) {
      inSolution = true;
      continue;
    }
    if (ANSWER_LINE_PATTERN.test(text)) {
      const answerText = text.slice(text.indexOf(':') + 1);
      if (currentQuestion && hasFourBooleanAnswerValues(answerText)) {
        currentQuestion.trueFalseAnswerEvidence = true;
      }
      continue;
    }
    if (inSolution) continue;

    if (currentQuestion === null && activePassageId === null && collectingPassage) {
      pendingPassageBlocks.push(block);
      continue;
    }

    if (currentQuestion === null) {
      if (block.index !== titleBlockIndex && !FORM_FIELD_LABEL_PATTERN.test(text)) {
        reportUnassignedSourceContent([block]);
      }
      continue;
    }

    appendRegularBlock(ensureSection(), currentQuestion, block);
  }

  reportPendingPassageAsUnassigned();

  const outputSections = sections
    .filter((section) => section.questions.length > 0)
    .map((section, sectionIndex) => ({
      id: section.id,
      title: section.title,
      order: sectionIndex,
      questions: section.questions.map((question) => buildQuestion(question, section, fieldStates, diagnostics))
    }));

  for (const section of outputSections) {
    const range = section.title.match(INSTRUCTION_RANGE_PATTERN);
    if (!range) continue;

    const rangeStart = Number(range[1]);
    const rangeEnd = Number(range[2]);
    const outOfRangeQuestion = section.questions.find((question) => {
      const sourceNumber = Number(question.sourceNumber);

      return Number.isSafeInteger(sourceNumber) && (sourceNumber < rangeStart || sourceNumber > rangeEnd);
    });
    if (!outOfRangeQuestion) continue;

    diagnostics.push({
      tier: 'semantic',
      severity: 'warning',
      blocking: false,
      code: 'SECTION_QUESTION_RANGE_MISMATCH',
      message: `Section instruction states questions ${rangeStart} to ${rangeEnd}, but contains question ${outOfRangeQuestion.sourceNumber}`,
      messageKey: 'exam_import.diagnostics.section_question_range_mismatch',
      questionId: outOfRangeQuestion.id,
      target: { kind: 'section_field', sectionId: section.id, field: 'title' },
      provenance: outOfRangeQuestion.provenance
    });
  }

  for (const sharedContent of [...sharedContents]) {
    const groupedQuestions = outputSections
      .flatMap((section) => section.questions)
      .filter((question) => question.passageId === sharedContent.id);
    if (groupedQuestions.length <= MAX_ASSESSMENT_INTERACTIONS) continue;

    for (
      let chunkStart = MAX_ASSESSMENT_INTERACTIONS;
      chunkStart < groupedQuestions.length;
      chunkStart += MAX_ASSESSMENT_INTERACTIONS
    ) {
      if (sharedContents.length >= MAX_EXAM_IMPORT_SHARED_CONTENTS) {
        throw new Error(`Exam import cannot contain more than ${MAX_EXAM_IMPORT_SHARED_CONTENTS} shared contents`);
      }
      const duplicateId = `shared-content-${sharedContents.length + 1}`;
      sharedContents.push({ ...structuredClone(sharedContent), id: duplicateId });
      fieldStates.push({
        target: { kind: 'shared_content_field', contentId: duplicateId, field: 'html' },
        confidence: 'high',
        origin: 'deterministic',
        provenance: sharedContent.provenance
      });
      for (const question of groupedQuestions.slice(chunkStart, chunkStart + MAX_ASSESSMENT_INTERACTIONS)) {
        question.passageId = duplicateId;
      }
    }

    diagnostics.push({
      tier: 'semantic',
      severity: 'warning',
      blocking: false,
      code: 'PASSAGE_GROUP_REQUIRES_SPLIT',
      message: `Shared content has ${groupedQuestions.length} questions and was split for publishing`,
      messageKey: 'exam_import.diagnostics.passage_group_requires_split',
      questionId: null,
      target: { kind: 'shared_content_field', contentId: sharedContent.id, field: 'html' },
      provenance: sharedContent.provenance
    });
  }

  if (outputSections.length === 0) {
    const fallbackSpan = blocks[0]?.span ?? {
      start: { blockIndex: 0, runIndex: 0 },
      end: { blockIndex: 0, runIndex: 0 },
      pageStart: null,
      pageEnd: null
    };
    outputSections.push({
      id: 'section-1',
      title: 'Questions',
      order: 0,
      questions: [
        {
          id: 'question-1',
          kind: 'unresolved',
          order: 0,
          sourceNumber: '1',
          promptHtml: paragraphHtml(title),
          rawHtml: paragraphHtml(title),
          points: null,
          cognitiveLevel: null,
          passageId: null,
          answerCandidates: [],
          answerKey: null,
          confidence: 'none',
          review: 'unresolved',
          provenance: [fallbackSpan]
        }
      ]
    });
    diagnostics.push({
      tier: 'structural',
      severity: 'error',
      blocking: true,
      code: 'NO_QUESTIONS_DETECTED',
      message: 'No question markers were detected in the document',
      messageKey: 'exam_import.diagnostics.no_questions_detected',
      questionId: 'question-1',
      target: { kind: 'question_field', questionId: 'question-1', field: 'kind' },
      provenance: [fallbackSpan]
    });
  }

  const outputQuestions = outputSections.flatMap((section) => section.questions);
  const questionsWithExplicitPoints = new Set(
    sections
      .flatMap((section) => section.questions)
      .filter((question) => question.points !== null)
      .map((question) => question.id)
  );
  const scoreableQuestions = outputQuestions.filter((question) => question.kind !== 'unresolved');
  const hasMissingPoints = scoreableQuestions.some((question) => !questionsWithExplicitPoints.has(question.id));
  const hasExplicitPoints = questionsWithExplicitPoints.size > 0;
  if (hasMissingPoints) {
    for (const question of scoreableQuestions) {
      const explicit = questionsWithExplicitPoints.has(question.id);
      if (!explicit) question.points = 1;
      fieldStates.push({
        target: { kind: 'question_field', questionId: question.id, field: 'points' },
        confidence: explicit ? 'high' : 'medium',
        origin: 'deterministic',
        provenance: question.provenance
      });
    }
    const provenance = mergeProvenance(scoreableQuestions.flatMap((question) => question.provenance));
    diagnostics.push({
      tier: 'semantic',
      severity: hasExplicitPoints ? 'error' : 'warning',
      blocking: hasExplicitPoints,
      code: hasExplicitPoints ? 'POINTS_PARTIALLY_SPECIFIED' : 'POINTS_DEFAULTED',
      message: hasExplicitPoints
        ? 'Some questions specify points while others use the one-point default'
        : 'No question points were specified; every question uses the one-point default',
      messageKey: hasExplicitPoints
        ? 'exam_import.diagnostics.points_partially_specified'
        : 'exam_import.diagnostics.points_defaulted',
      questionId: null,
      target: null,
      provenance
    });
  } else {
    for (const question of scoreableQuestions) {
      fieldStates.push({
        target: { kind: 'question_field', questionId: question.id, field: 'points' },
        confidence: 'high',
        origin: 'deterministic',
        provenance: question.provenance
      });
    }
  }

  if (fieldStates.length > MAX_EXAM_IMPORT_FIELD_STATES) {
    throw new Error(`Exam import cannot contain more than ${MAX_EXAM_IMPORT_FIELD_STATES} field states`);
  }
  const boundedDiagnostics = boundExamImportDiagnostics(diagnostics);

  const draft: ExamImportDraft = {
    schemaVersion: 1,
    source: structuredClone(source),
    title,
    fieldStates,
    sharedContents,
    sections: outputSections,
    diagnostics: boundedDiagnostics
  };

  return examImportDraftSchema.parse(draft);
}
