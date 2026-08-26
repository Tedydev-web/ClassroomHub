import { AppError, ErrorCodes } from '@cio/utils/errors';
import { sanitizeHtml, sanitizeOptionalHtml, sanitizeUnknownStrings } from '../../utils/sanitize-html';
import type { TExercise, TExerciseTemplate, TNewOption, TNewQuestion } from '@cio/db/types';
import type { TAssessmentItemMutation, TExerciseCreate, TExerciseUpdate } from '@cio/utils/validation/exercise';
import { getLessonById } from '@cio/db/queries/lesson';
import {
  createExercises,
  syncOptionIdSequence,
  syncQuestionIdSequence,
  archiveQuestionsByIds,
  createOptions,
  createQuestions,
  deleteExercise,
  deleteOptionsByIds,
  deleteQuestionsByIds,
  getAttemptedQuestionIds,
  getExerciseById,
  hasExerciseSubmissions,
  getExerciseCompletionByProfile,
  getExerciseCompletionsByProfile,
  getExerciseSectionsByExerciseId,
  getExerciseWithRelationsOptimized,
  getExercisesByCourseId,
  getQuestionsByExerciseIds,
  getQuestionRevisionsByIds,
  getLMSExercises,
  lockExerciseAssignmentState,
  createExerciseSections,
  deleteExerciseSectionsByIds,
  updateExerciseSection,
  updateExercise,
  updateOptions,
  updateQuestions
} from '@cio/db/queries/exercise';
import {
  deriveItemCapabilities,
  parseAssessmentItemDefinition,
  toAssessmentDeliveryDefinition,
  type AssessmentDeliveryDefinition,
  type AssessmentGradingMode,
  type AssessmentItemDefinition
} from '@cio/question-types';
import { isCourseTeamMemberOrOrgAdmin } from '@cio/db/queries/group';
import { getCourseSectionById, touchCourseUpdatedAt } from '@cio/db/queries/course';
import { resolveItemSlug } from '../course/slug';
import { guardNonAutoGradableQuestionsForCourseType } from '../course/public-course-guard';
import { applyAssessmentItemMutationsForExercise, type AssessmentItemMutationResult } from './assessment-item';

import { db } from '@cio/db/drizzle';
import type { DbOrTxClient } from '@cio/db/drizzle';
import {
  INTERNAL_QUESTION_TYPE_IDS,
  buildExerciseUpdateFields,
  computeExerciseDiff,
  createNewQuestionsWithOptions,
  fetchQuestionsAndOptions,
  projectQuestionForLearner,
  transformQuestions,
  type LearnerQuestionWithRelations,
  type QuestionWithRelations
} from './utils';

type VisibleQuestionWithRelations = QuestionWithRelations | LearnerQuestionWithRelations;

type ExerciseWithQuestions<TQuestion extends VisibleQuestionWithRelations = QuestionWithRelations> = TExercise & {
  isComplete: boolean;
  questions?: TQuestion[];
  sections?: ExerciseSectionWithQuestions<TQuestion>[];
  canonicalQuestions?: Array<{
    id: number;
    title: string;
    points: number | null;
    order: number | null;
    exerciseSectionId: string | null;
    gradingMode: AssessmentGradingMode;
    revisionId: string;
    revision: number;
    definition: AssessmentDeliveryDefinition;
    authorDefinition: AssessmentItemDefinition | null;
  }>;
  assessmentItemMutationResults?: AssessmentItemMutationResult[];
};

export type ExerciseAuthoringLegacyQuestion = {
  kind: 'legacy_question';
  order: number;
  question: string;
  questionTypeId: number;
  points: number;
  settings: Record<string, unknown>;
  options: Array<{
    label: string;
    isCorrect: boolean;
    settings: Record<string, unknown>;
  }>;
};

export type ExerciseAuthoringAssessmentItem = {
  kind: 'assessment_item';
  clientMutationId: string;
  order: number;
  title: string;
  definition: AssessmentItemDefinition;
};

export type ExerciseAuthoringPlan = {
  exercise: Omit<TExerciseCreate, 'questions'>;
  sections: Array<{
    title: string;
    order: number;
    entries: Array<ExerciseAuthoringLegacyQuestion | ExerciseAuthoringAssessmentItem>;
  }>;
};

type ExerciseSectionWithQuestions<TQuestion extends VisibleQuestionWithRelations = QuestionWithRelations> = {
  id: string;
  title: string;
  description: string | null;
  order: number;
  colorTheme: string;
  afterBehavior: unknown;
  questions: TQuestion[];
};

type ExerciseWithCompletion = TExercise & {
  isComplete: boolean;
};

async function assertExerciseQuestionGraphMutable(exerciseId: string, txClient: DbOrTxClient): Promise<void> {
  const hasSubmissions = await hasExerciseSubmissions(exerciseId, txClient);
  if (hasSubmissions) {
    throw new AppError(
      'Exercise questions cannot be changed after a submission has been created',
      ErrorCodes.CONFLICT,
      409
    );
  }

  // Legacy answer rows can reference questions without any surviving submission
  // (pre-submission-model data, or a deleted submission whose linked answers were
  // created directly). Those attempts freeze replace/delete exactly like a
  // submission does — the question_answer FK would reject the question delete
  // mid-transaction anyway, so surface a deliberate conflict instead of a 500.
  const questions = await getQuestionsByExerciseIds([exerciseId], txClient);
  const questionIds = questions.map((question) => question.id).filter((id): id is number => id !== undefined);
  const attemptedQuestionIds = await getAttemptedQuestionIds(questionIds, txClient);
  if (attemptedQuestionIds.length === 0) return;

  throw new AppError('Exercise questions cannot be changed after they have been attempted', ErrorCodes.CONFLICT, 409);
}

/**
 * After a submission exists, the only allowed question-graph mutation in the ordinary
 * update path is question removal: attempted questions are archived, not destroyed.
 * Creates, edits, and option changes stay frozen until the editor publishes revisions.
 */
function assertQuestionGraphChangesAreRemovalOnly(diff: ReturnType<typeof computeExerciseDiff>): void {
  const hasNonRemovalChanges =
    diff.questions.newQuestions.length > 0 ||
    diff.questions.updates.length > 0 ||
    diff.options.deletedIds.length > 0 ||
    diff.options.updates.length > 0 ||
    diff.options.creates.length > 0;

  if (!hasNonRemovalChanges) return;

  throw new AppError(
    'Exercise questions cannot be changed after a submission has been created; only question removal is allowed',
    ErrorCodes.CONFLICT,
    409
  );
}

/**
 * Archived questions are frozen history: a stale editor payload may still reference
 * them, but applying such a row as an update would mutate the legacy fields that
 * pre-revision answers render from, and treating it as new would resurrect it as a
 * duplicate. Only re-deletion is accepted (idempotent re-archive).
 */
function assertPayloadDoesNotEditArchivedQuestions(
  incomingQuestions: NonNullable<TExerciseUpdate['questions']>,
  archivedQuestionIds: ReadonlySet<number>
): void {
  const editedArchivedQuestion = incomingQuestions.find(
    (question) => question.id !== undefined && !question.deletedAt && archivedQuestionIds.has(question.id)
  );

  if (!editedArchivedQuestion) return;

  throw new AppError(
    'Archived questions cannot be edited or restored; remove them from the payload',
    ErrorCodes.CONFLICT,
    409
  );
}

function sanitizeExerciseQuestions(questions: TExerciseCreate['questions'] | TExerciseUpdate['questions']) {
  return questions?.map((question) => ({
    ...question,
    question: sanitizeHtml(question.question),
    settings: question.settings ? sanitizeUnknownStrings(question.settings) : question.settings,
    options: question.options?.map((option) => ({
      ...option,
      label: sanitizeHtml(option.label),
      settings: option.settings ? sanitizeUnknownStrings(option.settings) : option.settings
    }))
  }));
}

function sanitizeExercisePayload(data: TExerciseCreate): TExerciseCreate;
function sanitizeExercisePayload(data: TExerciseUpdate): TExerciseUpdate;
function sanitizeExercisePayload(data: TExerciseCreate | TExerciseUpdate): TExerciseCreate | TExerciseUpdate {
  return {
    ...data,
    description: sanitizeOptionalHtml(data.description),
    sections:
      'sections' in data
        ? data.sections?.map((section) => ({
            ...section,
            title: sanitizeHtml(section.title),
            description: sanitizeOptionalHtml(section.description ?? undefined)
          }))
        : undefined,
    questions: sanitizeExerciseQuestions(data.questions)
  };
}

function groupQuestionsBySections<TQuestion extends VisibleQuestionWithRelations>(
  sections: Awaited<ReturnType<typeof getExerciseSectionsByExerciseId>>,
  questions: TQuestion[]
) {
  const questionsBySectionId = new Map<string, TQuestion[]>();
  const unsectionedQuestions: TQuestion[] = [];

  for (const question of questions) {
    if (question.exerciseSectionId) {
      const sectionQuestions = questionsBySectionId.get(question.exerciseSectionId) ?? [];
      sectionQuestions.push(question);
      questionsBySectionId.set(question.exerciseSectionId, sectionQuestions);
      continue;
    }

    unsectionedQuestions.push(question);
  }

  return {
    sections: sections.map((section) => ({
      id: section.id,
      title: section.title,
      description: section.description,
      order: section.order,
      colorTheme: section.colorTheme,
      afterBehavior: section.afterBehavior,
      questions: questionsBySectionId.get(section.id) ?? []
    })),
    unsectionedQuestions
  };
}

async function syncExerciseSections(
  exerciseId: string,
  sections: NonNullable<TExerciseUpdate['sections']>,
  canonicalQuestionPlacements: TExerciseUpdate['canonicalQuestionPlacements'],
  txClient: DbOrTxClient
) {
  const currentSections = await getExerciseSectionsByExerciseId(exerciseId, txClient);
  const currentSectionIds = new Set(currentSections.map((section) => section.id));
  const incomingSectionIds = new Set(sections.map((section) => section.id).filter((id): id is string => !!id));

  for (const section of sections) {
    if (section.afterBehavior.action !== 'go_to_section') continue;
    if (!incomingSectionIds.has(section.afterBehavior.exerciseSectionId)) {
      throw new AppError('Section routing target must exist in this exercise', ErrorCodes.VALIDATION_ERROR, 400);
    }
  }

  const sectionsToDelete = currentSections
    .filter((section) => !incomingSectionIds.has(section.id))
    .map((section) => section.id);

  if (sectionsToDelete.length > 0) {
    const questions = await getQuestionsByExerciseIds([exerciseId], txClient, { questionScope: 'active' });
    const deletedSectionIdSet = new Set(sectionsToDelete);
    const canonicalQuestionIdsInDeletedSections = questions
      .filter(
        (question): question is typeof question & { id: number } =>
          question.id !== undefined &&
          INTERNAL_QUESTION_TYPE_IDS.has(question.questionTypeId) &&
          typeof question.exerciseSectionId === 'string' &&
          deletedSectionIdSet.has(question.exerciseSectionId)
      )
      .map((question) => question.id);
    if (canonicalQuestionIdsInDeletedSections.length > 0 && canonicalQuestionPlacements === undefined) {
      throw new AppError(
        'Canonical question placements are required when deleting a section that contains assessment questions',
        ErrorCodes.VALIDATION_ERROR,
        400
      );
    }
    const attemptedCanonicalQuestionIds = await getAttemptedQuestionIds(
      canonicalQuestionIdsInDeletedSections,
      txClient
    );
    if (attemptedCanonicalQuestionIds.length > 0) {
      throw new AppError(
        'A section containing an attempted assessment question cannot be deleted',
        ErrorCodes.CONFLICT,
        409
      );
    }

    await deleteExerciseSectionsByIds(sectionsToDelete, txClient);
  }

  const sectionsToCreate = sections
    .filter((section) => !section.id || !currentSectionIds.has(section.id))
    .map((section) => ({
      id: section.id,
      exerciseId,
      title: section.title,
      description: section.description ?? null,
      order: section.order,
      colorTheme: section.colorTheme,
      afterBehavior: section.afterBehavior
    }));

  if (sectionsToCreate.length > 0) {
    await createExerciseSections(sectionsToCreate, txClient);
  }

  await Promise.all(
    sections
      .filter((section) => section.id && currentSectionIds.has(section.id))
      .map((section) =>
        updateExerciseSection(
          section.id!,
          {
            title: section.title,
            description: section.description ?? null,
            order: section.order,
            colorTheme: section.colorTheme,
            afterBehavior: section.afterBehavior
          },
          txClient
        )
      )
  );
}

function validateSectionQuestionAssignments(data: TExerciseUpdate) {
  if (!data.sections || data.sections.length === 0 || !data.questions) return;

  const sectionIds = new Set(data.sections.map((section) => section.id).filter((id): id is string => !!id));
  const unassignedQuestion = data.questions.find(
    (question) => !question.deletedAt && (!question.exerciseSectionId || !sectionIds.has(question.exerciseSectionId))
  );

  if (unassignedQuestion) {
    throw new AppError(
      'All active questions must be assigned to an exercise section',
      ErrorCodes.VALIDATION_ERROR,
      400
    );
  }
}

async function syncCanonicalQuestionPlacements(
  exerciseId: string,
  placements: NonNullable<TExerciseUpdate['canonicalQuestionPlacements']>,
  incomingLegacyQuestions: TExerciseUpdate['questions'],
  txClient: DbOrTxClient
): Promise<void> {
  const [questions, sections] = await Promise.all([
    getQuestionsByExerciseIds([exerciseId], txClient, { questionScope: 'active' }),
    getExerciseSectionsByExerciseId(exerciseId, txClient)
  ]);
  const canonicalQuestions = questions.filter(
    (question): question is typeof question & { id: number } =>
      question.id !== undefined && INTERNAL_QUESTION_TYPE_IDS.has(question.questionTypeId)
  );
  const canonicalQuestionById = new Map(canonicalQuestions.map((question) => [question.id, question]));
  const placementByQuestionId = new Map(placements.map((placement) => [placement.id, placement]));

  if (
    placementByQuestionId.size !== placements.length ||
    canonicalQuestionById.size !== placementByQuestionId.size ||
    canonicalQuestions.some((question) => !placementByQuestionId.has(question.id))
  ) {
    throw new AppError(
      'Canonical question placements must contain every active assessment question exactly once',
      ErrorCodes.VALIDATION_ERROR,
      400
    );
  }

  const sectionIds = new Set(sections.map((section) => section.id));
  const legacyQuestionsById = new Map(
    questions
      .filter(
        (question): question is typeof question & { id: number } =>
          question.id !== undefined && !INTERNAL_QUESTION_TYPE_IDS.has(question.questionTypeId)
      )
      .map((question) => [question.id, question])
  );
  const finalLegacyPlacements = new Map<number | string, { exerciseSectionId: string | null; order: number }>(
    [...legacyQuestionsById.values()].map((question) => [
      question.id,
      {
        exerciseSectionId: question.exerciseSectionId ?? null,
        order: question.order ?? 0
      }
    ])
  );
  for (const incomingQuestion of incomingLegacyQuestions ?? []) {
    if (incomingQuestion.id !== undefined) {
      const currentQuestion = legacyQuestionsById.get(incomingQuestion.id);
      if (!currentQuestion) continue;
      if (incomingQuestion.deletedAt) {
        finalLegacyPlacements.delete(incomingQuestion.id);
        continue;
      }

      finalLegacyPlacements.set(incomingQuestion.id, {
        exerciseSectionId: incomingQuestion.exerciseSectionId ?? currentQuestion.exerciseSectionId ?? null,
        order: incomingQuestion.order ?? currentQuestion.order ?? 0
      });
      continue;
    }

    if (incomingQuestion.deletedAt) continue;
    finalLegacyPlacements.set(`new-${finalLegacyPlacements.size}`, {
      exerciseSectionId: incomingQuestion.exerciseSectionId ?? null,
      order: incomingQuestion.order ?? 0
    });
  }
  const legacyPlacementKeys = new Set(
    [...finalLegacyPlacements.values()].map(
      (placement) => `${placement.exerciseSectionId ?? 'unsectioned'}:${placement.order}`
    )
  );
  const canonicalPlacementKeys = new Set<string>();

  for (const placement of placements) {
    if (sections.length > 0 && placement.exerciseSectionId === null) {
      throw new AppError(
        'Every assessment question must be assigned to an exercise section',
        ErrorCodes.VALIDATION_ERROR,
        400
      );
    }
    if (placement.exerciseSectionId !== null && !sectionIds.has(placement.exerciseSectionId)) {
      throw new AppError('Assessment question section must exist in this exercise', ErrorCodes.VALIDATION_ERROR, 400);
    }

    const placementKey = `${placement.exerciseSectionId ?? 'unsectioned'}:${placement.order}`;
    if (canonicalPlacementKeys.has(placementKey) || legacyPlacementKeys.has(placementKey)) {
      throw new AppError(
        'Question orders must be unique within each exercise section',
        ErrorCodes.VALIDATION_ERROR,
        400
      );
    }
    canonicalPlacementKeys.add(placementKey);
  }

  const changedPlacements = placements.filter((placement) => {
    const currentQuestion = canonicalQuestionById.get(placement.id);
    return (
      currentQuestion !== undefined &&
      ((currentQuestion.exerciseSectionId ?? null) !== placement.exerciseSectionId ||
        (currentQuestion.order ?? 0) !== placement.order)
    );
  });
  if (changedPlacements.length === 0) return;

  const attemptedQuestionIds = new Set(
    await getAttemptedQuestionIds(
      changedPlacements.map((placement) => placement.id),
      txClient
    )
  );
  if (attemptedQuestionIds.size > 0) {
    throw new AppError(
      'Assessment question placement cannot be changed after the question has been attempted',
      ErrorCodes.CONFLICT,
      409
    );
  }

  const placementUpdates = changedPlacements.map((placement) => ({
    id: placement.id,
    data: {
      exerciseSectionId: placement.exerciseSectionId,
      order: placement.order
    }
  }));
  await updateQuestions(placementUpdates, exerciseId, txClient);
}

async function resolveExerciseCourseId(exercise: TExercise): Promise<string | null> {
  if (exercise.courseId) {
    return exercise.courseId;
  }

  if (!exercise.lessonId) {
    return null;
  }

  const lesson = await getLessonById(exercise.lessonId);

  return lesson?.courseId ?? null;
}

async function assertExercisePlacementBelongsToCourse(
  courseId: string,
  placement: { lessonId?: string; sectionId?: string }
): Promise<void> {
  const lessonPromise = placement.lessonId ? getLessonById(placement.lessonId) : Promise.resolve(null);
  const sectionPromise = placement.sectionId ? getCourseSectionById(placement.sectionId) : Promise.resolve(null);
  const [lesson, section] = await Promise.all([lessonPromise, sectionPromise]);

  if (placement.lessonId && (!lesson || lesson.courseId !== courseId)) {
    throw new AppError('Lesson does not belong to this course', ErrorCodes.NOT_FOUND, 404);
  }
  if (placement.sectionId && (!section || section.courseId !== courseId)) {
    throw new AppError('Section does not belong to this course', ErrorCodes.NOT_FOUND, 404);
  }
}

/**
 * Creates a new exercise with optional questions and options
 * @param data Exercise creation data
 * @returns Created exercise
 */
async function createExerciseWithClient(data: TExerciseCreate, txClient: DbOrTxClient): Promise<TExercise> {
  const sanitizedData = sanitizeExercisePayload(data);
  const questions = sanitizedData.questions ?? [];

  await guardNonAutoGradableQuestionsForCourseType({
    courseId: sanitizedData.courseId,
    questionTypeIds: questions.map((question) => question.questionTypeId),
    dbClient: txClient
  });

  const slug = await resolveItemSlug({
    courseId: sanitizedData.courseId,
    title: sanitizedData.title,
    requestedSlug: sanitizedData.slug,
    dbClient: txClient
  });

  const exerciseData = {
    title: sanitizedData.title,
    description: sanitizedData.description ?? null,
    lessonId: sanitizedData.lessonId || null,
    courseId: sanitizedData.courseId,
    sectionId: sanitizedData.sectionId || null,
    order: sanitizedData.order ?? null,
    dueBy: sanitizedData.dueBy || null,
    slug
  };

  const [exercise] = await createExercises([exerciseData], txClient);
  if (!exercise) {
    throw new AppError('Failed to create exercise', ErrorCodes.INTERNAL_ERROR, 500);
  }

  // Create questions and options if provided
  if (questions.length > 0) {
    await syncQuestionIdSequence(txClient);
    const hasOptions = questions.some((question) => (question.options?.length ?? 0) > 0);
    if (hasOptions) {
      await syncOptionIdSequence(txClient);
    }

    await createNewQuestionsWithOptions(exercise.id, questions, txClient);
  }

  // Fetch the complete exercise with questions and options
  const result = await getExercise(exercise.id, txClient);
  await touchCourseUpdatedAt(sanitizedData.courseId, txClient);

  return result;
}

export async function createExercise(data: TExerciseCreate, dbClient?: DbOrTxClient): Promise<TExercise> {
  try {
    if (dbClient) {
      return await createExerciseWithClient(data, dbClient);
    }

    return await db.transaction(async (tx) => {
      const txClient = tx as DbOrTxClient;
      return createExerciseWithClient(data, txClient);
    });
  } catch (error) {
    console.error('createExercise error:', error);
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      error instanceof Error ? error.message : 'Failed to create exercise',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

export async function createExerciseForCourseService(courseId: string, data: TExerciseCreate): Promise<TExercise> {
  if (data.courseId !== courseId) {
    throw new AppError('Course ID does not match the route', ErrorCodes.VALIDATION_ERROR, 400);
  }

  await assertExercisePlacementBelongsToCourse(courseId, data);

  return createExercise({ ...data, courseId });
}

async function createExerciseFromAuthoringPlanWithClient(
  plan: ExerciseAuthoringPlan,
  txClient: DbOrTxClient
): Promise<ExerciseWithQuestions> {
  const sectionOrders = new Set<number>();
  for (const section of plan.sections) {
    if (sectionOrders.has(section.order)) {
      throw new AppError('Exercise section orders must be unique', ErrorCodes.VALIDATION_ERROR, 400);
    }
    sectionOrders.add(section.order);

    const entryOrders = new Set<number>();
    for (const entry of section.entries) {
      if (entryOrders.has(entry.order)) {
        throw new AppError(
          'Question orders must be unique within each exercise section',
          ErrorCodes.VALIDATION_ERROR,
          400
        );
      }
      entryOrders.add(entry.order);
    }
  }

  const legacyQuestionTypeIds = plan.sections.flatMap((section) =>
    section.entries
      .filter((entry): entry is ExerciseAuthoringLegacyQuestion => entry.kind === 'legacy_question')
      .map((entry) => entry.questionTypeId)
  );
  const assessmentDefinitions = plan.sections.flatMap((section) =>
    section.entries
      .filter((entry): entry is ExerciseAuthoringAssessmentItem => entry.kind === 'assessment_item')
      .map((entry) => entry.definition)
  );
  await guardNonAutoGradableQuestionsForCourseType({
    courseId: plan.exercise.courseId,
    questionTypeIds: legacyQuestionTypeIds,
    assessmentDefinitions,
    dbClient: txClient
  });

  const exercise = await createExercise({ ...plan.exercise, questions: [] }, txClient);
  const createdSections = await createExerciseSections(
    plan.sections.map((section) => ({
      exerciseId: exercise.id,
      title: sanitizeHtml(section.title),
      order: section.order
    })),
    txClient
  );
  if (createdSections.length !== plan.sections.length) {
    throw new AppError('Failed to create every exercise section', ErrorCodes.INTERNAL_ERROR, 500);
  }

  const sectionIdsByOrder = new Map(createdSections.map((section) => [section.order, section.id]));
  const legacyQuestions: NonNullable<TExerciseUpdate['questions']> = [];
  const assessmentItemMutations: TAssessmentItemMutation[] = [];
  for (const section of plan.sections) {
    const exerciseSectionId = sectionIdsByOrder.get(section.order);
    if (!exerciseSectionId) {
      throw new AppError('Created exercise section could not be resolved', ErrorCodes.INTERNAL_ERROR, 500);
    }

    for (const entry of section.entries) {
      if (entry.kind === 'legacy_question') {
        legacyQuestions.push({
          exerciseSectionId,
          question: entry.question,
          questionTypeId: entry.questionTypeId,
          points: entry.points,
          order: entry.order,
          settings: entry.settings,
          options: entry.options
        });
        continue;
      }

      assessmentItemMutations.push({
        action: 'create',
        clientMutationId: entry.clientMutationId,
        title: entry.title,
        definition: entry.definition,
        exerciseSectionId,
        order: entry.order
      });
    }
  }

  if (legacyQuestions.length > 0 || assessmentItemMutations.length > 0) {
    await syncQuestionIdSequence(txClient);
  }
  if (legacyQuestions.some((question) => (question.options?.length ?? 0) > 0)) {
    await syncOptionIdSequence(txClient);
  }

  if (legacyQuestions.length > 0) {
    const updatePayload: TExerciseUpdate = { questions: legacyQuestions };
    const sanitizedQuestions = sanitizeExercisePayload(updatePayload).questions;
    if (!sanitizedQuestions) {
      throw new AppError('Failed to sanitize exercise questions', ErrorCodes.INTERNAL_ERROR, 500);
    }
    await createNewQuestionsWithOptions(exercise.id, sanitizedQuestions, txClient);
  }

  if (assessmentItemMutations.length > 0) {
    await applyAssessmentItemMutationsForExercise(
      plan.exercise.courseId,
      exercise.id,
      assessmentItemMutations,
      txClient
    );
  }

  await touchCourseUpdatedAt(plan.exercise.courseId, txClient);
  return getExercise(exercise.id, txClient);
}

export async function createExerciseFromAuthoringPlan(
  plan: ExerciseAuthoringPlan,
  dbClient?: DbOrTxClient
): Promise<ExerciseWithQuestions> {
  try {
    if (dbClient) {
      return await createExerciseFromAuthoringPlanWithClient(plan, dbClient);
    }

    return await db.transaction(async (tx) => {
      const txClient = tx as DbOrTxClient;
      return createExerciseFromAuthoringPlanWithClient(plan, txClient);
    });
  } catch (error) {
    console.error('createExerciseFromAuthoringPlan error:', error);
    if (error instanceof AppError) throw error;

    throw new AppError(
      error instanceof Error ? error.message : 'Failed to create authored exercise',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

/**
 * Gets an exercise by ID with questions and options
 * @param exerciseId Exercise ID
 * @returns Exercise with questions and options
 */
export function getExercise(
  exerciseId: string,
  dbClient?: DbOrTxClient,
  profileId?: undefined
): Promise<ExerciseWithQuestions>;
export function getExercise(
  exerciseId: string,
  dbClient: DbOrTxClient | undefined,
  profileId: string
): Promise<ExerciseWithQuestions<VisibleQuestionWithRelations>>;
export async function getExercise(
  exerciseId: string,
  dbClient?: DbOrTxClient,
  profileId?: string
): Promise<ExerciseWithQuestions<VisibleQuestionWithRelations>> {
  try {
    // Optimized: Fetch exercise + questions + questionTypes + options in one JOIN query.
    // This is the editor/current-exercise read: archived questions are excluded at the
    // query level, and internal composite rows (definition lives in revisions) must
    // never reach raw editor/delivery payloads until a canonical renderer exists.
    const { exercise, questions: activeQuestions } = await getExerciseWithRelationsOptimized(exerciseId, dbClient, {
      questionScope: 'active'
    });
    const questions = activeQuestions.filter((question) => !INTERNAL_QUESTION_TYPE_IDS.has(question.questionTypeId));
    const canonicalQuestionRows = activeQuestions
      .filter(
        (question): question is typeof question & { id: number } =>
          INTERNAL_QUESTION_TYPE_IDS.has(question.questionTypeId) && question.id !== undefined
      )
      .map((question) => {
        if (question.currentRevisionId) {
          return { question, currentRevisionId: question.currentRevisionId };
        }

        throw new AppError(
          `Canonical question "${question.id}" has no current revision`,
          ErrorCodes.EXERCISE_FETCH_FAILED,
          500
        );
      });
    const currentRevisionIds = [...new Set(canonicalQuestionRows.map(({ currentRevisionId }) => currentRevisionId))];
    const revisionRows =
      currentRevisionIds.length === 0
        ? []
        : dbClient
          ? await getQuestionRevisionsByIds(currentRevisionIds, dbClient)
          : await getQuestionRevisionsByIds(currentRevisionIds);
    const revisionsById = new Map(revisionRows.map((revision) => [revision.id, revision]));
    const canViewAuthorDefinitions =
      profileId !== undefined && exercise.courseId !== null
        ? await isCourseTeamMemberOrOrgAdmin(exercise.courseId, profileId)
        : false;
    const canonicalQuestions = canonicalQuestionRows.map(({ question, currentRevisionId }) => {
      const revision = revisionsById.get(currentRevisionId);
      if (!revision) {
        throw new AppError(
          `Canonical question "${question.id}" current revision was not found`,
          ErrorCodes.EXERCISE_FETCH_FAILED,
          500
        );
      }

      const parsedDefinition = parseAssessmentItemDefinition(revision.definition);
      if (!parsedDefinition.success) {
        console.error(`Canonical question "${question.id}" current revision is invalid:`, parsedDefinition.issues);
        throw new AppError(
          `Canonical question "${question.id}" current revision is invalid`,
          ErrorCodes.EXERCISE_FETCH_FAILED,
          500
        );
      }

      const gradingMode = deriveItemCapabilities(parsedDefinition.data).gradingMode;
      const definition = toAssessmentDeliveryDefinition(parsedDefinition.data);

      return {
        id: question.id,
        title: question.title,
        points: question.points ?? null,
        order: question.order ?? null,
        exerciseSectionId: question.exerciseSectionId ?? null,
        gradingMode,
        revisionId: currentRevisionId,
        revision: revision.revision,
        definition,
        authorDefinition: canViewAuthorDefinitions ? parsedDefinition.data : null
      };
    });

    const isComplete = profileId ? await getExerciseCompletionByProfile(exerciseId, profileId, dbClient) : false;

    // Build questionTypeMap from questions (already fetched with questionType)
    const questionTypeMap = new Map(questions.map((q) => [q.questionType.id, q.questionType]));

    // Extract options from questions and transform
    const allOptions = questions.flatMap((q) => q.options || []);

    // Transform questions (strip questionType and options since they're handled in transform)
    const questionsForTransform = questions.map(({ questionType, options, ...q }) => q);
    const questionsWithOptions = transformQuestions(questionsForTransform, allOptions, questionTypeMap);
    const visibleQuestions: VisibleQuestionWithRelations[] =
      profileId !== undefined && !canViewAuthorDefinitions
        ? questionsWithOptions.map((question) => projectQuestionForLearner(question, profileId))
        : questionsWithOptions;
    const sections = await getExerciseSectionsByExerciseId(exerciseId, dbClient);
    const sectionGroups = groupQuestionsBySections(sections, visibleQuestions);

    return {
      ...exercise,
      isComplete,
      questions: visibleQuestions,
      sections: sectionGroups.sections,
      canonicalQuestions
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      error instanceof Error ? error.message : 'Failed to fetch exercise',
      ErrorCodes.EXERCISE_FETCH_FAILED,
      500
    );
  }
}

export async function getExerciseForCourseService(
  courseId: string,
  exerciseId: string,
  profileId: string
): Promise<ExerciseWithQuestions<VisibleQuestionWithRelations>> {
  const exercise = await getExerciseById(exerciseId);
  if (!exercise) {
    throw new AppError('Exercise not found', ErrorCodes.EXERCISE_NOT_FOUND, 404);
  }

  const exerciseCourseId = await resolveExerciseCourseId(exercise);
  if (exerciseCourseId !== courseId) {
    throw new AppError('Exercise does not belong to this course', ErrorCodes.EXERCISE_NOT_FOUND, 404);
  }

  return getExercise(exerciseId, undefined, profileId);
}

/**
 * Updates an exercise with questions and options.
 * Only updates what has changed by querying the current state first and computing a diff.
 * @param exerciseId Exercise ID
 * @param data Partial exercise update data
 * @returns Updated exercise
 */
export async function updateExerciseService(
  exerciseId: string,
  data: TExerciseUpdate,
  profileId?: string
): Promise<ExerciseWithQuestions<VisibleQuestionWithRelations>> {
  try {
    const sanitizedData = sanitizeExercisePayload(data);
    validateSectionQuestionAssignments(sanitizedData);

    const existing = await getExerciseById(exerciseId);
    const exerciseCourseId = existing ? await resolveExerciseCourseId(existing) : null;

    if (existing?.courseId) {
      await guardNonAutoGradableQuestionsForCourseType({
        courseId: existing.courseId,
        questionTypeIds: (sanitizedData.questions ?? [])
          .filter((question) => !('deletedAt' in question && question.deletedAt))
          .map((question) => question.questionTypeId)
      });
    }

    if (sanitizedData.slug !== undefined && existing?.courseId) {
      sanitizedData.slug = await resolveItemSlug({
        courseId: existing.courseId,
        title: sanitizedData.title ?? existing.title,
        requestedSlug: sanitizedData.slug,
        ignoreItemSlug: existing.slug ?? undefined
      });
    }

    const result = await db.transaction(async (tx) => {
      const txClient = tx as DbOrTxClient;
      await lockExerciseAssignmentState(exerciseId, txClient);

      // Update exercise basic fields only if they changed
      const exerciseUpdate = buildExerciseUpdateFields(sanitizedData);
      if (Object.keys(exerciseUpdate).length > 0) {
        const updated = await updateExercise(exerciseId, exerciseUpdate, txClient);
        if (!updated) {
          throw new AppError('Failed to update exercise', ErrorCodes.INTERNAL_ERROR, 500);
        }
      }

      if (sanitizedData.sections !== undefined) {
        await syncExerciseSections(
          exerciseId,
          sanitizedData.sections,
          sanitizedData.canonicalQuestionPlacements,
          txClient
        );
      }

      if (sanitizedData.canonicalQuestionPlacements !== undefined) {
        await syncCanonicalQuestionPlacements(
          exerciseId,
          sanitizedData.canonicalQuestionPlacements,
          sanitizedData.questions,
          txClient
        );
      }

      // Process questions - only update what changed
      if (sanitizedData.questions && sanitizedData.questions.length > 0) {
        // Query current state from DB ('all' scope: archived rows are needed to
        // reject stale payloads that still reference them)
        const { questions: currentQuestionRows, options: currentOptions } = await fetchQuestionsAndOptions(
          exerciseId,
          txClient
        );

        const archivedQuestionIds: ReadonlySet<number> = new Set(
          currentQuestionRows
            .filter((question) => question.archivedAt != null)
            .map((question) => question.id)
            .filter((id): id is number => id !== undefined)
        );
        assertPayloadDoesNotEditArchivedQuestions(sanitizedData.questions, archivedQuestionIds);

        // Attempted = any answer row exists, including legacy rows with no
        // surviving submission. Those freeze the graph to removal-only exactly
        // like a submission does; removals archive them instead of hard-deleting
        // (the question_answer FK would reject the delete with a 500 otherwise).
        const allCurrentQuestionIds = currentQuestionRows
          .map((question) => question.id)
          .filter((id): id is number => id !== undefined);
        const attemptedQuestionIds = new Set(await getAttemptedQuestionIds(allCurrentQuestionIds, txClient));

        // The diff base is the active graph only, so archived rows and their
        // options can never be edited, re-created, or re-diffed.
        const currentQuestions = currentQuestionRows.filter((question) => question.archivedAt == null);

        // Build current state with options mapped to their questions
        const currentQuestionsWithOptions = currentQuestions.map((q) => ({
          ...q,
          options: currentOptions.filter((opt) => opt.questionId === q.id)
        }));

        // Compute diff between current DB state and incoming data
        const diff = computeExerciseDiff(
          currentQuestionsWithOptions,
          sanitizedData.questions,
          new Set(allCurrentQuestionIds)
        );

        const exerciseHasSubmissions = await hasExerciseSubmissions(exerciseId, txClient);
        if (exerciseHasSubmissions || attemptedQuestionIds.size > 0) {
          assertQuestionGraphChangesAreRemovalOnly(diff);
        }

        const hasNewQuestions = diff.questions.newQuestions.length > 0;
        const hasNewOptions = diff.options.creates.length > 0 || hasNewQuestions;

        if (hasNewQuestions) {
          await syncQuestionIdSequence(txClient);
        }

        if (hasNewOptions) {
          await syncOptionIdSequence(txClient);
        }

        // Apply question/option graph changes in dependency order. Question deletes cascade
        // options, while new question creation can also create options.
        if (diff.questions.deletedIds.length > 0) {
          // Attempted questions are archived so their answers and revisions stay reviewable;
          // unattempted drafts hard-delete as before (cascade removes their options).
          const questionIdsToArchive = diff.questions.deletedIds.filter((id) => attemptedQuestionIds.has(id));
          const questionIdsToDelete = diff.questions.deletedIds.filter((id) => !attemptedQuestionIds.has(id));

          if (questionIdsToArchive.length > 0) {
            await archiveQuestionsByIds(questionIdsToArchive, exerciseId, txClient);
          }

          if (questionIdsToDelete.length > 0) {
            await deleteQuestionsByIds(questionIdsToDelete, exerciseId, txClient);
          }
        }

        if (diff.options.deletedIds.length > 0) {
          await deleteOptionsByIds(diff.options.deletedIds, exerciseId, txClient);
        }

        if (diff.questions.updates.length > 0) {
          await updateQuestions(diff.questions.updates, exerciseId, txClient);
        }

        if (diff.options.updates.length > 0) {
          await updateOptions(diff.options.updates, exerciseId, txClient);
        }

        if (diff.options.creates.length > 0) {
          await createOptions(diff.options.creates, txClient);
        }

        if (hasNewQuestions) {
          await createNewQuestionsWithOptions(exerciseId, diff.questions.newQuestions, txClient);
        }
      }

      let assessmentItemMutationResults: AssessmentItemMutationResult[] | undefined;
      if (sanitizedData.assessmentItemMutations !== undefined) {
        if (!exerciseCourseId) {
          throw new AppError(
            'Exercise course could not be resolved for assessment item mutations',
            ErrorCodes.EXERCISE_NOT_FOUND,
            404
          );
        }

        assessmentItemMutationResults = await applyAssessmentItemMutationsForExercise(
          exerciseCourseId,
          exerciseId,
          sanitizedData.assessmentItemMutations,
          txClient
        );
      }

      const updatedExercise =
        profileId === undefined
          ? await getExercise(exerciseId, txClient)
          : await getExercise(exerciseId, txClient, profileId);
      if (assessmentItemMutationResults === undefined) return updatedExercise;

      return { ...updatedExercise, assessmentItemMutationResults };
    });

    const courseId = existing?.courseId;
    if (courseId) {
      await touchCourseUpdatedAt(courseId);
    }

    return result;
  } catch (error) {
    console.error('updateExerciseService error:', error);
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError('Failed to update exercise', ErrorCodes.INTERNAL_ERROR, 500);
  }
}

export async function updateExerciseForCourseService(
  courseId: string,
  exerciseId: string,
  data: TExerciseUpdate,
  profileId?: string
): Promise<ExerciseWithQuestions<VisibleQuestionWithRelations>> {
  const exercise = await getExerciseById(exerciseId);
  if (!exercise) {
    throw new AppError('Exercise not found', ErrorCodes.EXERCISE_NOT_FOUND, 404);
  }

  const exerciseCourseId = await resolveExerciseCourseId(exercise);
  if (exerciseCourseId !== courseId) {
    throw new AppError('Exercise does not belong to this course', ErrorCodes.EXERCISE_NOT_FOUND, 404);
  }

  await assertExercisePlacementBelongsToCourse(courseId, data);

  return updateExerciseService(exerciseId, data, profileId);
}

export async function updateExerciseSectionMetadataService(
  exerciseId: string,
  exerciseSectionId: string,
  data: { title?: string; description?: string | null }
) {
  try {
    const sections = await getExerciseSectionsByExerciseId(exerciseId);
    const belongs = sections.some((section) => section.id === exerciseSectionId);

    if (!belongs) {
      throw new AppError(
        'That exercise section was not found on this exercise. Call get_exercise_details and use a section id from the sections array.',
        ErrorCodes.VALIDATION_ERROR,
        404
      );
    }

    const patch: { title?: string; description?: string | null } = {};

    if (data.title !== undefined) {
      patch.title = sanitizeHtml(data.title);
    }

    if (data.description !== undefined) {
      patch.description = data.description === '' ? null : (sanitizeOptionalHtml(data.description) ?? null);
    }

    if (Object.keys(patch).length === 0) {
      throw new AppError('No fields to update', ErrorCodes.VALIDATION_ERROR, 400);
    }

    const updated = await updateExerciseSection(exerciseSectionId, patch);

    if (!updated) {
      throw new AppError('Failed to update exercise section', ErrorCodes.INTERNAL_ERROR, 500);
    }

    const existing = await getExerciseById(exerciseId);

    if (existing?.courseId) {
      await touchCourseUpdatedAt(existing.courseId);
    }

    return {
      id: updated.id,
      title: updated.title,
      description: updated.description ?? null,
      exerciseId
    };
  } catch (error) {
    console.error('updateExerciseSectionMetadataService error:', error);
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      error instanceof Error ? error.message : 'Failed to update exercise section',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

export async function createExerciseSectionService(
  exerciseId: string,
  data: {
    title: string;
    description?: string | null;
    order: number;
    colorTheme?: 'blue' | 'green' | 'amber' | 'rose' | 'violet' | 'slate';
    afterBehavior?:
      | { action: 'continue' }
      | { action: 'submit' }
      | { action: 'go_to_section'; exerciseSectionId: string };
  }
) {
  try {
    const sections = await getExerciseSectionsByExerciseId(exerciseId);
    const afterBehavior = data.afterBehavior;

    if (afterBehavior?.action === 'go_to_section') {
      const targetExists = sections.some((section) => section.id === afterBehavior.exerciseSectionId);

      if (!targetExists) {
        throw new AppError(
          'That exercise section was not found on this exercise. Call get_exercise_details and use a section id from the sections array.',
          ErrorCodes.VALIDATION_ERROR,
          404
        );
      }
    }

    const [created] = await createExerciseSections([
      {
        exerciseId,
        title: data.title,
        description: data.description ?? null,
        order: data.order,
        colorTheme: data.colorTheme ?? 'blue',
        afterBehavior: data.afterBehavior ?? { action: 'continue' }
      }
    ]);

    if (!created) {
      throw new AppError('Failed to create exercise section', ErrorCodes.INTERNAL_ERROR, 500);
    }

    const existing = await getExerciseById(exerciseId);

    if (existing?.courseId) {
      await touchCourseUpdatedAt(existing.courseId);
    }

    return {
      id: created.id,
      exerciseId: created.exerciseId,
      title: created.title,
      description: created.description ?? null,
      order: created.order,
      colorTheme: created.colorTheme,
      afterBehavior: created.afterBehavior
    };
  } catch (error) {
    console.error('createExerciseSectionService error:', error);
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      error instanceof Error ? error.message : 'Failed to create exercise section',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

/**
 * Replaces an exercise's questions and options with the provided payload.
 * Existing questions are deleted and recreated from the replacement payload.
 */
export async function replaceExerciseService(exerciseId: string, data: TExerciseUpdate): Promise<TExercise> {
  try {
    const sanitizedData = sanitizeExercisePayload(data);

    const existing = await getExerciseById(exerciseId);

    const result = await db.transaction(async (tx) => {
      const txClient = tx as DbOrTxClient;
      await lockExerciseAssignmentState(exerciseId, txClient);
      await assertExerciseQuestionGraphMutable(exerciseId, txClient);

      const exerciseUpdate = buildExerciseUpdateFields(sanitizedData);
      if (Object.keys(exerciseUpdate).length > 0) {
        const updated = await updateExercise(exerciseId, exerciseUpdate, txClient);
        if (!updated) {
          throw new AppError('Failed to update exercise', ErrorCodes.INTERNAL_ERROR, 500);
        }
      }

      // Replace only the active graph: archived questions are frozen history and
      // must survive a replace (hard-deleting them is also blocked by the
      // question_answer FK once a question has attempts).
      const { questions: currentQuestions } = await fetchQuestionsAndOptions(exerciseId, txClient, {
        questionScope: 'active'
      });
      const currentQuestionIds = currentQuestions
        .map((question) => question.id)
        .filter((id): id is number => id !== undefined);

      if (currentQuestionIds.length > 0) {
        await deleteQuestionsByIds(currentQuestionIds, exerciseId, txClient);
      }

      const replacementQuestions = sanitizedData.questions ?? [];
      const hasReplacementOptions = replacementQuestions.some((question) => (question.options?.length ?? 0) > 0);

      if (replacementQuestions.length > 0) {
        await syncQuestionIdSequence(txClient);

        if (hasReplacementOptions) {
          await syncOptionIdSequence(txClient);
        }

        await createNewQuestionsWithOptions(exerciseId, replacementQuestions, txClient);
      }

      return await getExercise(exerciseId, txClient);
    });

    const courseId = existing?.courseId;
    if (courseId) {
      await touchCourseUpdatedAt(courseId);
    }

    return result;
  } catch (error) {
    console.error('replaceExerciseService error:', error);
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError('Failed to replace exercise', ErrorCodes.INTERNAL_ERROR, 500);
  }
}

/**
 * Deletes an exercise (cascade deletes questions and options)
 * @param exerciseId Exercise ID
 * @returns Deleted exercise
 */
export async function deleteExerciseService(exerciseId: string): Promise<TExercise> {
  try {
    const exercise = await getExerciseById(exerciseId);
    if (!exercise) {
      throw new AppError('Exercise not found', ErrorCodes.EXERCISE_NOT_FOUND, 404);
    }

    const deleted = await db.transaction(async (tx) => {
      const txClient = tx as DbOrTxClient;
      await lockExerciseAssignmentState(exerciseId, txClient);
      await assertExerciseQuestionGraphMutable(exerciseId, txClient);

      return deleteExercise(exerciseId, txClient);
    });
    if (!deleted) {
      throw new AppError('Failed to delete exercise', ErrorCodes.INTERNAL_ERROR, 500);
    }

    if (exercise.courseId) {
      await touchCourseUpdatedAt(exercise.courseId);
    }

    return deleted;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      error instanceof Error ? error.message : 'Failed to delete exercise',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

export async function deleteExerciseForCourseService(courseId: string, exerciseId: string): Promise<TExercise> {
  try {
    const exercise = await getExerciseById(exerciseId);
    if (!exercise) {
      throw new AppError('Exercise not found', ErrorCodes.EXERCISE_NOT_FOUND, 404);
    }

    const exerciseCourseId = await resolveExerciseCourseId(exercise);
    if (exerciseCourseId !== courseId) {
      throw new AppError('Exercise does not belong to this course', ErrorCodes.EXERCISE_NOT_FOUND, 404);
    }

    const deleted = await db.transaction(async (tx) => {
      const txClient = tx as DbOrTxClient;
      await lockExerciseAssignmentState(exerciseId, txClient);
      await assertExerciseQuestionGraphMutable(exerciseId, txClient);

      return deleteExercise(exerciseId, txClient);
    });
    if (!deleted) {
      throw new AppError('Failed to delete exercise', ErrorCodes.INTERNAL_ERROR, 500);
    }

    await touchCourseUpdatedAt(courseId);

    return deleted;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      error instanceof Error ? error.message : 'Failed to delete exercise',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

/**
 * Lists exercises for a course
 * @param courseId Course ID
 * @param lessonId Optional lesson ID filter
 * @returns Array of exercises
 */
export async function listExercises(
  courseId: string,
  filters: { lessonId?: string; sectionId?: string } = {},
  profileId?: string
): Promise<ExerciseWithCompletion[]> {
  try {
    const isTeamMember = profileId ? await isCourseTeamMemberOrOrgAdmin(courseId, profileId) : false;
    const viewerProfileId = isTeamMember ? undefined : profileId;
    const exercises = await getExercisesByCourseId(courseId, filters, viewerProfileId);

    if (!profileId) {
      return exercises.map((exercise) => ({
        ...exercise,
        isComplete: false
      }));
    }

    const completedIds = await getExerciseCompletionsByProfile(
      exercises.map((exercise) => exercise.id),
      profileId
    );
    const completedSet = new Set(completedIds);

    return exercises.map((exercise) => ({
      ...exercise,
      isComplete: completedSet.has(exercise.id)
    }));
  } catch (error) {
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to list exercises',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

/**
 * Creates an exercise from a template
 * @param courseId Course ID
 * @param lessonId Lesson ID
 * @param template Exercise template with questionnaire
 * @returns Created exercise with questions and options
 */
export async function createExerciseFromTemplate(
  courseId: string,
  lessonId: string | undefined,
  sectionId: string | undefined,
  order: number | undefined,
  template: TExerciseTemplate
): Promise<TExercise> {
  try {
    await assertExercisePlacementBelongsToCourse(courseId, { lessonId, sectionId });

    // Create the exercise
    const exerciseData: TExerciseCreate = {
      title: template.title!,
      description: template.description ?? undefined,
      lessonId,
      sectionId,
      order,
      courseId
    };

    const exercise = await createExercise(exerciseData);

    // Process the questionnaire to create questions and options
    const { questions } = template.questionnaire!;

    if (questions && questions.length > 0) {
      await db.transaction(async (tx) => {
        const txClient = tx as DbOrTxClient;
        const hasTemplateOptions = questions.some(
          (question) => question.question_type.id !== 3 && (question.options?.length ?? 0) > 0
        );

        if (hasTemplateOptions) {
          await syncOptionIdSequence(txClient);
        }

        for (const question of questions) {
          const { title, question_type, options, order, points } = question;
          const questionSettings = sanitizeUnknownStrings(
            (question as { settings?: Record<string, unknown> }).settings ?? {}
          );

          // Create question
          const [newQuestion] = await createQuestions(
            [
              {
                exerciseId: exercise.id,
                title: sanitizeHtml(title),
                questionTypeId: question_type.id,
                points: points ?? 1,
                order: order || 0,
                settings: questionSettings
              }
            ],
            txClient
          );

          if (!newQuestion) continue;

          // Create options if not TEXTAREA type
          if (question_type.id !== 3 && options && options.length > 0) {
            // Filter out deleted options

            // value column is UUID (default gen_random_uuid()); label is the display text only
            const optionsData: TNewOption[] = options.map((opt) => ({
              questionId: newQuestion.id,
              label: sanitizeHtml(opt.label || ''),
              isCorrect: opt.is_correct || false,
              settings: sanitizeUnknownStrings((opt as { settings?: Record<string, unknown> }).settings ?? {})
            }));

            await createOptions(optionsData, txClient);
          }
        }
      });
    }

    // Fetch the complete exercise with questions and options
    return await getExercise(exercise.id);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      error instanceof Error ? error.message : 'Failed to create exercise from template',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}

/**
 * Gets LMS exercises for a student in an organization
 * Returns exercises from unlocked lessons in courses where the student is a member
 * @param profileId - The profile ID of the student
 * @param orgId - The organization ID
 * @returns Array of exercises with related data
 */
export async function getLMSExercisesService(profileId: string, orgId: string) {
  try {
    const exercises = await getLMSExercises(profileId, orgId);
    return exercises;
  } catch (error) {
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to fetch LMS exercises',
      ErrorCodes.EXERCISE_FETCH_FAILED,
      500
    );
  }
}
