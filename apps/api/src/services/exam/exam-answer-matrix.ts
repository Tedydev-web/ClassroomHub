import type { ExamAnswerKeyQuestion } from './exam-answer-keys';
import { normaliseStamp } from './exam-clock';

/**
 * The class's answers laid out as one table: a column per question, a row per candidate.
 *
 * This is the shape a teacher actually goes through a paper in. Reading down a column says
 * which question the class fell for and what they fell for instead; reading across a row is
 * one candidate's paper. The results list cannot serve either — it deliberately carries no
 * answers, because four hundred sittings of them is not a page — so the table is built only
 * when somebody asks for it.
 *
 * Letters, not option ids. The teacher is holding the paper the class read, and on that
 * paper the answers are A, B, C and D; an option id is a detail of how this stores them.
 */

export type StoredMatrixAnswer = {
  questionId: number;
  answerData?: unknown;
};

export type MatrixAttempt = {
  attemptId: string;
  displayName: string | null;
  nickname: string | null;
  className: string | null;
  candidateNumber: string | null;
  score: string | null;
  total: string | null;
  /** When the paper opened and closed, and how often it stopped being the visible window. */
  startedAt: string | null;
  submittedAt: string | null;
  leaves: number;
  answers: StoredMatrixAnswer[];
};

export type AnswerMatrixQuestion = {
  position: number;
  /** The key as letters, joined where a question accepts more than one. Empty when unset. */
  key: string;
};

export type AnswerMatrixRow = {
  attemptId: string;
  displayName: string | null;
  nickname: string | null;
  className: string | null;
  candidateNumber: string | null;
  score: string | null;
  total: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  leaves: number;
  /** One entry per question, in paper order: the letters chosen, or `null` for a blank. */
  chosen: Array<string | null>;
  correct: number;
};

export type AnswerMatrix = {
  questions: AnswerMatrixQuestion[];
  rows: AnswerMatrixRow[];
};

/** The option letters a stored response selected, in the order the paper prints them. */
function chosenLetters(response: unknown, options: ExamAnswerKeyQuestion['options']): string | null {
  const selected = (response as { selectedOptionIds?: unknown } | null)?.selectedOptionIds;
  if (!Array.isArray(selected) || selected.length === 0) return null;

  const letters = options.filter((option) => selected.includes(option.id)).map((option) => option.label);

  // Selected something the paper no longer offers: a blank would say they answered nothing,
  // which is not what happened, so the raw value goes through rather than disappearing.
  if (letters.length === 0) return selected.filter((id): id is string => typeof id === 'string').join(', ');

  return letters.join(', ');
}

/** Every response in one stored answer, keyed by the interaction it belongs to. */
function responsesByInteraction(answerData: unknown): Map<string, unknown> {
  const responses = (answerData as { responses?: unknown } | null)?.responses;
  if (!Array.isArray(responses)) return new Map();

  const byInteraction = new Map<string, unknown>();

  for (const entry of responses) {
    const interactionId = (entry as { interactionId?: unknown })?.interactionId;
    if (typeof interactionId === 'string') byInteraction.set(interactionId, (entry as { response?: unknown }).response);
  }

  return byInteraction;
}

/**
 * Builds the table from the paper's questions and the sittings against it.
 *
 * The questions arrive already numbered the way the paper numbers them, which is the only
 * ordering this may use: aligning answers to anything else — an item's place in the list, a
 * position in the stored array — is how a column comes to be headed one question and filled
 * with another, and a marking sheet that is wrong is worse than none.
 */
export function buildAnswerMatrix(questions: ExamAnswerKeyQuestion[], attempts: MatrixAttempt[]): AnswerMatrix {
  const ordered = [...questions].sort((a, b) => a.position - b.position);

  return {
    questions: ordered.map((question) => ({
      position: question.position,
      key: question.options
        .filter((option) => question.effectiveKey.includes(option.id))
        .map((option) => option.label)
        .join(', ')
    })),
    rows: attempts.map((attempt) => {
      const byQuestionId = new Map<number, Map<string, unknown>>();
      for (const answer of attempt.answers ?? []) {
        byQuestionId.set(answer.questionId, responsesByInteraction(answer.answerData));
      }

      let correct = 0;
      const chosen = ordered.map((question) => {
        const response = byQuestionId.get(question.questionId)?.get(question.interactionId);
        const letters = chosenLetters(response, question.options);
        const key = keyLetters(question);

        // Counted here rather than trusted from the score, so the row's own numbers agree
        // with the letters printed beside them even where a hand mark moved the total.
        if (letters !== null && key !== '' && letters === key) correct += 1;

        return letters;
      });

      return {
        attemptId: attempt.attemptId,
        displayName: attempt.displayName,
        nickname: attempt.nickname,
        className: attempt.className,
        candidateNumber: attempt.candidateNumber,
        score: attempt.score,
        total: attempt.total,
        // Normalised here, once, so nothing downstream has to know what shape Postgres
        // returns — see `exam-clock`.
        startedAt: normaliseStamp(attempt.startedAt),
        submittedAt: normaliseStamp(attempt.submittedAt),
        leaves: attempt.leaves,
        chosen,
        correct
      };
    })
  };
}

/** The key of one question as letters, in paper order. */
function keyLetters(question: ExamAnswerKeyQuestion): string {
  return question.options
    .filter((option) => question.effectiveKey.includes(option.id))
    .map((option) => option.label)
    .join(', ');
}
