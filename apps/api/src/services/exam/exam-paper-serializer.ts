import { AppError, ErrorCodes } from '@api/utils/errors';
import {
  toAssessmentDeliveryDefinition,
  type AssessmentDeliveryDefinition,
  type AssessmentItemDefinition
} from '@cio/question-types';

/**
 * The paper as it was frozen when the exam opened, and the version of it that is safe
 * to hand somebody who is being scored.
 *
 * Two rules hold this together.
 *
 * The serializer reads the snapshot and nothing else. It never touches the live question
 * rows, because a container may be edited while an exam over it is being sat — several
 * exams may deliver the same container — and serving a live row would show a student a
 * question the server pins to a different revision, so their next save would be refused
 * as outside the paper, mid-exam.
 *
 * The answer key is removed at the source rather than filtered on the way out.
 * `toAssessmentDeliveryDefinition` already does this for every interaction kind the
 * assessment model knows, and is the same function that delivers items to signed-in
 * students. Reusing it means a future interaction kind is stripped here the day it is
 * stripped there, rather than the day somebody remembers this file exists.
 */

export type ExamPaperQuestionSnapshot = {
  questionId: number;
  questionRevisionId: string;
  order: number;
  points: number;
  /** The full authored definition, answer key included. Never served as-is. */
  definition: AssessmentItemDefinition;
};

export type ExamPaperSnapshot = {
  frozenAt: string;
  questions: ExamPaperQuestionSnapshot[];
};

export type ExamSittingQuestion = {
  questionId: number;
  questionRevisionId: string;
  order: number;
  points: number;
  definition: AssessmentDeliveryDefinition;
};

export type ExamSittingPaper = {
  frozenAt: string;
  questions: ExamSittingQuestion[];
};

/**
 * An exam that never froze its paper has no paper. Serving an empty one would look like
 * a paper with no questions, which a student would sit and submit blank.
 */
export function toExamSittingPaper(snapshot: ExamPaperSnapshot | null | undefined): ExamSittingPaper {
  if (!snapshot || !snapshot.frozenAt || snapshot.questions.length === 0) {
    throw new AppError('This exam has no frozen paper', ErrorCodes.VALIDATION_ERROR, 409);
  }

  return {
    frozenAt: snapshot.frozenAt,
    questions: snapshot.questions
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((question) => ({
        questionId: question.questionId,
        questionRevisionId: question.questionRevisionId,
        order: question.order,
        points: question.points,
        definition: toAssessmentDeliveryDefinition(question.definition)
      }))
  };
}

/** The ids a save is allowed to answer. Anything else is refused before it is stored. */
export function paperQuestionIds(snapshot: ExamPaperSnapshot): Set<number> {
  return new Set(snapshot.questions.map((question) => question.questionId));
}

/**
 * The revision a given question was delivered against. Assigned by the server from the
 * frozen paper and never accepted from the client: a sitter who chooses their own
 * revision chooses which answer key they are marked against.
 */
export function revisionForQuestion(snapshot: ExamPaperSnapshot, questionId: number): string | null {
  return snapshot.questions.find((question) => question.questionId === questionId)?.questionRevisionId ?? null;
}
