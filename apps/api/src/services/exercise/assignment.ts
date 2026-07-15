import { AppError, ErrorCodes } from '@api/utils/errors';
import { db, type DbOrTxClient } from '@cio/db/drizzle';
import { getCourseMembers } from '@cio/db/queries/course/people';
import {
  getExerciseById,
  listExerciseAssignments,
  replaceExerciseAssignments,
  updateExercise
} from '@cio/db/queries/exercise';
import { getLessonById } from '@cio/db/queries/lesson';
import { ROLE } from '@cio/utils/constants';
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
    const members = await getCourseMembers(courseId);
    const studentMemberIds = new Set(
      members.filter((member) => member.roleId === ROLE.STUDENT).map((member) => member.id)
    );
    const invalidMemberId = data.groupMemberIds.find((memberId) => !studentMemberIds.has(memberId));
    if (invalidMemberId) {
      throw new AppError('Assignment contains a non-student course member', ErrorCodes.VALIDATION_ERROR, 400);
    }
  }

  await db.transaction(async (tx) => {
    const txClient = tx as DbOrTxClient;
    await updateExercise(exerciseId, { assignmentMode: data.mode }, txClient);
    await replaceExerciseAssignments(exerciseId, data.groupMemberIds, assignedByProfileId, txClient);
  });

  return getExerciseAssignmentsService(courseId, exerciseId);
}
