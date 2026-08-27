import { requiresExamImportAnswerKey, type ExamImportDraft, type ExamImportQuestion } from './exam-import-draft';
import {
  applyExamImportDraftPatches,
  type ExamImportAnswerKeyPatch,
  type ExamImportDraftPatchOperation
} from './exam-import-draft-patch';
import { parseExamImportBooleanAnswerValues } from './exam-import-segmentation';
import type { ExamImportSemanticValidationContext } from './exam-import-validation';

export const MAX_EXAM_IMPORT_COMPACT_ANSWER_KEY_LENGTH = 20_000;

export type ExamImportCompactAnswerKeyErrorCode =
  | 'ANSWER_KEY_COUNT_MISMATCH'
  | 'ANSWER_KEY_FORMAT_INVALID'
  | 'ANSWER_KEY_QUESTION_INVALID'
  | 'ANSWER_KEY_VALUE_INVALID';

export class ExamImportCompactAnswerKeyError extends Error {
  constructor(
    readonly code: ExamImportCompactAnswerKeyErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ExamImportCompactAnswerKeyError';
  }
}

export type ApplyExamImportCompactAnswerKeyResult = {
  draft: ExamImportDraft;
  appliedCount: number;
};

type NumberedAnswer = {
  questionNumber: number;
  value: string;
};

type KeyableQuestion = Extract<ExamImportQuestion, { kind: 'choice' | 'true_false_group' | 'numeric' }>;

function isKeyableQuestion(question: ExamImportQuestion): question is KeyableQuestion {
  return requiresExamImportAnswerKey(question);
}

function parseNumberedLines(lines: string[]): NumberedAnswer[] | null {
  const entries: NumberedAnswer[] = [];

  for (const line of lines) {
    const match = line.match(/^(\d+)\s*[.)-]?\s*(.+)$/u);
    if (!match) return null;

    entries.push({ questionNumber: Number(match[1]), value: match[2]!.trim() });
  }

  return entries;
}

function parseCompactPairs(value: string): NumberedAnswer[] | null {
  const pattern = /(?:^|[\s;])(\d+)\s*[.)-]?\s*([A-Za-zĐđ01]+)(?=[\s;]|$)/gu;
  const matches = [...value.matchAll(pattern)];
  if (matches.length === 0) return null;

  const residue = value.replace(pattern, '').replace(/[\s;]+/gu, '');
  if (residue.length > 0) return null;

  return matches.map((match) => ({
    questionNumber: Number(match[1]),
    value: match[2]!
  }));
}

function parseNumberedAnswers(value: string): NumberedAnswer[] | null {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length > 1) return parseNumberedLines(lines);

  return parseCompactPairs(value);
}

function choiceAnswer(question: Extract<KeyableQuestion, { kind: 'choice' }>, value: string): ExamImportAnswerKeyPatch {
  const labels = value
    .split(/[,/&|]+/u)
    .map((label) => label.trim().toLocaleUpperCase('en-US'))
    .filter((label) => label.length > 0);
  const correctOptionIds = labels.flatMap((label) => {
    const matches = question.options.filter((option) => option.sourceLabel.toLocaleUpperCase('en-US') === label);

    return matches.length === 1 ? [matches[0]!.id] : [];
  });
  if (
    labels.length === 0 ||
    correctOptionIds.length !== labels.length ||
    (question.cardinality === 'single' && correctOptionIds.length !== 1)
  ) {
    throw new ExamImportCompactAnswerKeyError(
      'ANSWER_KEY_VALUE_INVALID',
      `Answer value does not match question "${question.id}"`
    );
  }

  return { kind: 'choice', correctOptionIds };
}

function answerPatch(question: KeyableQuestion, value: string): ExamImportAnswerKeyPatch {
  switch (question.kind) {
    case 'choice':
      return choiceAnswer(question, value);
    case 'true_false_group': {
      const values = parseExamImportBooleanAnswerValues(value);
      if (values.length !== question.statements.length) {
        throw new ExamImportCompactAnswerKeyError(
          'ANSWER_KEY_VALUE_INVALID',
          `Answer value does not match question "${question.id}"`
        );
      }

      return {
        kind: 'true_false_group',
        answers: question.statements.map((statement, index) => ({
          statementId: statement.id,
          correctValue: values[index]!
        }))
      };
    }
    case 'numeric': {
      const numericValue = Number(value.replace(',', '.'));
      if (!Number.isFinite(numericValue)) {
        throw new ExamImportCompactAnswerKeyError(
          'ANSWER_KEY_VALUE_INVALID',
          `Answer value does not match question "${question.id}"`
        );
      }

      return { kind: 'numeric', value: numericValue, tolerance: null };
    }
  }
}

/**
 * Applies a key whose entries name the question they belong to.
 *
 * Key number `n` addresses the `n`-th question of the draft in reading order, not the
 * question whose `sourceNumber` reads `n`. The two agree on every paper measured so far,
 * and the draft's order is the paper's order, so the mapping is the paper's numbering in
 * practice. It is a positional contract all the same: a paper whose printed numbering
 * skips or restarts would key the wrong questions, and only the caller can see that.
 * A number past the end is caught below; a number that merely points somewhere else is not.
 */
function numberedOperations(
  questions: ExamImportQuestion[],
  answers: NumberedAnswer[]
): ExamImportDraftPatchOperation[] {
  const answersByNumber = new Map<number, string>();
  for (const answer of answers) {
    if (
      !Number.isSafeInteger(answer.questionNumber) ||
      answer.questionNumber < 1 ||
      answersByNumber.has(answer.questionNumber)
    ) {
      throw new ExamImportCompactAnswerKeyError(
        'ANSWER_KEY_FORMAT_INVALID',
        'Question numbers must be unique positive integers'
      );
    }
    answersByNumber.set(answer.questionNumber, answer.value);
  }

  const missingQuestions = questions
    .map((question, index) => ({ question, questionNumber: index + 1 }))
    .filter(
      (entry): entry is { question: KeyableQuestion; questionNumber: number } =>
        isKeyableQuestion(entry.question) && entry.question.answerKey === null
    );
  // Apply what the key does cover rather than refusing the whole of it. A teacher who
  // supplied thirty-nine of forty answers used to lose all thirty-nine and be told only
  // that the count disagreed. Publication stays blocked either way: every question left
  // without a key raises its own blocking finding during validation.
  const covered = missingQuestions.filter(({ questionNumber }) => answersByNumber.has(questionNumber));
  if (covered.length === 0) {
    // Applying nothing is not a malformed patch, but that is what the patch layer would
    // call it — an empty operation list fails its own schema. Say what actually happened,
    // in terms of the key the teacher supplied.
    throw new ExamImportCompactAnswerKeyError(
      'ANSWER_KEY_COUNT_MISMATCH',
      `Answer key covers none of the ${missingQuestions.length} questions still missing an answer`
    );
  }

  for (const questionNumber of answersByNumber.keys()) {
    const question = questions[questionNumber - 1];
    if (!question || !isKeyableQuestion(question)) {
      throw new ExamImportCompactAnswerKeyError(
        'ANSWER_KEY_QUESTION_INVALID',
        `Question ${questionNumber} cannot receive an answer key`
      );
    }
  }

  return covered.map(({ question, questionNumber }) => ({
    target: { kind: 'question_field', questionId: question.id, field: 'answerKey' },
    value: answerPatch(question, answersByNumber.get(questionNumber)!)
  }));
}

// Positional keys carry no question numbers, so a short one cannot be applied in part: every
// answer after the gap would land on the wrong question. The numbered path above may be
// partial precisely because its numbers say where each answer belongs. Keep them separate.
function orderedOperations(missingQuestions: KeyableQuestion[], values: string[]): ExamImportDraftPatchOperation[] {
  if (values.length !== missingQuestions.length) {
    throw new ExamImportCompactAnswerKeyError(
      'ANSWER_KEY_COUNT_MISMATCH',
      `Answer key has ${values.length} values for ${missingQuestions.length} questions with missing answers`
    );
  }

  return missingQuestions.map((question, index) => ({
    target: { kind: 'question_field', questionId: question.id, field: 'answerKey' },
    value: answerPatch(question, values[index]!)
  }));
}

export function applyExamImportCompactAnswerKey(
  draft: ExamImportDraft,
  key: string,
  context: ExamImportSemanticValidationContext
): ApplyExamImportCompactAnswerKeyResult {
  const normalized = key.normalize('NFC').trim();
  if (normalized.length === 0 || normalized.length > MAX_EXAM_IMPORT_COMPACT_ANSWER_KEY_LENGTH) {
    throw new ExamImportCompactAnswerKeyError(
      'ANSWER_KEY_FORMAT_INVALID',
      'Answer key must be non-empty and within the supported length'
    );
  }

  const questions = draft.sections.flatMap((section) => section.questions);
  const missingQuestions = questions.filter(
    (question): question is KeyableQuestion => isKeyableQuestion(question) && question.answerKey === null
  );
  if (missingQuestions.length === 0) return { draft: structuredClone(draft), appliedCount: 0 };

  const numberedAnswers = parseNumberedAnswers(normalized);
  const operations =
    numberedAnswers === null
      ? orderedOperations(
          missingQuestions,
          normalized
            .split(/\r?\n/u)
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
        )
      : numberedOperations(questions, numberedAnswers);

  return {
    draft: applyExamImportDraftPatches(draft, operations, context),
    appliedCount: operations.length
  };
}
