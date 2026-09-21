import { AppError, ErrorCodes } from '@api/utils/errors';
import { INTERNAL_QUESTION_TYPE_IDS } from '@cio/core/services/exercise/utils';
import { db } from '@cio/db/drizzle';
import type { DbOrTxClient } from '@cio/db/drizzle';
import { TCourse, TCourseSection, TLesson, TNewQuestion } from '@db/types';
import {
  addGroupMember,
  createCourse,
  createExercises,
  createGroup,
  createLessonLanguages,
  createCourseSections,
  createLessons,
  createOptions,
  createQuestions,
  syncOptionIdSequence,
  getCourseById,
  getExercisesByLessonIds,
  getLessonLanguagesByLessonIds,
  getLessonsByCourseId,
  getOptionsByQuestionIds,
  getQuestionsByExerciseIds,
  getCourseSectionsByCourseId,
  getExerciseSectionsByExerciseIds,
  createExerciseSections,
  updateExerciseSection
} from '@db/queries';

import { ROLE } from '@cio/utils/constants';
import { invalidateOrgStats } from '@cio/core/utils/redis/org-stats-cache';
import { QUESTION_TYPE_IDS } from '@cio/question-types';

/**
 * Internal composite items (ASSESSMENT_ITEM) keep their definition in question
 * revisions, which clone does not copy. Copying the bare question row would
 * silently drop the definition, so cloning fails explicitly until a composite
 * clone/materialization path exists.
 */
function assertNoInternalQuestions(questions: TNewQuestion[]): void {
  const internalQuestion = questions.find((question) => INTERNAL_QUESTION_TYPE_IDS.has(question.questionTypeId));
  if (!internalQuestion) return;

  throw new AppError(
    'This course contains composite assessment items that cannot be cloned yet',
    ErrorCodes.CONFLICT,
    409
  );
}

/**
 * Pre-flight for cloneCourse: runs before any row is written so an unclonable
 * course fails atomically instead of leaving a partial clone behind.
 */
async function assertLessonExercisesCloneable(oldLessons: TLesson[]): Promise<void> {
  const lessonIds = oldLessons.map((lesson) => lesson.id);
  if (lessonIds.length === 0) return;

  const exercises = await getExercisesByLessonIds(lessonIds);
  if (exercises.length === 0) return;

  const activeQuestions = await getQuestionsByExerciseIds(
    exercises.map((exercise) => exercise.id),
    undefined,
    { questionScope: 'active' }
  );
  assertNoInternalQuestions(activeQuestions);
}

async function cloneLessonLanguages(
  newLessons: TLesson[],
  oldLessons: TLesson[],
  txClient: DbOrTxClient
): Promise<void> {
  // Extract old lesson IDs
  const oldLessonIds = oldLessons.map((lesson) => lesson.id);

  // Fetch all lesson languages for the old lessons
  const oldLessonLanguages = await getLessonLanguagesByLessonIds(oldLessonIds);

  if (!oldLessonLanguages || oldLessonLanguages.length === 0) {
    return;
  }

  // Create a map of old lesson ID to new lesson ID
  const lessonIdMap = new Map<string, string>();
  oldLessons.forEach((oldLesson, index) => {
    lessonIdMap.set(oldLesson.id, newLessons[index].id);
  });

  // Map lesson languages to new lesson IDs
  const newLessonLanguages = oldLessonLanguages.map((lang) => ({
    content: lang.content,
    locale: lang.locale,
    lessonId: lessonIdMap.get(lang.lessonId!)!
  }));

  // Bulk insert lesson languages
  await createLessonLanguages(newLessonLanguages, txClient);
}

async function cloneExercises(newLessons: TLesson[], oldLessons: TLesson[], txClient: DbOrTxClient): Promise<void> {
  // 1. Extract old lesson IDs
  const oldLessonIds = oldLessons.map((lesson) => lesson.id);

  // 2. Fetch all exercises for old lessons
  const oldExercises = await getExercisesByLessonIds(oldLessonIds, txClient);

  if (!oldExercises || oldExercises.length === 0) {
    return;
  }

  // 3. Create lesson ID map
  const lessonIdMap = new Map<string, string>();
  oldLessons.forEach((oldLesson, index) => {
    lessonIdMap.set(oldLesson.id, newLessons[index].id);
  });

  // 4. Insert exercises with new lesson IDs
  const newExercises = await createExercises(
    oldExercises.map((exercise) => ({
      title: exercise.title,
      description: exercise.description,
      dueBy: new Date().toISOString(),
      lessonId: lessonIdMap.get(exercise.lessonId!)!,
      sectionDisplayMode: exercise.sectionDisplayMode,
      order: exercise.order
    })),
    txClient
  );

  // 5. Create exercise ID map
  const exerciseIdMap = new Map<string, string>();
  oldExercises.forEach((oldExercise, index) => {
    exerciseIdMap.set(oldExercise.id, newExercises[index].id);
  });

  // 6. Fetch all questions for old exercises
  const oldExerciseIds = oldExercises.map((ex) => ex.id);
  const oldSections = await getExerciseSectionsByExerciseIds(oldExerciseIds, txClient);
  const exerciseSectionIdMap = new Map<string, string>();

  if (oldSections.length > 0) {
    const newSections = await createExerciseSections(
      oldSections.map((section) => ({
        title: section.title,
        description: section.description,
        order: section.order,
        colorTheme: section.colorTheme,
        afterBehavior: section.afterBehavior,
        exerciseId: exerciseIdMap.get(section.exerciseId)!
      })),
      txClient
    );

    oldSections.forEach((oldSection, index) => {
      const newSection = newSections[index];
      if (newSection) {
        exerciseSectionIdMap.set(oldSection.id, newSection.id);
      }
    });

    await Promise.all(
      newSections.map((newSection) => {
        const behavior = newSection.afterBehavior as { action?: string; exerciseSectionId?: string };
        if (behavior.action !== 'go_to_section' || !behavior.exerciseSectionId) {
          return null;
        }

        const remappedId = exerciseSectionIdMap.get(behavior.exerciseSectionId);
        if (!remappedId) {
          return null;
        }

        return updateExerciseSection(
          newSection.id,
          {
            afterBehavior: { action: 'go_to_section', exerciseSectionId: remappedId }
          },
          txClient
        );
      })
    );
  }

  // Clone only the active graph: archived questions are frozen history of the
  // source course and must not resurrect in the clone.
  const oldQuestions = await getQuestionsByExerciseIds(oldExerciseIds, txClient, { questionScope: 'active' });

  if (!oldQuestions || oldQuestions.length === 0) {
    return;
  }

  // Backstop for the pre-flight check in cloneCourse: this is the exact set about
  // to be copied, so an internal item that appeared in between still fails loudly
  // instead of being cloned without its revision definition. Throwing here aborts
  // the surrounding transaction, so no partial clone rows survive.
  assertNoInternalQuestions(oldQuestions);

  // 7. Insert questions with new exercise IDs
  const newQuestions = await createQuestions(
    oldQuestions.map((question) => ({
      name: question.name,
      title: question.title,
      points: question.points,
      order: question.order,
      questionTypeId: question.questionTypeId,
      settings: question.settings,
      exerciseSectionId: question.exerciseSectionId
        ? (exerciseSectionIdMap.get(question.exerciseSectionId) ?? null)
        : null,
      exerciseId: exerciseIdMap.get(question.exerciseId)!
    })),
    txClient
  );

  // 8. Create question ID map
  const questionIdMap = new Map<number, number>();
  oldQuestions.forEach((oldQuestion, index) => {
    const newQuestionId = newQuestions[index]?.id;
    const oldQuestionId = oldQuestion.id;
    if (newQuestionId !== undefined && oldQuestionId !== undefined) {
      questionIdMap.set(oldQuestionId, newQuestionId);
    }
  });

  // 9. Fetch all options for old questions (except for paragraph type questions)
  const oldQuestionIds = oldQuestions
    .filter((q) => q.questionTypeId !== QUESTION_TYPE_IDS.TEXTAREA)
    .map((q) => q.id)
    .filter((id) => id !== undefined);

  if (oldQuestionIds.length === 0) {
    return;
  }

  const oldOptions = await getOptionsByQuestionIds(oldQuestionIds, txClient);

  if (!oldOptions || oldOptions.length === 0) {
    return;
  }

  // 10. Insert options with new question IDs
  await syncOptionIdSequence(txClient);
  await createOptions(
    oldOptions
      .map((option) => {
        const newQuestionId = questionIdMap.get(option.questionId);
        if (newQuestionId === undefined) {
          return null;
        }
        return {
          value: option.value,
          label: option.label,
          isCorrect: option.isCorrect,
          settings: option.settings,
          questionId: newQuestionId
        };
      })
      .filter((opt) => opt !== null),
    txClient
  );
}

export async function cloneCourse(
  courseId: string,
  newTitle: string,
  userId: string,
  newDescription?: string,
  newSlug?: string,
  organizationId?: string
): Promise<TCourse> {
  // 1. fetch old course
  const [course] = await getCourseById(courseId);

  // Fail before any write when the course cannot be cloned (internal composite items).
  const oldLessons = await getLessonsByCourseId(courseId);
  await assertLessonExercisesCloneable(oldLessons);

  // Source-course reads: hoisted before the transaction so the write section
  // below is pure writes and any failure inside it rolls the whole clone back.
  const oldSections = await getCourseSectionsByCourseId(courseId);

  // All clone writes run in one transaction: the in-flight internal-question
  // backstop (or any other mid-clone failure) can never leave partial
  // group/course/section/lesson rows behind.
  // Captured inside the transaction, invalidated after it commits: the org-stats
  // cache (upstream #883) is a Redis side effect and does not belong among the
  // rollback-safe DB writes.
  let statsOrgId: string | null | undefined;

  const newCourse = await db.transaction(async (tx) => {
    const txClient = tx as DbOrTxClient;

    // 2. create group
    const [newGroup] = await createGroup(
      {
        name: newTitle,
        description: newDescription ?? course.description,
        organizationId: organizationId
      },
      txClient
    );

    statsOrgId = organizationId ?? newGroup.organizationId;

    // 3. create course for that group
    // Explicitly select only the fields we want to copy (exclude id, createdAt, updatedAt)
    const [newCourse] = await createCourse(
      {
        title: newTitle,
        description: course.description,
        overview: course.overview,
        groupId: newGroup.id,
        isTemplate: course.isTemplate,
        logo: course.logo,
        slug: newSlug ?? null,
        metadata: course.metadata,
        cost: course.cost,
        currency: course.currency,
        bannerImage: course.bannerImage,
        isPublished: course.isPublished,
        certificate: course.certificate,
        status: course.status,
        type: course.type
      },
      txClient
    );

    // 4. add group member
    await addGroupMember(
      {
        profileId: userId,
        email: '',
        groupId: newGroup.id,
        roleId: ROLE.TUTOR
      },
      txClient
    );

    // 5. clone sections
    // Only create sections if there are any
    let newSections: TCourseSection[] = [];
    let sectionMap = new Map<string, string>();

    if (oldSections.length > 0) {
      newSections = await createCourseSections(
        oldSections.map((section) => ({
          title: section.title,
          order: section.order,
          courseId: newCourse.id
        })),
        txClient
      );

      // create map
      sectionMap = new Map(oldSections.map((section, index) => [section.id, newSections[index].id]));
    }

    // 6. clone lessons (fetched above, before the first write)
    const newLessons = await createLessons(
      oldLessons.map((lesson) => ({
        note: lesson.note,
        videoUrl: lesson.videoUrl,
        slideUrl: lesson.slideUrl,
        courseId: newCourse.id,
        title: lesson.title,
        public: lesson.public,
        lessonAt: lesson.lessonAt,
        teacherId: lesson.teacherId,
        isComplete: lesson.isComplete,
        callUrl: lesson.callUrl,
        order: lesson.order,
        isUnlocked: lesson.isUnlocked,
        videos: lesson.videos,
        sectionId: lesson.sectionId ? sectionMap.get(lesson.sectionId) : null,
        documents: lesson.documents
      })),
      txClient
    );

    // 7. clone languages, exercises, questions, options using bulk queries
    await cloneLessonLanguages(newLessons, oldLessons, txClient);
    await cloneExercises(newLessons, oldLessons, txClient);

    return newCourse;
  });

  if (statsOrgId) await invalidateOrgStats(statsOrgId);

  return newCourse;
}
