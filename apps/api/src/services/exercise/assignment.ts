import { AppError, ErrorCodes } from '@api/utils/errors';
import { db, type DbOrTxClient } from '@cio/db/drizzle';
import { getCourseTypeById } from '@cio/db/queries/course/course';
import {
  getExerciseById,
  listExerciseAssignments,
  replaceExerciseAssignments,
  validateExerciseStudentGroupMembers,
  updateExercise
} from '@cio/db/queries/exercise';
import { getLessonById } from '@cio/db/queries/lesson';
import type { TExerciseAssignmentUpdate } from '@cio/utils/validation/exercise';

async function assertExerciseBelongsToCourse(courseId: string, exerciseId: string) {
  const exercise = await getExerciseById(exerciseId);
  if (!exercise) {
    throw new AppError('Exercise not found', ErrorCodes.EXERCISE_NOT_FOUND, 404);
  }

  const lesson = exercise.lessonId ? await getLessonById(exercise.lessonId) : null;
  if (exercise.courseId !== courseId && lesson?.courseId !== courseId) {
    throw new AppError('Exercise not found', ErrorCodes.EXERCISE_NOT_FOUND, 404);
  }

  return exercise;
}

export async function getExerciseAssignmentsService(courseId: string, exerciseId: string) {
  const exercise = await assertExerciseBelongsToCourse(courseId, exerciseId);
  const assignments = await listExerciseAssignments(exerciseId);

  return { mode: exercise.assignmentMode, assignments };
}

export async function updateExerciseAssignmentsService(
  courseId: string,
  exerciseId: string,
  assignedByProfileId: string,
  data: TExerciseAssignmentUpdate
) {
  await assertExerciseBelongsToCourse(courseId, exerciseId);

  if (data.mode === 'SELECTED_STUDENTS') {
    const courseType = await getCourseTypeById(courseId);
    if (courseType === 'PUBLIC') {
      throw new AppError(
        'Selective exercise assignment is not available for public courses',
        ErrorCodes.VALIDATION_ERROR,
        400
      );
    }
  }

  await db.transaction(async (tx) => {
    const txClient = tx as DbOrTxClient;
    const memberValidation = await validateExerciseStudentGroupMembers(exerciseId, data.groupMemberIds, txClient);
    if (!memberValidation.isValid) {
      throw new AppError('Assignment contains a non-student course member', ErrorCodes.VALIDATION_ERROR, 400);
    }

    await updateExercise(exerciseId, { assignmentMode: data.mode }, txClient);
    await replaceExerciseAssignments(exerciseId, data.groupMemberIds, assignedByProfileId, txClient);
  });

  return getExerciseAssignmentsService(courseId, exerciseId);
}
