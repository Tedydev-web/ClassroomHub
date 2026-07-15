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

const ids = {
  user: randomUUID(),
  group: randomUUID(),
  course: randomUUID(),
  exercise: randomUUID(),
  member: randomUUID()
};

test('selective assignment recipients and submission locking are consistent', async (testContext) => {
  testContext.after(async () => {
    await db.delete(schema.submission).where(eq(schema.submission.exerciseId, ids.exercise));
    await db.delete(schema.exerciseAssignment).where(eq(schema.exerciseAssignment.exerciseId, ids.exercise));
    await db.delete(schema.exercise).where(eq(schema.exercise.id, ids.exercise));
    await db.delete(schema.groupmember).where(eq(schema.groupmember.id, ids.member));
    await db.delete(schema.course).where(eq(schema.course.id, ids.course));
    await db.delete(schema.group).where(eq(schema.group.id, ids.group));
    await db.delete(schema.profile).where(eq(schema.profile.id, ids.user));
    await db.delete(schema.user).where(eq(schema.user.id, ids.user));
  });

  await db.insert(schema.role).values({ id: 3, type: 'student' }).onConflictDoNothing();
  await db.insert(schema.submissionstatus).values({ id: 1, label: 'Submitted' }).onConflictDoNothing();
  await db.insert(schema.user).values({ id: ids.user, name: 'Student', email: `${ids.user}@example.com` });
  await db.insert(schema.profile).values({
    id: ids.user,
    fullname: 'Student',
    username: `student-${ids.user}`,
    email: `${ids.user}@example.com`
  });
  await db.insert(schema.group).values({ id: ids.group, name: 'Course group' });
  await db.insert(schema.course).values({
    id: ids.course,
    groupId: ids.group,
    title: 'Course',
    description: 'Course'
  });
  await db.insert(schema.groupmember).values({
    id: ids.member,
    groupId: ids.group,
    roleId: 3,
    profileId: ids.user,
    email: `${ids.user}@example.com`
  });
  await db.insert(schema.exercise).values({
    id: ids.exercise,
    courseId: ids.course,
    title: 'Exercise',
    assignmentMode: 'SELECTED_STUDENTS'
  });
  await db.insert(schema.exerciseAssignment).values({
    exerciseId: ids.exercise,
    groupMemberId: ids.member,
    assignedByProfileId: ids.user
  });

  const selectedRecipients = await listExerciseNotificationRecipients(ids.course, ids.exercise);
  assert.deepEqual(selectedRecipients, [{ email: `${ids.user}@example.com`, profileId: ids.user }]);

  await db.delete(schema.exerciseAssignment).where(eq(schema.exerciseAssignment.exerciseId, ids.exercise));
  assert.deepEqual(await listExerciseNotificationRecipients(ids.course, ids.exercise), []);

  await db.update(schema.exercise).set({ assignmentMode: 'ALL_STUDENTS' }).where(eq(schema.exercise.id, ids.exercise));
  assert.deepEqual(await listExerciseNotificationRecipients(ids.course, ids.exercise), [
    { email: `${ids.user}@example.com`, profileId: ids.user }
  ]);

  await db
    .update(schema.exercise)
    .set({ assignmentMode: 'SELECTED_STUDENTS' })
    .where(eq(schema.exercise.id, ids.exercise));
  await db.insert(schema.exerciseAssignment).values({
    exerciseId: ids.exercise,
    groupMemberId: ids.member,
    assignedByProfileId: ids.user
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
    const access = await resolveGroupMemberExerciseAccess(ids.course, ids.exercise, ids.member, tx);

    return access.hasAccess;
  });
  releaseRevocation?.();
  await revocation;
  assert.equal(await submissionAfterRevocation, false);

  await db.insert(schema.exerciseAssignment).values({
    exerciseId: ids.exercise,
    groupMemberId: ids.member,
    assignedByProfileId: ids.user
  });
  const submission = await db.transaction(async (tx) => {
    await lockExerciseAssignmentState(ids.exercise, tx);
    const access = await resolveGroupMemberExerciseAccess(ids.course, ids.exercise, ids.member, tx);
    assert.equal(access.hasAccess, true);

    return createSubmission(
      {
        courseId: ids.course,
        exerciseId: ids.exercise,
        submittedBy: ids.member,
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
