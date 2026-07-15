import { ROLE } from '@cio/utils/constants';
import { and, db, eq, or } from '@db/drizzle';
import type { DbOrTxClient } from '@db/drizzle';
import * as schema from '@db/schema';

export async function listExerciseAssignments(exerciseId: string, dbClient: DbOrTxClient = db) {
  try {
    return await dbClient
      .select({
        id: schema.exerciseAssignment.id,
        groupMemberId: schema.exerciseAssignment.groupMemberId,
        profileId: schema.groupmember.profileId,
        email: schema.groupmember.email,
        fullname: schema.profile.fullname,
        avatarUrl: schema.profile.avatarUrl
      })
      .from(schema.exerciseAssignment)
      .innerJoin(schema.groupmember, eq(schema.groupmember.id, schema.exerciseAssignment.groupMemberId))
      .leftJoin(schema.profile, eq(schema.profile.id, schema.groupmember.profileId))
      .where(eq(schema.exerciseAssignment.exerciseId, exerciseId));
  } catch (error) {
    console.error('listExerciseAssignments error:', error);
    throw new Error('Failed to list exercise assignments');
  }
}

export async function replaceExerciseAssignments(
  exerciseId: string,
  groupMemberIds: string[],
  assignedByProfileId: string,
  dbClient: DbOrTxClient = db
): Promise<void> {
  try {
    await dbClient.delete(schema.exerciseAssignment).where(eq(schema.exerciseAssignment.exerciseId, exerciseId));

    if (groupMemberIds.length === 0) return;

    await dbClient.insert(schema.exerciseAssignment).values(
      groupMemberIds.map((groupMemberId) => ({
        exerciseId,
        groupMemberId,
        assignedByProfileId
      }))
    );
  } catch (error) {
    console.error('replaceExerciseAssignments error:', error);
    throw new Error('Failed to replace exercise assignments');
  }
}

export async function resolveViewerExerciseAccess(
  courseId: string,
  exerciseId: string,
  profileId: string,
  dbClient: DbOrTxClient = db
): Promise<{ groupMemberId: string | null; roleId: number | null; hasAccess: boolean }> {
  try {
    const [row] = await dbClient
      .select({
        assignmentMode: schema.exercise.assignmentMode,
        groupMemberId: schema.groupmember.id,
        roleId: schema.groupmember.roleId,
        assignmentId: schema.exerciseAssignment.id
      })
      .from(schema.exercise)
      .leftJoin(schema.lesson, eq(schema.lesson.id, schema.exercise.lessonId))
      .innerJoin(schema.course, eq(schema.course.id, courseId))
      .leftJoin(
        schema.groupmember,
        and(eq(schema.groupmember.groupId, schema.course.groupId), eq(schema.groupmember.profileId, profileId))
      )
      .leftJoin(
        schema.exerciseAssignment,
        and(
          eq(schema.exerciseAssignment.exerciseId, schema.exercise.id),
          eq(schema.exerciseAssignment.groupMemberId, schema.groupmember.id)
        )
      )
      .where(
        and(
          eq(schema.exercise.id, exerciseId),
          or(eq(schema.exercise.courseId, courseId), eq(schema.lesson.courseId, courseId))
        )
      )
      .limit(1);

    if (!row?.groupMemberId || row.roleId === null) {
      return { groupMemberId: null, roleId: null, hasAccess: false };
    }

    const hasAccess = row.roleId !== ROLE.STUDENT || row.assignmentMode === 'ALL_STUDENTS' || row.assignmentId !== null;

    return { groupMemberId: row.groupMemberId, roleId: row.roleId, hasAccess };
  } catch (error) {
    console.error('resolveViewerExerciseAccess error:', error);
    throw new Error('Failed to resolve exercise access');
  }
}
