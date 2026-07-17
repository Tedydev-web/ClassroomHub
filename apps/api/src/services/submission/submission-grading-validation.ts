import { AppError, ErrorCodes } from '@api/utils/errors';

export type SubmissionGradingQuestion = {
  id: number;
  points: number;
};

export type StoredSubmissionAnswerScore = {
  questionId: number;
  score?: number | null;
  point?: number | null;
};

export type SubmissionGradeUpdate = {
  questionId: number;
  points: number;
};

type PrepareSubmissionGradesInput = {
  questions: readonly SubmissionGradingQuestion[];
  storedAnswers: readonly StoredSubmissionAnswerScore[];
  updates: readonly SubmissionGradeUpdate[];
  expectedTotal?: number;
  requireAllAnswers?: boolean;
};

export type PreparedSubmissionGrades = {
  answers: SubmissionGradeUpdate[];
  total: number;
};

const SCORE_SCALE = 100;
const SCORE_PRECISION_TOLERANCE = 1e-9;

function roundScore(value: number): number {
  return Math.round((value + Number.EPSILON) * SCORE_SCALE) / SCORE_SCALE;
}

function normalizeSubmittedScore(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new AppError(`${label} must be a finite non-negative number`, ErrorCodes.VALIDATION_ERROR, 400);
  }

  const normalized = roundScore(value);
  if (Math.abs(normalized - value) > SCORE_PRECISION_TOLERANCE) {
    throw new AppError(`${label} must have at most two decimal places`, ErrorCodes.VALIDATION_ERROR, 400);
  }

  return normalized;
}

function normalizeStoredScore(value: number | null | undefined, label: string): number {
  const score = value ?? 0;
  if (!Number.isFinite(score) || score < 0) {
    throw new AppError(`${label} contains an invalid stored score`, ErrorCodes.INTERNAL_ERROR, 500);
  }

  return roundScore(score);
}

export function prepareSubmissionGrades({
  questions,
  storedAnswers,
  updates,
  expectedTotal,
  requireAllAnswers = false
}: PrepareSubmissionGradesInput): PreparedSubmissionGrades {
  const questionById = new Map<number, SubmissionGradingQuestion>();
  for (const question of questions) {
    if (questionById.has(question.id)) {
      throw new AppError(`Question ${question.id} is defined more than once`, ErrorCodes.INTERNAL_ERROR, 500);
    }
    if (!Number.isFinite(question.points) || question.points < 0) {
      throw new AppError(`Question ${question.id} has an invalid maximum score`, ErrorCodes.INTERNAL_ERROR, 500);
    }

    questionById.set(question.id, question);
  }

  const scoreByQuestionId = new Map<number, number>();
  for (const answer of storedAnswers) {
    if (scoreByQuestionId.has(answer.questionId)) {
      throw new AppError(
        `Submission contains duplicate answers for question ${answer.questionId}`,
        ErrorCodes.INTERNAL_ERROR,
        500
      );
    }
    if (!questionById.has(answer.questionId)) {
      throw new AppError(
        `Submission answer references unknown question ${answer.questionId}`,
        ErrorCodes.INTERNAL_ERROR,
        500
      );
    }

    const storedScore = answer.score ?? answer.point;
    scoreByQuestionId.set(answer.questionId, normalizeStoredScore(storedScore, `Question ${answer.questionId}`));
  }

  const normalizedUpdates: SubmissionGradeUpdate[] = [];
  const updatedQuestionIds = new Set<number>();
  for (const update of updates) {
    if (updatedQuestionIds.has(update.questionId)) {
      throw new AppError(`Question ${update.questionId} was graded more than once`, ErrorCodes.VALIDATION_ERROR, 400);
    }

    const question = questionById.get(update.questionId);
    if (!question || !scoreByQuestionId.has(update.questionId)) {
      throw new AppError(
        `Question ${update.questionId} does not have an answer in this submission`,
        ErrorCodes.VALIDATION_ERROR,
        400
      );
    }

    const points = normalizeSubmittedScore(update.points, `Question ${update.questionId} score`);
    const maximumPoints = roundScore(question.points);
    if (points > maximumPoints) {
      throw new AppError(
        `Question ${update.questionId} score cannot exceed ${maximumPoints}`,
        ErrorCodes.VALIDATION_ERROR,
        400
      );
    }

    updatedQuestionIds.add(update.questionId);
    scoreByQuestionId.set(update.questionId, points);
    normalizedUpdates.push({ questionId: update.questionId, points });
  }

  if (requireAllAnswers && updatedQuestionIds.size !== scoreByQuestionId.size) {
    throw new AppError('Every submitted answer must be graded', ErrorCodes.VALIDATION_ERROR, 400);
  }

  const total = roundScore(Array.from(scoreByQuestionId.values()).reduce((sum, score) => sum + score, 0));
  if (expectedTotal !== undefined) {
    const normalizedExpectedTotal = normalizeSubmittedScore(expectedTotal, 'Submission total');
    if (normalizedExpectedTotal !== total) {
      throw new AppError('Submission total does not match the answer scores', ErrorCodes.VALIDATION_ERROR, 400);
    }
  }

  return { answers: normalizedUpdates, total };
}
