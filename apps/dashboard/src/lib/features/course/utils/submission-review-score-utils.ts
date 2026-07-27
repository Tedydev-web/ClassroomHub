/**
 * Score summation for the student-facing submission review.
 *
 * A submission can carry answers to questions that were archived after the
 * attempt. The review UI only renders the current active question list, so the
 * score numerator must be restricted to that same rendered question-id set —
 * otherwise archived answers inflate the numerator past the displayed maximum
 * (e.g. 5/3). Surfacing the full attempted set (archived questions included)
 * requires the canonical assessment read API, which does not exist yet.
 */

import {
  assessmentResponseEnvelopeSchema,
  getItemMaxScore,
  type AssessmentDeliveryDefinition,
  type AssessmentResponseEnvelope,
  type ReleasedAssessmentFeedback
} from '@cio/question-types';

/** Minimal question shape shared by the exercise store and review components. */
export interface RenderedQuestionRef {
  id: string | number;
}

export interface CanonicalReviewQuestionRef extends RenderedQuestionRef {
  title?: string | null;
  order?: number | null;
  exerciseSectionId?: string | null;
  archivedAt?: string | null;
}

/** Minimal answer shape shared by submission list/review payloads. */
export interface ScoredSubmissionAnswer {
  questionId: number;
  score?: number | string | null;
  point?: number | string | null;
}

export interface CanonicalSubmissionAnswer extends ScoredSubmissionAnswer {
  answerData?: { type: string; response?: unknown } | null;
  assessmentDefinition?: AssessmentDeliveryDefinition | null;
  assessmentFeedback?: ReleasedAssessmentFeedback[] | null;
  attemptedQuestion?: CanonicalReviewQuestionRef | null;
}

export interface CanonicalAssessmentReviewItem {
  question: CanonicalReviewQuestionRef;
  definition: AssessmentDeliveryDefinition;
  response: AssessmentResponseEnvelope;
  feedback: ReleasedAssessmentFeedback[];
  score: number;
  maxScore: number;
}

/**
 * Sum per-answer scores restricted to the given (rendered) questions.
 * Fractional scores are preserved; answers whose question is not rendered
 * (archived or otherwise absent) are excluded so score never exceeds the
 * rendered maximum.
 */
export function sumAnswerScoresForRenderedQuestions(
  renderedQuestions: ReadonlyArray<RenderedQuestionRef>,
  answers: ReadonlyArray<ScoredSubmissionAnswer> | null | undefined
): number {
  const renderedQuestionIds = new Set<number>();
  for (const question of renderedQuestions) {
    const questionId = Number(question.id);
    if (Number.isFinite(questionId)) renderedQuestionIds.add(questionId);
  }

  return (answers ?? []).reduce((total, answer) => {
    if (!renderedQuestionIds.has(Number(answer.questionId))) return total;

    const answerScore = Number(answer.score ?? answer.point ?? 0);
    return total + (Number.isFinite(answerScore) ? answerScore : 0);
  }, 0);
}

/**
 * Resolve canonical review items from the immutable definition attached to
 * each attempted answer. Current author definitions are deliberately not an
 * input, so an edit after submission cannot alter historical review.
 */
export function getCanonicalAssessmentReviewItems(
  renderedQuestions: ReadonlyArray<CanonicalReviewQuestionRef>,
  answers: ReadonlyArray<CanonicalSubmissionAnswer> | null | undefined
): CanonicalAssessmentReviewItem[] {
  const renderedQuestionById = new Map(
    renderedQuestions
      .map((question) => [Number(question.id), question] as const)
      .filter(([questionId]) => Number.isFinite(questionId))
  );

  return (answers ?? []).flatMap((answer) => {
    if (answer.answerData?.type !== 'ASSESSMENT_ITEM' || !answer.assessmentDefinition) return [];

    const questionId = Number(answer.questionId);
    if (!Number.isFinite(questionId)) {
      throw new Error('Canonical assessment answer has an invalid question id');
    }

    const question = answer.attemptedQuestion ?? renderedQuestionById.get(questionId) ?? { id: questionId };

    const parsedResponse = assessmentResponseEnvelopeSchema.safeParse(answer.answerData?.response);
    if (!parsedResponse.success) {
      throw new Error(`Canonical assessment answer for question ${questionId} has an invalid response`);
    }

    const numericScore = Number(answer.score ?? answer.point ?? 0);
    if (!Number.isFinite(numericScore)) {
      throw new Error(`Canonical assessment answer for question ${questionId} has an invalid score`);
    }

    return [
      {
        question,
        definition: answer.assessmentDefinition,
        response: parsedResponse.data,
        feedback: answer.assessmentFeedback ?? [],
        score: numericScore,
        maxScore: getItemMaxScore(answer.assessmentDefinition)
      }
    ];
  });
}
