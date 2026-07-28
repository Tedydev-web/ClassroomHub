import { MAX_INTERACTION_OPTIONS } from '@cio/question-types';

import {
  MAX_EXAM_IMPORT_QUESTIONS_PER_SECTION,
  boundExamImportDiagnostics,
  type ExamImportDiagnostic,
  type ExamImportDraft,
  type ExamImportFieldState,
  type ExamImportQuestion,
  type ExamImportSourceSpan
} from '../draft/exam-import-draft';

const SUPPORTED_ESCAPES = new Set(['\\', '~', '=', '#', '{', '}', ':']);
const MAX_GIFT_TITLE_LENGTH = 64;
export const MAX_GIFT_INPUT_CHARACTERS = 5 * 1024 * 1024;

export type GiftImportSource = Omit<ExamImportDraft['source'], 'extractor'>;

export type GiftFeedback =
  | {
      kind: 'answer';
      questionId: string;
      optionId: string;
      html: string;
      line: number;
    }
  | {
      kind: 'general';
      questionId: string;
      html: string;
      line: number;
    };

export type GiftParseInput = {
  text: string;
  source: GiftImportSource;
};

export type GiftParseResult = {
  draft: ExamImportDraft;
  feedback: GiftFeedback[];
  findings: ExamImportDiagnostic[];
};

type GiftBlock = {
  text: string;
  startLine: number;
  endLine: number;
};

type DecodeResult = {
  text: string;
  unsupportedEscapeLines: number[];
};

type ParsedAnswer = {
  marker: '=' | '~';
  text: string;
  weight: number | null;
  feedback: string | null;
  line: number;
  feedbackLine: number | null;
};

type ParsedQuestion = {
  title: string | null;
  prompt: string;
  answers: ParsedAnswer[];
  generalFeedback: string | null;
  generalFeedbackLine: number | null;
  unsupportedEscapeLines: number[];
};

type ChoiceQuestion = Extract<ExamImportQuestion, { kind: 'choice' }>;

function splitBlocks(text: string): GiftBlock[] {
  const lines = text.replace(/\r\n?/gu, '\n').split('\n');
  const blocks: GiftBlock[] = [];
  let blockLines: string[] = [];
  let startLine = 1;

  const finishBlock = (endLine: number) => {
    if (blockLines.length === 0) return;

    blocks.push({
      text: blockLines.join('\n'),
      startLine,
      endLine
    });
    blockLines = [];
  };

  for (const [lineIndex, line] of lines.entries()) {
    if (line.trim().length === 0) {
      finishBlock(lineIndex);
      continue;
    }
    if (blockLines.length === 0) startLine = lineIndex + 1;
    blockLines.push(line);
  }
  finishBlock(lines.length);

  return blocks;
}

function isEscaped(value: string, index: number): boolean {
  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    backslashCount += 1;
  }

  return backslashCount % 2 === 1;
}

function findUnescaped(value: string, needle: string, fromIndex = 0): number {
  for (let index = fromIndex; index <= value.length - needle.length; index += 1) {
    if (value.startsWith(needle, index) && !isEscaped(value, index)) return index;
  }

  return -1;
}

function lineAt(value: string, index: number, startLine: number): number {
  let line = startLine;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (value[cursor] === '\n') line += 1;
  }

  return line;
}

function sourceSpan(startLine: number, endLine = startLine): ExamImportSourceSpan {
  return {
    start: { blockIndex: startLine - 1, runIndex: 0 },
    end: { blockIndex: endLine - 1, runIndex: 0 },
    pageStart: null,
    pageEnd: null
  };
}

function decodeGiftText(value: string, startLine: number): DecodeResult {
  let text = '';
  let line = startLine;
  const unsupportedEscapeLines: number[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === '\n') {
      line += 1;
      text += character;
      continue;
    }
    if (character !== '\\') {
      text += character;
      continue;
    }

    const escaped = value[index + 1];
    if (escaped === undefined || !SUPPORTED_ESCAPES.has(escaped)) {
      unsupportedEscapeLines.push(line);
      text += character;
      continue;
    }

    text += escaped;
    index += 1;
  }

  return { text: text.trim(), unsupportedEscapeLines };
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
  return `<p>${escapeHtml(value.trim()).replace(/\n/gu, '<br>')}</p>`;
}

function finding(
  code: string,
  message: string,
  line: number,
  questionId: string | null,
  tier: 'structural' | 'semantic' = 'semantic'
): ExamImportDiagnostic {
  return {
    tier,
    severity: 'error',
    blocking: true,
    code,
    message: `Line ${line}: ${message}`,
    messageKey: `exam_import.diagnostics.${code.toLowerCase()}`,
    questionId,
    target: null,
    provenance: [sourceSpan(line)]
  };
}

function questionId(questionIndex: number): string {
  return `gift-question-${questionIndex + 1}`;
}

function optionId(questionIndex: number, optionIndex: number): string {
  return `gift-option-${questionIndex + 1}-${optionIndex + 1}`;
}

function unresolvedQuestion(
  block: GiftBlock,
  index: number,
  title: string | null,
  prompt: string | null
): ExamImportQuestion {
  const fallbackText = prompt?.trim() || title?.trim() || block.text.trim() || 'Unsupported GIFT question';
  const rawHtml = paragraphHtml(block.text);

  return {
    id: questionId(index),
    kind: 'unresolved',
    order: index,
    sourceNumber: title !== null && title.length > 0 && title.length <= MAX_GIFT_TITLE_LENGTH ? title : null,
    promptHtml: paragraphHtml(fallbackText),
    rawHtml,
    points: null,
    cognitiveLevel: null,
    passageId: null,
    answerCandidates: [],
    answerKey: null,
    confidence: 'none',
    review: 'unresolved',
    provenance: [sourceSpan(block.startLine, block.endLine)]
  };
}

function parseWeight(rawAnswer: string): {
  answer: string;
  weight: number | null;
  malformed: boolean;
} {
  const leadingWhitespace = rawAnswer.match(/^\s*/u)?.[0] ?? '';
  const answer = rawAnswer.slice(leadingWhitespace.length);
  if (!answer.startsWith('%')) {
    return { answer: rawAnswer, weight: null, malformed: false };
  }

  const closingIndex = answer.indexOf('%', 1);
  if (closingIndex < 0) {
    return { answer: rawAnswer, weight: null, malformed: true };
  }

  const weightText = answer.slice(1, closingIndex);
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(weightText)) {
    return { answer: rawAnswer, weight: null, malformed: true };
  }

  const weight = Number(weightText);
  if (!Number.isFinite(weight)) {
    return { answer: rawAnswer, weight: null, malformed: true };
  }

  return {
    answer: `${leadingWhitespace}${answer.slice(closingIndex + 1)}`,
    weight,
    malformed: false
  };
}

function answerStarts(value: string): number[] {
  const starts: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if ((character === '=' || character === '~') && !isEscaped(value, index)) {
      starts.push(index);
    }
  }

  return starts;
}

function parseQuestionBlock(block: GiftBlock): ParsedQuestion | null {
  const record = block.text.trim();
  let cursor = 0;
  let title: string | null = null;
  const unsupportedEscapeLines: number[] = [];

  if (record.startsWith('::')) {
    const titleEnd = findUnescaped(record, '::', 2);
    if (titleEnd < 0) return null;

    const titleResult = decodeGiftText(record.slice(2, titleEnd), block.startLine);
    title = titleResult.text;
    unsupportedEscapeLines.push(...titleResult.unsupportedEscapeLines);
    cursor = titleEnd + 2;
  }

  const answerStart = findUnescaped(record, '{', cursor);
  if (answerStart < 0) return null;
  const answerEnd = findUnescaped(record, '}', answerStart + 1);
  if (answerEnd < 0 || record.slice(answerEnd + 1).trim().length > 0) return null;
  if (findUnescaped(record, '{', answerStart + 1) >= 0) return null;

  const promptStartLine = lineAt(record, cursor, block.startLine);
  const promptResult = decodeGiftText(record.slice(cursor, answerStart), promptStartLine);
  unsupportedEscapeLines.push(...promptResult.unsupportedEscapeLines);
  if (promptResult.text.length === 0) return null;

  const answerBodyStart = answerStart + 1;
  const answerBody = record.slice(answerBodyStart, answerEnd);
  const generalFeedbackIndex = findUnescaped(answerBody, '####');
  const answerText = generalFeedbackIndex < 0 ? answerBody : answerBody.slice(0, generalFeedbackIndex);
  const starts = answerStarts(answerText);
  if (starts.length === 0 || answerText.slice(0, starts[0]).trim().length > 0) return null;

  const answers: ParsedAnswer[] = [];
  for (const [answerIndex, start] of starts.entries()) {
    const end = starts[answerIndex + 1] ?? answerText.length;
    const marker = answerText[start];
    if (marker !== '=' && marker !== '~') return null;

    const answerLine = lineAt(record, answerBodyStart + start, block.startLine);
    const weighted = parseWeight(answerText.slice(start + 1, end));
    if (weighted.malformed) return null;

    const feedbackIndex = findUnescaped(weighted.answer, '#');
    const rawValue = feedbackIndex < 0 ? weighted.answer : weighted.answer.slice(0, feedbackIndex);
    const rawFeedback = feedbackIndex < 0 ? null : weighted.answer.slice(feedbackIndex + 1);
    const answerResult = decodeGiftText(rawValue, answerLine);
    unsupportedEscapeLines.push(...answerResult.unsupportedEscapeLines);
    if (answerResult.text.length === 0) return null;

    let feedback: string | null = null;
    let feedbackLine: number | null = null;
    if (rawFeedback !== null) {
      feedbackLine = lineAt(weighted.answer, feedbackIndex, answerLine);
      const feedbackResult = decodeGiftText(rawFeedback, feedbackLine);
      feedback = feedbackResult.text;
      unsupportedEscapeLines.push(...feedbackResult.unsupportedEscapeLines);
      if (feedback.length === 0) return null;
    }

    answers.push({
      marker,
      text: answerResult.text,
      weight: weighted.weight,
      feedback,
      line: answerLine,
      feedbackLine
    });
  }

  let generalFeedback: string | null = null;
  let generalFeedbackLine: number | null = null;
  if (generalFeedbackIndex >= 0) {
    generalFeedbackLine = lineAt(record, answerBodyStart + generalFeedbackIndex, block.startLine);
    const rawFeedback = answerBody.slice(generalFeedbackIndex + 4);
    const feedbackResult = decodeGiftText(rawFeedback, generalFeedbackLine);
    generalFeedback = feedbackResult.text;
    unsupportedEscapeLines.push(...feedbackResult.unsupportedEscapeLines);
    if (generalFeedback.length === 0) return null;
  }

  return {
    title,
    prompt: promptResult.text,
    answers,
    generalFeedback,
    generalFeedbackLine,
    unsupportedEscapeLines
  };
}

function choiceQuestion(block: GiftBlock, parsed: ParsedQuestion, index: number): ChoiceQuestion {
  const id = questionId(index);
  const hasExplicitWeights = parsed.answers.some((answer) => answer.weight !== null);
  const scoreWeights = Object.fromEntries(
    parsed.answers.map((answer, optionIndex) => [
      optionId(index, optionIndex),
      answer.weight ?? (answer.marker === '=' ? 100 : 0)
    ])
  );
  const correctOptionIds = parsed.answers.flatMap((answer, optionIndex) => {
    const correct = (answer.weight ?? (answer.marker === '=' ? 100 : 0)) > 0;

    return correct ? [optionId(index, optionIndex)] : [];
  });
  const candidateId = `gift-answer-${index + 1}`;
  const provenance = [sourceSpan(block.startLine, block.endLine)];
  const feedback = [
    ...parsed.answers.flatMap((answer, optionIndex) =>
      answer.feedback === null ? [] : [{ optionId: optionId(index, optionIndex), html: paragraphHtml(answer.feedback) }]
    ),
    ...(parsed.generalFeedback === null ? [] : [{ optionId: null, html: paragraphHtml(parsed.generalFeedback) }])
  ];

  return {
    id,
    kind: 'choice',
    order: index,
    sourceNumber: parsed.title,
    promptHtml: paragraphHtml(parsed.prompt),
    points: null,
    cognitiveLevel: null,
    passageId: null,
    cardinality: correctOptionIds.length === 1 ? 'single' : 'multiple',
    options: parsed.answers.map((answer, optionIndex) => ({
      id: optionId(index, optionIndex),
      sourceLabel: String(optionIndex + 1),
      html: paragraphHtml(answer.text),
      order: optionIndex
    })),
    ...(hasExplicitWeights ? { scoreWeights } : {}),
    ...(feedback.length > 0 ? { feedback } : {}),
    answerCandidates: [
      {
        id: candidateId,
        kind: 'choice',
        correctOptionIds,
        source: 'explicit_line',
        provenance
      }
    ],
    answerKey: {
      kind: 'choice',
      correctOptionIds,
      agreement: 'single_source',
      selectedCandidateIds: [candidateId],
      conflictingCandidateIds: []
    },
    confidence: 'high',
    review: 'clean',
    provenance
  };
}

function choiceFieldStates(question: ChoiceQuestion): ExamImportFieldState[] {
  return [
    {
      target: { kind: 'question_field', questionId: question.id, field: 'promptHtml' },
      confidence: 'high',
      origin: 'deterministic',
      provenance: question.provenance
    },
    {
      target: { kind: 'question_field', questionId: question.id, field: 'answerKey' },
      confidence: 'high',
      origin: 'deterministic',
      provenance: question.provenance
    }
  ];
}

function draftTitle(fileName: string): string {
  const leafName = fileName.split(/[\\/]/u).at(-1)?.trim() || 'Imported GIFT';
  const withoutExtension = leafName.replace(/\.gift$/iu, '').trim();

  return (withoutExtension || 'Imported GIFT').slice(0, 500);
}

export function parseGift(input: GiftParseInput): GiftParseResult {
  const inputTooLarge = input.text.length > MAX_GIFT_INPUT_CHARACTERS;
  const blocks = inputTooLarge ? [] : splitBlocks(input.text);
  const questions: ExamImportQuestion[] = [];
  const fieldStates: ExamImportFieldState[] = [];
  const feedback: GiftFeedback[] = [];
  const findings: ExamImportDiagnostic[] = [];

  if (inputTooLarge) {
    findings.push(
      finding(
        'GIFT_DOCUMENT_TOO_LARGE',
        `GIFT document exceeds ${MAX_GIFT_INPUT_CHARACTERS} characters`,
        1,
        null,
        'structural'
      )
    );
  } else if (blocks.length === 0) {
    findings.push(finding('GIFT_DOCUMENT_EMPTY', 'GIFT document contains no questions', 1, null, 'structural'));
  }

  for (const [index, block] of blocks.entries()) {
    if (index >= MAX_EXAM_IMPORT_QUESTIONS_PER_SECTION) {
      findings.push(
        finding(
          'GIFT_QUESTION_LIMIT_EXCEEDED',
          `GIFT document exceeds ${MAX_EXAM_IMPORT_QUESTIONS_PER_SECTION} questions`,
          block.startLine,
          null
        )
      );
      break;
    }

    const id = questionId(index);
    const parsed = parseQuestionBlock(block);
    if (!parsed) {
      questions.push(unresolvedQuestion(block, index, null, null));
      const hasAnswerBlock = findUnescaped(block.text, '{') >= 0 && findUnescaped(block.text, '}') >= 0;
      findings.push(
        finding(
          hasAnswerBlock ? 'GIFT_ANSWER_TYPE_UNSUPPORTED' : 'GIFT_SYNTAX_INVALID',
          hasAnswerBlock
            ? 'Only escaped multiple-choice answer blocks are supported'
            : 'GIFT question syntax is incomplete or malformed',
          block.startLine,
          id,
          hasAnswerBlock ? 'semantic' : 'structural'
        )
      );
      continue;
    }

    for (const line of [...new Set(parsed.unsupportedEscapeLines)]) {
      findings.push(
        finding(
          'GIFT_ESCAPE_UNSUPPORTED',
          'Only \\\\, \\~, \\=, \\#, \\{, \\}, and \\: escape sequences are supported',
          line,
          id,
          'structural'
        )
      );
    }

    const hasExplicitWeights = parsed.answers.some((answer) => answer.weight !== null);
    const titleUnsupported =
      parsed.title !== null && (parsed.title.length === 0 || parsed.title.length > MAX_GIFT_TITLE_LENGTH);
    const optionCountUnsupported = parsed.answers.length < 2 || parsed.answers.length > MAX_INTERACTION_OPTIONS;
    const correctCount = parsed.answers.filter(
      (answer) => (answer.weight ?? (answer.marker === '=' ? 100 : 0)) > 0
    ).length;
    const wrongCount = parsed.answers.length - correctCount;
    const answerTypeUnsupported = correctCount === 0 || (!hasExplicitWeights && wrongCount === 0);

    if (titleUnsupported) {
      findings.push(
        finding(
          'GIFT_TITLE_UNSUPPORTED',
          `Question titles must contain between 1 and ${MAX_GIFT_TITLE_LENGTH} characters`,
          block.startLine,
          id
        )
      );
    }
    if (optionCountUnsupported || answerTypeUnsupported) {
      findings.push(
        finding(
          'GIFT_ANSWER_TYPE_UNSUPPORTED',
          optionCountUnsupported
            ? `Multiple-choice questions require between 2 and ${MAX_INTERACTION_OPTIONS} answers`
            : 'Multiple-choice questions require at least one correct and one wrong answer',
          block.startLine,
          id
        )
      );
    }

    parsed.answers.forEach((answer, optionIndex) => {
      if (answer.feedback === null || answer.feedbackLine === null) return;
      feedback.push({
        kind: 'answer',
        questionId: id,
        optionId: optionId(index, optionIndex),
        html: paragraphHtml(answer.feedback),
        line: answer.feedbackLine
      });
    });
    if (parsed.generalFeedback !== null && parsed.generalFeedbackLine !== null) {
      feedback.push({
        kind: 'general',
        questionId: id,
        html: paragraphHtml(parsed.generalFeedback),
        line: parsed.generalFeedbackLine
      });
    }

    const unresolved =
      parsed.unsupportedEscapeLines.length > 0 || titleUnsupported || optionCountUnsupported || answerTypeUnsupported;
    if (unresolved) {
      questions.push(unresolvedQuestion(block, index, parsed.title, parsed.prompt));
      continue;
    }

    const question = choiceQuestion(block, parsed, index);
    questions.push(question);
    fieldStates.push(...choiceFieldStates(question));
  }

  const boundedFindings = boundExamImportDiagnostics(findings);
  const draft: ExamImportDraft = {
    schemaVersion: 1,
    source: {
      ...input.source,
      extractor: 'gift'
    },
    title: draftTitle(input.source.fileName),
    fieldStates,
    sharedContents: [],
    sections: [
      {
        id: 'gift-section-1',
        title: 'Imported questions',
        order: 0,
        questions
      }
    ],
    diagnostics: boundedFindings
  };

  return {
    draft,
    feedback,
    findings: boundedFindings
  };
}
