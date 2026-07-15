import { ROLE } from '@cio/utils/constants';
import { and, db, eq, inArray, isNotNull, or, sql } from '@db/drizzle';
import type { DbOrTxClient } from '@db/drizzle';
import * as schema from '@db/schema';

export type ExerciseAccessResult = {
  groupMemberId: string | null;
  roleId: number | null;
  hasAccess: boolean;
};

export type ExerciseStudentMemberValidationResult = {
  isValid: boolean;
  invalidGroupMemberIds: string[];
};

export function getExerciseVisibilityCondition(groupMemberId: string, roleId: number) {
  if (roleId !== ROLE.STUDENT) {
    return sql`true`;
  }

  return or(
    eq(schema.exercise.assignmentMode, 'ALL_STUDENTS'),
    sql`EXISTS (
      SELECT 1 FROM ${schema.exerciseAssignment}
      WHERE ${schema.exerciseAssignment.exerciseId} = ${schema.exercise.id}
        AND ${schema.exerciseAssignment.groupMemberId} = ${groupMemberId}
    )`
  )!;
}

export async function lockExerciseAssignmentState(exerciseId: string, dbClient: DbOrTxClient): Promise<void> {
  await dbClient.execute(
    sql`SELECT ${schema.exercise.id} FROM ${schema.exercise} WHERE ${schema.exercise.id} = ${exerciseId} FOR UPDATE`
  );
}

export async function listExerciseAssignments(exerciseId: string, dbClient: DbOrTxClient = db) {
  try {
    return await dbClient
      .select({
        id: schema.exerciseAssignment.id,
        groupMemberId: schema.exerciseAssignment.groupMemberId,
        profileId: schema.groupmember.profileId,
        email: schema.groupmember.email,
        fullname: schema.profile.fullname,
        avatarUrl: schema.profile.avatarUrl,
        submissionCount: sql<number>`(
          SELECT COUNT(*)::int
          FROM ${schema.submission}
          WHERE ${schema.submission.exerciseId} = ${schema.exerciseAssignment.exerciseId}
            AND ${schema.submission.submittedBy} = ${schema.exerciseAssignment.groupMemberId}
        )`
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

export async function listExerciseNotificationRecipients(
  courseId: string,
  exerciseId: string,
  dbClient: DbOrTxClient = db
): Promise<Array<{ email: string; profileId: string }>> {
  try {
    const rows = await dbClient
      .select({ email: schema.profile.email, profileId: schema.profile.id })
      .from(schema.exercise)
      .leftJoin(schema.lesson, eq(schema.lesson.id, schema.exercise.lessonId))
      .innerJoin(
        schema.course,
        and(
          eq(schema.course.id, courseId),
          or(eq(schema.course.id, schema.exercise.courseId), eq(schema.course.id, schema.lesson.courseId))
        )
      )
      .innerJoin(
        schema.groupmember,
        and(eq(schema.groupmember.groupId, schema.course.groupId), eq(schema.groupmember.roleId, ROLE.STUDENT))
      )
      .innerJoin(schema.profile, eq(schema.profile.id, schema.groupmember.profileId))
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
          isNotNull(schema.profile.email),
          or(eq(schema.exercise.assignmentMode, 'ALL_STUDENTS'), isNotNull(schema.exerciseAssignment.id))
        )
      );

    return rows.filter((row): row is { email: string; profileId: string } => row.email !== null);
  } catch (error) {
    console.error('listExerciseNotificationRecipients error:', error);
    throw new Error('Failed to list exercise notification recipients');
  }
}

export async function validateExerciseStudentGroupMembers(
  exerciseId: string,
  groupMemberIds: string[],
  dbClient: DbOrTxClient = db
): Promise<ExerciseStudentMemberValidationResult> {
  const uniqueGroupMemberIds = [...new Set(groupMemberIds)];

  if (uniqueGroupMemberIds.length === 0) {
    return { isValid: true, invalidGroupMemberIds: [] };
  }

  try {
    const validMembers = await dbClient
      .select({ id: schema.groupmember.id })
      .from(schema.exercise)
      .leftJoin(schema.lesson, eq(schema.lesson.id, schema.exercise.lessonId))
      .innerJoin(
        schema.course,
        or(eq(schema.course.id, schema.exercise.courseId), eq(schema.course.id, schema.lesson.courseId))
      )
      .innerJoin(
        schema.groupmember,
        and(
          eq(schema.groupmember.groupId, schema.course.groupId),
          eq(schema.groupmember.roleId, ROLE.STUDENT),
          inArray(schema.groupmember.id, uniqueGroupMemberIds)
        )
      )
      .where(eq(schema.exercise.id, exerciseId));

    const validMemberIds = new Set(validMembers.map((member) => member.id));
    const invalidGroupMemberIds = uniqueGroupMemberIds.filter((groupMemberId) => !validMemberIds.has(groupMemberId));

    return { isValid: invalidGroupMemberIds.length === 0, invalidGroupMemberIds };
  } catch (error) {
    console.error('validateExerciseStudentGroupMembers error:', error);
    throw new Error('Failed to validate exercise student group members');
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
): Promise<ExerciseAccessResult> {
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

export async function resolveGroupMemberExerciseAccess(
  courseId: string,
  exerciseId: string,
  groupMemberId: string,
  dbClient: DbOrTxClient = db
): Promise<ExerciseAccessResult> {
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
      .innerJoin(
        schema.groupmember,
        and(eq(schema.groupmember.id, groupMemberId), eq(schema.groupmember.groupId, schema.course.groupId))
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

    if (!row) {
      return { groupMemberId: null, roleId: null, hasAccess: false };
    }

    const hasAccess = row.roleId !== ROLE.STUDENT || row.assignmentMode === 'ALL_STUDENTS' || row.assignmentId !== null;

    return { groupMemberId: row.groupMemberId, roleId: row.roleId, hasAccess };
  } catch (error) {
    console.error('resolveGroupMemberExerciseAccess error:', error);
    throw new Error('Failed to resolve group member exercise access');
  }
}
