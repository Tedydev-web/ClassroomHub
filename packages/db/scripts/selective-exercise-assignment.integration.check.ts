import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { db } from '../src/drizzle';
import { eq } from 'drizzle-orm';
import * as schema from '../src/schema';
import {
  listExerciseNotificationRecipients,
  lockExerciseAssignmentState,
  resolveGroupMemberExerciseAccess
} from '../src/queries/exercise/assignment';
import { createSubmission } from '../src/queries/submission/submission';
import { getCourseContentItems } from '../src/queries/course/content';
import { getCourseProgress, hasSelectivelyAssignedExercises } from '../src/queries/course/course';
import { getProfileCourseProgress, getUserExercisesStats } from '../src/queries/analytics/analytics';
import { getLMSExercises } from '../src/queries/exercise/lms';

const ids = {
  organization: randomUUID(),
  selectedUser: randomUUID(),
  unassignedUser: randomUUID(),
  group: randomUUID(),
  course: randomUUID(),
  exercise: randomUUID(),
  selectedMember: randomUUID(),
  unassignedMember: randomUUID()
};

test('selective assignment recipients and submission locking are consistent', async (testContext) => {
  testContext.after(async () => {
    await db.delete(schema.submission).where(eq(schema.submission.exerciseId, ids.exercise));
    await db.delete(schema.exerciseAssignment).where(eq(schema.exerciseAssignment.exerciseId, ids.exercise));
    await db.delete(schema.exercise).where(eq(schema.exercise.id, ids.exercise));
    await db.delete(schema.groupmember).where(eq(schema.groupmember.groupId, ids.group));
    await db.delete(schema.course).where(eq(schema.course.id, ids.course));
    await db.delete(schema.group).where(eq(schema.group.id, ids.group));
    await db.delete(schema.organization).where(eq(schema.organization.id, ids.organization));
    await db.delete(schema.profile).where(eq(schema.profile.id, ids.selectedUser));
    await db.delete(schema.profile).where(eq(schema.profile.id, ids.unassignedUser));
    await db.delete(schema.user).where(eq(schema.user.id, ids.selectedUser));
    await db.delete(schema.user).where(eq(schema.user.id, ids.unassignedUser));
  });

  await db.insert(schema.role).values({ id: 3, type: 'student' }).onConflictDoNothing();
  await db.insert(schema.submissionstatus).values({ id: 1, label: 'Submitted' }).onConflictDoNothing();
  await db.insert(schema.user).values([
    { id: ids.selectedUser, name: 'Selected student', email: `${ids.selectedUser}@example.com` },
    { id: ids.unassignedUser, name: 'Unassigned student', email: `${ids.unassignedUser}@example.com` }
  ]);
  await db.insert(schema.profile).values([
    {
      id: ids.selectedUser,
      fullname: 'Selected student',
      username: `student-${ids.selectedUser}`,
      email: `${ids.selectedUser}@example.com`
    },
    {
      id: ids.unassignedUser,
      fullname: 'Unassigned student',
      username: `student-${ids.unassignedUser}`,
      email: `${ids.unassignedUser}@example.com`
    }
  ]);
  await db.insert(schema.organization).values({
    id: ids.organization,
    name: 'Selective assignment organization',
    siteName: `selective-${ids.organization}`
  });
  await db.insert(schema.group).values({
    id: ids.group,
    name: 'Course group',
    organizationId: ids.organization
  });
  await db.insert(schema.course).values({
    id: ids.course,
    groupId: ids.group,
    title: 'Course',
    description: 'Course'
  });
  await db.insert(schema.groupmember).values([
    {
      id: ids.selectedMember,
      groupId: ids.group,
      roleId: 3,
      profileId: ids.selectedUser,
      email: `${ids.selectedUser}@example.com`
    },
    {
      id: ids.unassignedMember,
      groupId: ids.group,
      roleId: 3,
      profileId: ids.unassignedUser,
      email: `${ids.unassignedUser}@example.com`
    }
  ]);
  await db.insert(schema.exercise).values({
    id: ids.exercise,
    courseId: ids.course,
    title: 'Exercise',
    assignmentMode: 'SELECTED_STUDENTS'
  });
  await db.insert(schema.exerciseAssignment).values({
    exerciseId: ids.exercise,
    groupMemberId: ids.selectedMember,
    assignedByProfileId: ids.selectedUser
  });

  assert.equal(await hasSelectivelyAssignedExercises(ids.course), true);

  const selectedContent = await getCourseContentItems(ids.course, ids.selectedUser);
  const unassignedContent = await getCourseContentItems(ids.course, ids.unassignedUser);
  assert.equal(
    selectedContent.some((item) => item.id === ids.exercise),
    true
  );
  assert.equal(
    unassignedContent.some((item) => item.id === ids.exercise),
    false
  );

  const selectedProgress = await getCourseProgress(ids.course, ids.selectedUser);
  const unassignedProgress = await getCourseProgress(ids.course, ids.unassignedUser);
  assert.equal(selectedProgress.exercisesCount, 1);
  assert.equal(unassignedProgress.exercisesCount, 0);

  const selectedExerciseStats = await getUserExercisesStats(ids.course, ids.selectedUser);
  const unassignedExerciseStats = await getUserExercisesStats(ids.course, ids.unassignedUser);
  assert.deepEqual(
    selectedExerciseStats.map((exercise) => exercise.id),
    [ids.exercise]
  );
  assert.deepEqual(unassignedExerciseStats, []);

  const selectedProfileProgress = await getProfileCourseProgress(ids.course, ids.selectedUser);
  const unassignedProfileProgress = await getProfileCourseProgress(ids.course, ids.unassignedUser);
  assert.equal(selectedProfileProgress.exercises_count, 1);
  assert.equal(unassignedProfileProgress.exercises_count, 0);

  const selectedLmsExercises = await getLMSExercises(ids.selectedUser, ids.organization);
  const unassignedLmsExercises = await getLMSExercises(ids.unassignedUser, ids.organization);
  assert.deepEqual(
    selectedLmsExercises.map((exercise) => exercise.id),
    [ids.exercise]
  );
  assert.deepEqual(unassignedLmsExercises, []);

  const selectedRecipients = await listExerciseNotificationRecipients(ids.course, ids.exercise);
  assert.deepEqual(selectedRecipients, [{ email: `${ids.selectedUser}@example.com`, profileId: ids.selectedUser }]);

  await db.delete(schema.exerciseAssignment).where(eq(schema.exerciseAssignment.exerciseId, ids.exercise));
  assert.deepEqual(await listExerciseNotificationRecipients(ids.course, ids.exercise), []);

  await db.update(schema.exercise).set({ assignmentMode: 'ALL_STUDENTS' }).where(eq(schema.exercise.id, ids.exercise));
  assert.equal(await hasSelectivelyAssignedExercises(ids.course), false);
  assert.deepEqual(await listExerciseNotificationRecipients(ids.course, ids.exercise), [
    { email: `${ids.selectedUser}@example.com`, profileId: ids.selectedUser },
    { email: `${ids.unassignedUser}@example.com`, profileId: ids.unassignedUser }
  ]);

  await db
    .update(schema.exercise)
    .set({ assignmentMode: 'SELECTED_STUDENTS' })
    .where(eq(schema.exercise.id, ids.exercise));
  await db.insert(schema.exerciseAssignment).values({
    exerciseId: ids.exercise,
    groupMemberId: ids.selectedMember,
    assignedByProfileId: ids.selectedUser
  });

  let releaseRevocation: (() => void) | undefined;
  const revocationCanCommit = new Promise<void>((resolve) => {
    releaseRevocation = resolve;
  });
  let revocationLocked: (() => void) | undefined;
  const revocationHasLock = new Promise<void>((resolve) => {
    revocationLocked = resolve;
  });

  const revocation = db.transaction(async (tx) => {
    await lockExerciseAssignmentState(ids.exercise, tx);
    await tx.delete(schema.exerciseAssignment).where(eq(schema.exerciseAssignment.exerciseId, ids.exercise));
    revocationLocked?.();
    await revocationCanCommit;
  });

  await revocationHasLock;
  const submissionAfterRevocation = db.transaction(async (tx) => {
    await lockExerciseAssignmentState(ids.exercise, tx);
    const access = await resolveGroupMemberExerciseAccess(ids.course, ids.exercise, ids.selectedMember, tx);

    return access.hasAccess;
  });
  releaseRevocation?.();
  await revocation;
  assert.equal(await submissionAfterRevocation, false);

  await db.insert(schema.exerciseAssignment).values({
    exerciseId: ids.exercise,
    groupMemberId: ids.selectedMember,
    assignedByProfileId: ids.selectedUser
  });
  const submission = await db.transaction(async (tx) => {
    await lockExerciseAssignmentState(ids.exercise, tx);
    const access = await resolveGroupMemberExerciseAccess(ids.course, ids.exercise, ids.selectedMember, tx);
    assert.equal(access.hasAccess, true);

    return createSubmission(
      {
        courseId: ids.course,
        exerciseId: ids.exercise,
        submittedBy: ids.selectedMember,
        statusId: 1,
        total: 0
      },
      tx
    );
  });
  assert.equal(submission.exerciseId, ids.exercise);

  await db.transaction(async (tx) => {
    await lockExerciseAssignmentState(ids.exercise, tx);
    await tx.delete(schema.exerciseAssignment).where(eq(schema.exerciseAssignment.exerciseId, ids.exercise));
  });
  const storedSubmissions = await db
    .select()
    .from(schema.submission)
    .where(eq(schema.submission.exerciseId, ids.exercise));
  assert.equal(storedSubmissions.length, 1);
});
