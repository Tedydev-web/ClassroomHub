/**
 * What a learner has answered, what it is worth, and what is required — for one exercise.
 *
 * These lived inside `view-mode.svelte`, where none of them touched component state but all
 * of them needed a browser to run. Pulling them out is behaviour-preserving by construction:
 * every function here is a pure function of its arguments.
 *
 * The two progress helpers used to read `$questionnaireMetaData` directly. They take the
 * answers as an argument instead, which is the only change of shape in the move — and the
 * reason this file can be tested without mounting anything.
 */

import {
  getExerciseQuestionContractKey,
  getAssessmentVerticalSliceResponseProgress,
  hasMeaningfulAnswerData,
  isAssessmentVerticalSliceResponseComplete,
  toApiPayload,
  type AnswerData,
  type ApiPayload,
  type AssessmentDeliveryDefinition,
  type AssessmentResponseEnvelope
} from '@cio/question-types';

import type { Question } from '$features/course/types';
import type { Exercise } from '$features/course/utils/types';
import type { CanonicalAssessmentReviewItem } from '$features/course/utils/submission-review-score-utils';
import { toExerciseQuestionModel } from './question-type-utils';

/** A canonical assessment item as the exercise payload carries it. */
export type CanonicalQuestion = NonNullable<Exercise['canonicalQuestions']>[number];

/** One thing a learner works through: a legacy question, or a canonical assessment item. */
export type TakeItem =
  | { kind: 'legacy'; id: string; question: Question }
  | {
      kind: 'canonical';
      id: string;
      question: CanonicalQuestion;
      definition: AssessmentDeliveryDefinition;
      feedback?: CanonicalAssessmentReviewItem['feedback'];
      revisionId: string | null;
    };

export interface QuestionProgress {
  answered: number;
  total: number;
}

/** The answers a take is holding, in the shape the questionnaire store keeps them. */
export interface TakeAnswers {
  answers: Record<string, AnswerData | undefined>;
  canonicalAnswers: Record<string, AssessmentResponseEnvelope | undefined>;
}

/**
 * Keep the previous answer unless the next one is a real answer envelope.
 *
 * Editors emit intermediate values while a learner is still typing or dragging, and letting
 * one of those overwrite a complete answer would lose work the learner already did.
 */
export function normalizeAnswerValue(
  previousValue: AnswerData | undefined,
  nextValue: AnswerData | undefined
): AnswerData | undefined {
  if (nextValue && typeof nextValue === 'object' && 'type' in nextValue) {
    return nextValue;
  }

  return previousValue;
}

export function mapAnswerToApiPayload(
  question: Question,
  answerData: AnswerData | null | undefined
): ApiPayload | null {
  const questionId = Number(question.id);
  if (Number.isNaN(questionId) || !answerData) return null;

  return toApiPayload(answerData, questionId);
}

export function hasMeaningfulCanonicalResponse(response: AssessmentResponseEnvelope | undefined): boolean {
  return (response?.responses.length ?? 0) > 0;
}

export function isCanonicalTakeItemAnswered(
  item: Extract<TakeItem, { kind: 'canonical' }>,
  response: AssessmentResponseEnvelope | undefined
): boolean {
  return (
    hasMeaningfulCanonicalResponse(response) && isAssessmentVerticalSliceResponseComplete(item.definition, response)
  );
}

/**
 * How much of one item is answered.
 *
 * A canonical item can hold several interactions, so it counts for more than one — which is
 * why progress is a pair rather than a boolean. A legacy question is always one of one.
 */
export function getTakeItemQuestionProgress(item: TakeItem, answers: TakeAnswers): QuestionProgress {
  if (item.kind === 'canonical') {
    return getAssessmentVerticalSliceResponseProgress(item.definition, answers.canonicalAnswers[item.id]);
  }

  const questionKey = getExerciseQuestionContractKey(toExerciseQuestionModel(item.question));

  return { answered: hasMeaningfulAnswerData(answers.answers[questionKey]) ? 1 : 0, total: 1 };
}

export function getExerciseQuestionProgress(items: TakeItem[], answers: TakeAnswers): QuestionProgress {
  return items.reduce<QuestionProgress>(
    (progress, item) => {
      const itemProgress = getTakeItemQuestionProgress(item, answers);

      return {
        answered: progress.answered + itemProgress.answered,
        total: progress.total + itemProgress.total
      };
    },
    { answered: 0, total: 0 }
  );
}

export function getTotalPossibleGrade(questions: Question[]): number {
  return questions.reduce((total, question) => total + Number(question.points ?? 0), 0);
}

export function getTakeItemPoints(item: TakeItem): number {
  if (item.kind === 'legacy') return getTotalPossibleGrade([item.question]);

  return item.definition.blocks.reduce((total, block) => {
    return block.kind === 'interaction' ? total + block.interaction.maxScore : total;
  }, 0);
}

export function getTakeItemTotalPossibleGrade(items: TakeItem[]): number {
  return items.reduce((total, item) => total + getTakeItemPoints(item), 0);
}

/** A legacy question is required unless it says otherwise — including when it is missing. */
export function isRequiredQuestion(question: Question | null | undefined): boolean {
  return !question || toExerciseQuestionModel(question).required !== false;
}

export function isRequiredTakeItem(item: TakeItem): boolean {
  if (item.kind === 'legacy') return isRequiredQuestion(item.question);

  return item.definition.blocks.some((block) => block.kind === 'interaction' && block.interaction.required);
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}
