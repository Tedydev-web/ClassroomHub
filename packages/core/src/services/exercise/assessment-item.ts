import { AppError, ErrorCodes } from '@cio/utils/errors';
import { db, type DbOrTxClient } from '@cio/db/drizzle';
import {
  createQuestions,
  getAttemptedQuestionIds,
  getCurrentQuestionRevision,
  getExerciseById,
  getExerciseSectionsByExerciseId,
  getQuestionWithOptionsForRevision,
  getQuestionsByExerciseIds,
  hasExerciseSubmissions,
  lockExerciseAssignmentState,
  updateQuestion,
  updateQuestions
} from '@cio/db/queries/exercise';
import {
  getItemMaxScore,
  getUnsupportedAssessmentVerticalSliceInteractionKinds,
  QUESTION_TYPE_IDS,
  parseAssessmentItemDefinition,
  toAssessmentDeliveryDefinition
} from '@cio/question-types';
import type { AssessmentDeliveryDefinition, AssessmentItemDefinition } from '@cio/question-types';
import type { TAssessmentItemMutation } from '@cio/utils/validation/exercise';
import { publishQuestionRevision } from '../assessment/question-revision';

type AssessmentItemRead = {
  questionId: number;
  title: string;
  order: number | null;
  exerciseSectionId: string | null;
  revisionId: string;
  revision: number;
  definition: AssessmentItemDefinition;
};

type AssessmentItemAccessRead = Omit<AssessmentItemRead, 'definition'> & {
  definition: AssessmentDeliveryDefinition;
  authorDefinition: AssessmentItemDefinition | null;
};

function getAssessmentItemMaxScore(definition: AssessmentItemDefinition): number {
  return getItemMaxScore(definition);
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

async function assertAssessmentItemCreationAllowed(
  exerciseId: string,
  questionIds: number[],
  txClient: DbOrTxClient
): Promise<void> {
  const [hasSubmissions, attemptedQuestionIds] = await Promise.all([
    hasExerciseSubmissions(exerciseId, txClient),
    getAttemptedQuestionIds(questionIds, txClient)
  ]);
  if (!hasSubmissions && attemptedQuestionIds.length === 0) return;

  throw new AppError(
    'Assessment questions cannot be added after the exercise has been attempted',
    ErrorCodes.CONFLICT,
    409
  );
}

export type AssessmentItemMutationResult = {
  clientMutationId: string;
  questionId: number;
};

export async function applyAssessmentItemMutationsForExercise(
  courseId: string,
  exerciseId: string,
  mutations: TAssessmentItemMutation[],
  txClient: DbOrTxClient
): Promise<AssessmentItemMutationResult[]> {
  if (mutations.length === 0) return [];

  const clientMutationIds = new Set<string>();
  const publishedQuestionIds = new Set<number>();
  for (const mutation of mutations) {
    assertSupportedAssessmentInteractions(mutation.definition);
    if (clientMutationIds.has(mutation.clientMutationId)) {
      throw new AppError('Assessment item client mutation IDs must be unique', ErrorCodes.VALIDATION_ERROR, 400);
    }
    clientMutationIds.add(mutation.clientMutationId);

    if (mutation.action !== 'publish') continue;
    if (publishedQuestionIds.has(mutation.questionId)) {
      throw new AppError(
        'An assessment question can only be published once per save',
        ErrorCodes.VALIDATION_ERROR,
        400
      );
    }
    publishedQuestionIds.add(mutation.questionId);
  }

  const exercise = await getExerciseById(exerciseId, txClient);
  if (!exercise || exercise.courseId !== courseId) {
    throw new AppError('Exercise not found', ErrorCodes.EXERCISE_NOT_FOUND, 404);
  }

  const [questions, sections] = await Promise.all([
    getQuestionsByExerciseIds([exerciseId], txClient, { questionScope: 'active' }),
    getExerciseSectionsByExerciseId(exerciseId, txClient)
  ]);
  const canonicalQuestionsById = new Map(
    questions
      .filter(
        (question): question is typeof question & { id: number } =>
          question.id !== undefined && question.questionTypeId === QUESTION_TYPE_IDS.ASSESSMENT_ITEM
      )
      .map((question) => [question.id, question])
  );
  const sectionIds = new Set(sections.map((section) => section.id));
  const occupiedPlacementKeys = new Set(
    questions.map((question) => `${question.exerciseSectionId ?? 'unsectioned'}:${question.order ?? 0}`)
  );
  const hasCreateMutation = mutations.some((mutation) => mutation.action === 'create');
  if (hasCreateMutation) {
    const questionIds = questions
      .map((question) => question.id)
      .filter((questionId): questionId is number => questionId !== undefined);
    await assertAssessmentItemCreationAllowed(exerciseId, questionIds, txClient);
  }

  for (const mutation of mutations) {
    if (mutation.action === 'publish') {
      if (!canonicalQuestionsById.has(mutation.questionId)) {
        throw new AppError('Assessment question not found', ErrorCodes.NOT_FOUND, 404);
      }
      continue;
    }

    if (sections.length > 0 && mutation.exerciseSectionId === null) {
      throw new AppError(
        'Every assessment question must be assigned to an exercise section',
        ErrorCodes.VALIDATION_ERROR,
        400
      );
    }
    if (mutation.exerciseSectionId !== null && !sectionIds.has(mutation.exerciseSectionId)) {
      throw new AppError('Exercise section not found for assessment question', ErrorCodes.VALIDATION_ERROR, 400);
    }

    const placementKey = `${mutation.exerciseSectionId ?? 'unsectioned'}:${mutation.order}`;
    if (occupiedPlacementKeys.has(placementKey)) {
      throw new AppError(
        'Question orders must be unique within each exercise section',
        ErrorCodes.VALIDATION_ERROR,
        400
      );
    }
    occupiedPlacementKeys.add(placementKey);
  }

  const publishMutations = mutations.filter(
    (mutation): mutation is Extract<TAssessmentItemMutation, { action: 'publish' }> => mutation.action === 'publish'
  );
  for (const mutation of publishMutations) {
    await publishQuestionRevision(
      {
        questionId: mutation.questionId,
        expectedRevision: mutation.expectedRevision,
        definition: mutation.definition
      },
      txClient
    );
  }
  if (publishMutations.length > 0) {
    const titleUpdates = publishMutations.map((mutation) => ({
      id: mutation.questionId,
      data: { title: mutation.title }
    }));
    await updateQuestions(titleUpdates, exerciseId, txClient);
  }

  const createMutations = mutations.filter(
    (mutation): mutation is Extract<TAssessmentItemMutation, { action: 'create' }> => mutation.action === 'create'
  );
  const createdQuestions = await createQuestions(
    createMutations.map((mutation) => ({
      exerciseId,
      exerciseSectionId: mutation.exerciseSectionId,
      title: mutation.title,
      questionTypeId: QUESTION_TYPE_IDS.ASSESSMENT_ITEM,
      points: getAssessmentItemMaxScore(mutation.definition),
      order: mutation.order,
      settings: {}
    })),
    txClient
  );
  if (createdQuestions.length !== createMutations.length) {
    throw new AppError('Failed to create every assessment question', ErrorCodes.INTERNAL_ERROR, 500);
  }
  for (const [mutationIndex, mutation] of createMutations.entries()) {
    const question = createdQuestions[mutationIndex];
    if (!question) {
      throw new AppError('Failed to create assessment question', ErrorCodes.INTERNAL_ERROR, 500);
    }
    await publishQuestionRevision(
      { questionId: question.id, expectedRevision: 0, definition: mutation.definition },
      txClient
    );
  }

  const createdQuestionIdsByMutationId = new Map(
    createMutations.map((mutation, mutationIndex) => [mutation.clientMutationId, createdQuestions[mutationIndex]!.id])
  );
  return mutations.map((mutation) => ({
    clientMutationId: mutation.clientMutationId,
    questionId:
      mutation.action === 'publish'
        ? mutation.questionId
        : createdQuestionIdsByMutationId.get(mutation.clientMutationId)!
  }));
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

  return {
    questionId,
    title: question.title,
    order: question.order,
    exerciseSectionId: question.exerciseSectionId,
    revisionId: revision.id,
    revision: revision.revision,
    definition: parsedDefinition.data
  };
}

export async function createAssessmentItemForCourseService(
  courseId: string,
  exerciseId: string,
  title: string,
  definition: AssessmentItemDefinition,
  exerciseSectionId?: string | null
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
    const questionIds = questions
      .map((question) => question.id)
      .filter((questionId): questionId is number => questionId !== undefined);
    await assertAssessmentItemCreationAllowed(exerciseId, questionIds, txClient);
    const sections = await getExerciseSectionsByExerciseId(exerciseId, txClient);
    if (sections.length > 0 && exerciseSectionId === null) {
      throw new AppError(
        'Every assessment question must be assigned to an exercise section',
        ErrorCodes.VALIDATION_ERROR,
        400
      );
    }
    if (
      exerciseSectionId !== undefined &&
      exerciseSectionId !== null &&
      !sections.some((section) => section.id === exerciseSectionId)
    ) {
      throw new AppError('Exercise section not found for assessment question', ErrorCodes.VALIDATION_ERROR, 400);
    }

    const targetExerciseSectionId = exerciseSectionId === undefined ? (sections[0]?.id ?? null) : exerciseSectionId;
    const points = getAssessmentItemMaxScore(definition);
    const order =
      questions
        .filter((question) => (question.exerciseSectionId ?? null) === targetExerciseSectionId)
        .reduce((highestOrder, question) => Math.max(highestOrder, question.order ?? -1), -1) + 1;
    const [question] = await createQuestions(
      [
        {
          exerciseId,
          exerciseSectionId: targetExerciseSectionId,
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
): Promise<AssessmentItemAccessRead> {
  const item = await getAssessmentItemForCourse(courseId, exerciseId, questionId, db);

  return {
    ...item,
    definition: toAssessmentDeliveryDefinition(item.definition),
    authorDefinition: item.definition
  };
}

export async function publishAssessmentItemForCourseService(
  courseId: string,
  exerciseId: string,
  questionId: number,
  title: string,
  expectedRevision: number,
  definition: AssessmentItemDefinition
): Promise<AssessmentItemRead> {
  assertSupportedAssessmentInteractions(definition);

  return db.transaction(async (tx) => {
    const txClient = tx as DbOrTxClient;
    await getAssessmentItemForCourse(courseId, exerciseId, questionId, txClient);
    await publishQuestionRevision({ questionId, expectedRevision, definition }, txClient);
    const updatedQuestion = await updateQuestion(questionId, exerciseId, { title }, txClient);
    if (!updatedQuestion) {
      throw new AppError('Assessment question not found while updating its title', ErrorCodes.NOT_FOUND, 404);
    }

    return getAssessmentItemForCourse(courseId, exerciseId, questionId, txClient);
  });
}

export async function getAssessmentItemForLearnerService(
  courseId: string,
  exerciseId: string,
  questionId: number
): Promise<AssessmentItemAccessRead> {
  const item = await getAssessmentItemForCourse(courseId, exerciseId, questionId, db);

  return {
    ...item,
    definition: toAssessmentDeliveryDefinition(item.definition),
    authorDefinition: null
  };
}
