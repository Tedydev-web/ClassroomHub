import { MAX_INTERACTION_OPTIONS } from '@cio/question-types';
import type { RunFormatting, SourceRun } from '../source-run';
import { examImportDraftSchema } from './exam-import-draft';
import type {
  ExamImportAnswerSource,
  ExamImportDiagnostic,
  ExamImportDraft,
  ExamImportQuestion,
  ExamImportSourceSpan
} from './exam-import-draft';
import {
  collectExamImportSourceBlocks,
  isExamImportAnswerTableBlocks,
  parseExamImportBooleanAnswerValues,
  type ExamImportSourceBlock
} from './exam-import-segmentation';

type AnswerEntry = {
  number: number;
  value: string;
  provenance: ExamImportSourceSpan[];
};

type TableCell = {
  tableIndex: number;
  row: number;
  column: number;
  text: string;
  provenance: ExamImportSourceSpan[];
};

type EmphasisKind = 'bold' | 'underline' | 'color' | 'highlight';

const GLOBAL_HARVEST_DIAGNOSTIC_CODES = new Set([
  'ANSWER_CANDIDATE_LIMIT_EXCEEDED',
  'ANSWER_KEY_COUNT_MISMATCH',
  'ANSWER_TOKEN_UNRESOLVED'
]);
const HARVESTED_ANSWER_SOURCES = new Set<ExamImportAnswerSource>([
  'answer_table',
  'emphasis',
  'key_string',
  'explicit_line'
]);
const EXPLICIT_ANSWER_PATTERN = /^(?:Đáp án|Dap an|Answer)\s*:\s*(.+)$/iu;
const KEY_PAIR_PATTERN = /(\d+)\s*[.)-]?\s*([A-D])(?=\s|$|\d)/giu;
const OPTION_MARKER_PATTERN = /([A-D])\s*[.)/]/gu;
const TABLE_QUESTION_HEADER_PATTERN = /^(?:câu|cau|question|questions?)$/iu;
const TABLE_ANSWER_HEADER_PATTERN = /^(?:chọn|chon|đáp án|dap an|answer|answers?|key)$/iu;

function normalizeCellText(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function tableCells(blocks: ExamImportSourceBlock[]): TableCell[] {
  const cells = new Map<string, TableCell>();

  for (const block of blocks) {
    const tableRef = block.runs[0]?.block.tableRef;
    if (!tableRef) continue;
    const key = `${tableRef.tableIndex}:${tableRef.originRow}:${tableRef.originColumn}`;
    const existing = cells.get(key);
    if (existing) {
      existing.text = normalizeCellText(`${existing.text} ${block.text}`);
      existing.provenance.push(block.span);
      continue;
    }

    cells.set(key, {
      tableIndex: tableRef.tableIndex,
      row: tableRef.originRow,
      column: tableRef.originColumn,
      text: normalizeCellText(block.text),
      provenance: [block.span]
    });
  }

  return [...cells.values()].sort(
    (left, right) => left.tableIndex - right.tableIndex || left.row - right.row || left.column - right.column
  );
}

function positiveInteger(value: string): number | null {
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function isAnswerValue(value: string): boolean {
  const normalized = normalizeCellText(value);

  return (
    /^[A-D](?:\s*[,/&]\s*[A-D])*$/iu.test(normalized) ||
    /^(?:Đ|D|S|T|F|0|1)(?:\s*[,/;|-]?\s*(?:Đ|D|S|T|F|0|1))+$/iu.test(normalized) ||
    /^-?\d+(?:[.,]\d+)?$/u.test(normalized) ||
    (normalized.length > 0 &&
      !TABLE_QUESTION_HEADER_PATTERN.test(normalized) &&
      !TABLE_ANSWER_HEADER_PATTERN.test(normalized))
  );
}

function normalTableEntries(cells: TableCell[]): AnswerEntry[] {
  const rows = new Map<number, TableCell[]>();
  for (const cell of cells) {
    const row = rows.get(cell.row);
    if (row) row.push(cell);
    else rows.set(cell.row, [cell]);
  }

  let best: AnswerEntry[] = [];
  for (const numberRow of rows.values()) {
    const numberedCells = numberRow
      .map((cell) => ({ cell, number: positiveInteger(cell.text) }))
      .filter((entry): entry is { cell: TableCell; number: number } => entry.number !== null);
    if (numberedCells.length === 0) continue;

    for (const answerRow of rows.values()) {
      if (answerRow === numberRow) continue;
      const answersByColumn = new Map(answerRow.map((cell) => [cell.column, cell]));
      const entries = numberedCells.flatMap(({ cell, number }) => {
        const answerCell = answersByColumn.get(cell.column);
        if (!answerCell || !isAnswerValue(answerCell.text)) return [];

        return [
          {
            number,
            value: answerCell.text,
            provenance: [...cell.provenance, ...answerCell.provenance]
          }
        ];
      });
      if (entries.length > best.length) best = entries;
    }
  }

  return best;
}

function transposedTableEntries(cells: TableCell[]): AnswerEntry[] {
  const rows = new Map<number, TableCell[]>();
  for (const cell of cells) {
    const row = rows.get(cell.row);
    if (row) row.push(cell);
    else rows.set(cell.row, [cell]);
  }

  return [...rows.values()].flatMap((row) => {
    const numberCells = row
      .map((cell) => ({ cell, number: positiveInteger(cell.text) }))
      .filter((entry): entry is { cell: TableCell; number: number } => entry.number !== null);
    if (numberCells.length !== 1) return [];
    const answerCell = row.find((cell) => cell !== numberCells[0]!.cell && isAnswerValue(cell.text));
    if (!answerCell) return [];

    return [
      {
        number: numberCells[0]!.number,
        value: answerCell.text,
        provenance: [...numberCells[0]!.cell.provenance, ...answerCell.provenance]
      }
    ];
  });
}

function answerTableEntries(blocks: ExamImportSourceBlock[]): AnswerEntry[] {
  const cellsByTable = new Map<number, TableCell[]>();
  for (const cell of tableCells(blocks)) {
    const table = cellsByTable.get(cell.tableIndex);
    if (table) table.push(cell);
    else cellsByTable.set(cell.tableIndex, [cell]);
  }

  return [...cellsByTable.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([tableIndex, cells]) => {
      const tableBlocks = blocks.filter((block) => block.runs[0]?.block.tableRef?.tableIndex === tableIndex);
      if (!isExamImportAnswerTableBlocks(tableBlocks)) return [];

      const hasQuestionHeader = cells.some((cell) => TABLE_QUESTION_HEADER_PATTERN.test(cell.text));
      const hasAnswerHeader = cells.some((cell) => TABLE_ANSWER_HEADER_PATTERN.test(cell.text));
      if (!hasQuestionHeader || !hasAnswerHeader) return [];

      const normal = normalTableEntries(cells);
      const transposed = transposedTableEntries(cells);

      return normal.length >= transposed.length ? normal : transposed;
    });
}

function parseKeyPairs(text: string, provenance: ExamImportSourceSpan[]): AnswerEntry[] {
  const matches = [...text.matchAll(KEY_PAIR_PATTERN)];
  if (matches.length === 0) return [];

  return matches.map((match) => ({
    number: Number(match[1]),
    value: match[2]!.toUpperCase(),
    provenance
  }));
}

function compactKeyEntries(blocks: ExamImportSourceBlock[]): AnswerEntry[] {
  const entries: AnswerEntry[] = [];

  for (const block of blocks) {
    const explicit = block.text.trim().match(EXPLICIT_ANSWER_PATTERN);
    const candidateText = explicit?.[1] ?? block.text.trim();
    const parsed = parseKeyPairs(candidateText, [block.span]);
    if (parsed.length === 0) continue;

    const residue = candidateText.replace(KEY_PAIR_PATTERN, '').replace(/[\s,;|]+/gu, '');
    if (residue.length === 0) entries.push(...parsed);
  }

  return entries;
}

function diagnostic(
  code: string,
  message: string,
  provenance: ExamImportSourceSpan[],
  question: ExamImportQuestion | null = null
): ExamImportDiagnostic {
  return {
    tier: 'semantic',
    severity: 'error',
    blocking: true,
    code,
    message,
    messageKey: `exam_import.diagnostics.${code.toLowerCase()}`,
    questionId: question?.id ?? null,
    target: question ? { kind: 'question_field', questionId: question.id, field: 'answerKey' } : null,
    provenance
  };
}

function choiceOptionIds(question: Extract<ExamImportQuestion, { kind: 'choice' }>, value: string): string[] {
  const normalized = normalizeCellText(value).toUpperCase();
  if (!/^[A-D](?:\s*[,/&;|]\s*[A-D])*$/u.test(normalized)) return [];

  const labels = [...normalized.matchAll(/[A-D]/gu)].map((match) => match[0]);
  const optionIds = labels.flatMap((label) => {
    const options = question.options.filter((candidate) => candidate.sourceLabel.toUpperCase() === label);

    return options.length === 1 ? [options[0]!.id] : [];
  });

  return optionIds.length === labels.length ? optionIds : [];
}

function trueFalseValues(value: string): boolean[] {
  return parseExamImportBooleanAnswerValues(value);
}

function addCandidate(
  question: ExamImportQuestion,
  value: string,
  source: ExamImportAnswerSource,
  candidateId: string,
  provenance: ExamImportSourceSpan[],
  diagnostics: ExamImportDiagnostic[]
): boolean {
  if (question.answerCandidates.some((candidate) => candidate.id === candidateId)) return true;
  if (question.answerCandidates.length >= MAX_INTERACTION_OPTIONS) {
    const alreadyReported = diagnostics.some(
      (entry) => entry.code === 'ANSWER_CANDIDATE_LIMIT_EXCEEDED' && entry.questionId === question.id
    );
    if (!alreadyReported) {
      diagnostics.push(
        diagnostic(
          'ANSWER_CANDIDATE_LIMIT_EXCEEDED',
          `Question has more than ${MAX_INTERACTION_OPTIONS} independent answer candidates`,
          provenance,
          question
        )
      );
    }

    return true;
  }

  switch (question.kind) {
    case 'choice': {
      const correctOptionIds = choiceOptionIds(question, value);
      if (correctOptionIds.length === 0) return false;
      question.answerCandidates.push({
        id: candidateId,
        kind: 'choice',
        correctOptionIds,
        source,
        provenance
      });
      return true;
    }
    case 'true_false_group': {
      const values = trueFalseValues(value);
      if (values.length !== question.statements.length) return false;
      question.answerCandidates.push({
        id: candidateId,
        kind: 'true_false_group',
        answers: question.statements.map((statement, index) => ({
          statementId: statement.id,
          correctValue: values[index]!
        })),
        source,
        provenance
      });
      return true;
    }
    case 'short_answer': {
      const acceptedAnswers = value
        .split('|')
        .map((answer) => answer.trim())
        .filter((answer) => answer.length > 0);
      if (acceptedAnswers.length === 0) return false;
      question.answerCandidates.push({
        id: candidateId,
        kind: 'short_answer',
        acceptedAnswers,
        source,
        provenance
      });
      return true;
    }
    case 'numeric': {
      const numericValue = Number(value.trim().replace(',', '.'));
      if (!Number.isFinite(numericValue)) return false;
      question.answerCandidates.push({
        id: candidateId,
        kind: 'numeric',
        value: numericValue,
        tolerance: null,
        source,
        provenance
      });
      return true;
    }
    case 'essay':
    case 'unresolved':
      return false;
  }

  question satisfies never;
  return false;
}

function applyOrderedEntries(
  questions: ExamImportQuestion[],
  entries: AnswerEntry[],
  source: Extract<ExamImportAnswerSource, 'answer_table' | 'key_string'>,
  diagnostics: ExamImportDiagnostic[]
): void {
  if (entries.length === 0) return;

  const provenance = entries.flatMap((entry) => entry.provenance);
  if (entries.length === questions.length) {
    entries.forEach((entry, index) => {
      const question = questions[index]!;
      const added = addCandidate(
        question,
        entry.value,
        source,
        `harvest-${source}-${index + 1}`,
        entry.provenance,
        diagnostics
      );
      if (!added) {
        diagnostics.push(
          diagnostic(
            'ANSWER_TOKEN_UNRESOLVED',
            `The ${source} value could not be mapped to question ${index + 1}`,
            entry.provenance,
            question
          )
        );
      }
    });
    return;
  }

  const entriesByNumber = new Map<number, AnswerEntry[]>();
  for (const entry of entries) {
    const numbered = entriesByNumber.get(entry.number);
    if (numbered) numbered.push(entry);
    else entriesByNumber.set(entry.number, [entry]);
  }
  const coversEveryQuestion =
    entriesByNumber.size === questions.length && questions.every((_, index) => entriesByNumber.has(index + 1));
  if (coversEveryQuestion) {
    questions.forEach((question, questionIndex) => {
      const numberedEntries = entriesByNumber.get(questionIndex + 1)!;
      numberedEntries.forEach((entry, candidateIndex) => {
        const added = addCandidate(
          question,
          entry.value,
          source,
          `harvest-${source}-${questionIndex + 1}-${candidateIndex + 1}`,
          entry.provenance,
          diagnostics
        );
        if (!added) {
          diagnostics.push(
            diagnostic(
              'ANSWER_TOKEN_UNRESOLVED',
              `The ${source} value could not be mapped to question ${questionIndex + 1}`,
              entry.provenance,
              question
            )
          );
        }
      });
    });
    return;
  }

  diagnostics.push(
    diagnostic(
      'ANSWER_KEY_COUNT_MISMATCH',
      `The ${source} contains ${entries.length} entries for ${questions.length} questions`,
      provenance
    )
  );
}

function latestQuestionBefore(questions: ExamImportQuestion[], blockIndex: number): ExamImportQuestion | null {
  let latest: ExamImportQuestion | null = null;
  let latestStart = -1;

  for (const question of questions) {
    const start = question.provenance[0]?.start.blockIndex ?? -1;
    if (start <= blockIndex && start >= latestStart) {
      latest = question;
      latestStart = start;
    }
  }

  return latest;
}

function applyExplicitAnswers(
  questions: ExamImportQuestion[],
  blocks: ExamImportSourceBlock[],
  diagnostics: ExamImportDiagnostic[]
): void {
  for (const block of blocks) {
    if (block.kind === 'table_cell') continue;
    const match = block.text.trim().match(EXPLICIT_ANSWER_PATTERN);
    if (!match || parseKeyPairs(match[1]!, [block.span]).length > 0) continue;
    const question = latestQuestionBefore(questions, block.index);
    if (!question) continue;
    const added = addCandidate(
      question,
      match[1]!.trim(),
      'explicit_line',
      `harvest-explicit-${block.index}`,
      [block.span],
      diagnostics
    );
    if (!added) {
      diagnostics.push(
        diagnostic(
          'ANSWER_TOKEN_UNRESOLVED',
          'The explicit answer could not be mapped to the preceding question',
          [block.span],
          question
        )
      );
    }
  }
}

function formattingAtMarker(
  block: ExamImportSourceBlock,
  label: string,
  span: ExamImportSourceSpan
): RunFormatting | null {
  const markers = [...block.text.matchAll(OPTION_MARKER_PATTERN)].filter((match) => match[1] === label);
  for (const marker of markers) {
    let offset = 0;
    for (const run of block.runs) {
      const end = offset + run.text.length;
      const withinSpan =
        run.location.runIndex >= (block.index === span.start.blockIndex ? span.start.runIndex : 0) &&
        run.location.runIndex <= (block.index === span.end.blockIndex ? span.end.runIndex : Number.POSITIVE_INFINITY);
      if (withinSpan && marker.index >= offset && marker.index < end) return run.formatting;
      offset = end;
    }
  }

  return null;
}

function isEmphasized(formatting: RunFormatting, kind: EmphasisKind): boolean {
  switch (kind) {
    case 'bold':
      return formatting.bold;
    case 'underline':
      return formatting.underline;
    case 'color':
      return formatting.color !== null;
    case 'highlight':
      return formatting.highlight !== null;
  }

  kind satisfies never;
  return false;
}

function applyEmphasisCandidates(
  draft: ExamImportDraft,
  blocks: ExamImportSourceBlock[],
  diagnostics: ExamImportDiagnostic[]
): void {
  const blocksByIndex = new Map(blocks.map((block) => [block.index, block]));
  const choices = draft.sections
    .flatMap((section) => section.questions)
    .filter((question): question is Extract<ExamImportQuestion, { kind: 'choice' }> => question.kind === 'choice');
  const emphasisKinds: EmphasisKind[] = ['underline', 'highlight', 'color', 'bold'];

  for (const kind of emphasisKinds) {
    const selections = choices.flatMap((question, questionIndex) => {
      const selectedOptions = question.options.filter((option) => {
        const fieldState = draft.fieldStates.find(
          (state) =>
            state.target.kind === 'option_field' &&
            state.target.questionId === question.id &&
            state.target.optionId === option.id &&
            state.target.field === 'html'
        );
        if (!fieldState) return false;

        return fieldState.provenance.some((span) => {
          for (let blockIndex = span.start.blockIndex; blockIndex <= span.end.blockIndex; blockIndex++) {
            const block = blocksByIndex.get(blockIndex);
            if (!block) continue;
            const formatting = formattingAtMarker(block, option.sourceLabel.toUpperCase(), span);
            if (formatting && isEmphasized(formatting, kind)) return true;
          }

          return false;
        });
      });

      return selectedOptions.length > 0 ? [{ question, questionIndex, selectedOptions }] : [];
    });
    const validDocumentPattern =
      selections.length > 0 &&
      selections.every(
        ({ question, selectedOptions }) =>
          selectedOptions.length === 1 && selectedOptions.length < question.options.length
      );
    if (!validDocumentPattern) continue;

    for (const { question, questionIndex, selectedOptions } of selections) {
      const option = selectedOptions[0]!;
      const fieldState = draft.fieldStates.find(
        (state) =>
          state.target.kind === 'option_field' &&
          state.target.questionId === question.id &&
          state.target.optionId === option.id &&
          state.target.field === 'html'
      );
      if (!fieldState) continue;
      addCandidate(
        question,
        option.sourceLabel,
        'emphasis',
        `harvest-emphasis-${kind}-${questionIndex + 1}`,
        fieldState.provenance,
        diagnostics
      );
    }
  }
}

/**
 * Adds independent deterministic answer candidates without choosing a winner.
 * Reconciliation remains a separate, pure pass.
 */
export function harvestExamImportAnswerCandidates(draft: ExamImportDraft, runs: SourceRun[]): ExamImportDraft {
  const next = examImportDraftSchema.parse(structuredClone(draft));
  const blocks = collectExamImportSourceBlocks(runs);
  const questions = next.sections.flatMap((section) => section.questions);
  next.diagnostics = next.diagnostics.filter((entry) => !GLOBAL_HARVEST_DIAGNOSTIC_CODES.has(entry.code));
  for (const question of questions) {
    switch (question.kind) {
      case 'choice':
        question.answerCandidates = question.answerCandidates.filter(
          (candidate) => !HARVESTED_ANSWER_SOURCES.has(candidate.source)
        );
        break;
      case 'true_false_group':
        question.answerCandidates = question.answerCandidates.filter(
          (candidate) => !HARVESTED_ANSWER_SOURCES.has(candidate.source)
        );
        break;
      case 'short_answer':
        question.answerCandidates = question.answerCandidates.filter(
          (candidate) => !HARVESTED_ANSWER_SOURCES.has(candidate.source)
        );
        break;
      case 'numeric':
        question.answerCandidates = question.answerCandidates.filter(
          (candidate) => !HARVESTED_ANSWER_SOURCES.has(candidate.source)
        );
        break;
      case 'essay':
      case 'unresolved':
        break;
    }
  }

  applyOrderedEntries(questions, answerTableEntries(blocks), 'answer_table', next.diagnostics);
  applyOrderedEntries(questions, compactKeyEntries(blocks), 'key_string', next.diagnostics);
  applyExplicitAnswers(questions, blocks, next.diagnostics);
  applyEmphasisCandidates(next, blocks, next.diagnostics);

  return examImportDraftSchema.parse(next);
}
