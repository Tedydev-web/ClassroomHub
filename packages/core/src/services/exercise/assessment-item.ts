import { AppError, ErrorCodes } from '@cio/utils/errors';
import { db, type DbOrTxClient } from '@cio/db/drizzle';
import {
  createQuestions,
  getCurrentQuestionRevision,
  getExerciseById,
  getExerciseSectionsByExerciseId,
  getQuestionWithOptionsForRevision,
  getQuestionsByExerciseIds,
  lockExerciseAssignmentState,
  updateQuestion
} from '@cio/db/queries/exercise';
import {
  getUnsupportedAssessmentVerticalSliceInteractionKinds,
  QUESTION_TYPE_IDS,
  parseAssessmentItemDefinition,
  toAssessmentDeliveryDefinition
} from '@cio/question-types';
import type { AssessmentItemDefinition } from '@cio/question-types';
import { publishQuestionRevision } from '../assessment/question-revision';

type AssessmentItemRead = {
  questionId: number;
  revision: number;
  definition: AssessmentItemDefinition;
};

function getAssessmentItemMaxScore(definition: AssessmentItemDefinition): number {
  return definition.blocks.reduce(
    (total, block) => total + (block.kind === 'interaction' ? block.interaction.maxScore : 0),
    0
  );
}

function assertSupportedAssessmentInteractions(definition: AssessmentItemDefinition): void {
  const unsupportedKinds = getUnsupportedAssessmentVerticalSliceInteractionKinds(definition);
  if (unsupportedKinds.length === 0) return;

  throw new AppError(
    `Unsupported assessment interactions: ${unsupportedKinds.join(', ')}`,
    ErrorCodes.VALIDATION_ERROR,
    400
  );
}

async function getAssessmentItemForCourse(
  courseId: string,
  exerciseId: string,
  questionId: number,
  dbClient: DbOrTxClient
): Promise<AssessmentItemRead> {
  const exercise = await getExerciseById(exerciseId, dbClient);
  if (!exercise || exercise.courseId !== courseId) {
    throw new AppError('Exercise not found', ErrorCodes.EXERCISE_NOT_FOUND, 404);
  }

  const question = await getQuestionWithOptionsForRevision(questionId, dbClient);
  if (
    !question ||
    question.exerciseId !== exerciseId ||
    question.questionTypeId !== QUESTION_TYPE_IDS.ASSESSMENT_ITEM
  ) {
    throw new AppError('Assessment question not found', ErrorCodes.NOT_FOUND, 404);
  }

  const revision = await getCurrentQuestionRevision(questionId, dbClient);
  if (!revision) {
    throw new AppError('Assessment question has no published revision', ErrorCodes.CONFLICT, 409);
  }

  const parsedDefinition = parseAssessmentItemDefinition(revision.definition);
  if (!parsedDefinition.success) {
    console.error(`getAssessmentItemForCourse: question "${questionId}" has an invalid current revision`);
    throw new AppError('Assessment question has an invalid current revision', ErrorCodes.INTERNAL_ERROR, 500);
  }

  return { questionId, revision: revision.revision, definition: parsedDefinition.data };
}

export async function createAssessmentItemForCourseService(
  courseId: string,
  exerciseId: string,
  title: string,
  definition: AssessmentItemDefinition
): Promise<AssessmentItemRead> {
  assertSupportedAssessmentInteractions(definition);

  return db.transaction(async (tx) => {
    const txClient = tx as DbOrTxClient;
    const exercise = await getExerciseById(exerciseId, txClient);
    if (!exercise || exercise.courseId !== courseId) {
      throw new AppError('Exercise not found', ErrorCodes.EXERCISE_NOT_FOUND, 404);
    }

    await lockExerciseAssignmentState(exerciseId, txClient);
    const questions = await getQuestionsByExerciseIds([exerciseId], txClient, { questionScope: 'active' });
    const sections = await getExerciseSectionsByExerciseId(exerciseId, txClient);
    const exerciseSectionId = sections[0]?.id ?? null;
    const points = getAssessmentItemMaxScore(definition);
    const order = questions.reduce((highestOrder, question) => Math.max(highestOrder, question.order ?? -1), -1) + 1;
    const [question] = await createQuestions(
      [
        {
          exerciseId,
          exerciseSectionId,
          title,
          questionTypeId: QUESTION_TYPE_IDS.ASSESSMENT_ITEM,
          points,
          order,
          settings: {}
        }
      ],
      txClient
    );
    if (!question) {
      throw new AppError('Failed to create assessment question', ErrorCodes.INTERNAL_ERROR, 500);
    }

    await publishQuestionRevision({ questionId: question.id, expectedRevision: 0, definition }, txClient);
    return getAssessmentItemForCourse(courseId, exerciseId, question.id, txClient);
  });
}

export async function getAssessmentItemForAuthorService(
  courseId: string,
  exerciseId: string,
  questionId: number
): Promise<AssessmentItemRead> {
  return getAssessmentItemForCourse(courseId, exerciseId, questionId, db);
}

export async function publishAssessmentItemForCourseService(
  courseId: string,
  exerciseId: string,
  questionId: number,
  expectedRevision: number,
  definition: AssessmentItemDefinition
): Promise<AssessmentItemRead> {
  assertSupportedAssessmentInteractions(definition);

  return db.transaction(async (tx) => {
    const txClient = tx as DbOrTxClient;
    await getAssessmentItemForCourse(courseId, exerciseId, questionId, txClient);
    await publishQuestionRevision({ questionId, expectedRevision, definition }, txClient);
    const points = getAssessmentItemMaxScore(definition);
    await updateQuestion(questionId, { points }, txClient);

    return getAssessmentItemForCourse(courseId, exerciseId, questionId, txClient);
  });
}

export async function getAssessmentItemForLearnerService(courseId: string, exerciseId: string, questionId: number) {
  const item = await getAssessmentItemForCourse(courseId, exerciseId, questionId, db);

  return {
    questionId: item.questionId,
    revision: item.revision,
    definition: toAssessmentDeliveryDefinition(item.definition)
  };
}
