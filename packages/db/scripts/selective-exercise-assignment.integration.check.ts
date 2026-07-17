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
import { getExerciseWithRelationsOptimized } from '../src/queries/exercise/exercise';
import {
  createSubmission,
  getSubmissionByIdempotencyKey,
  insertQuestionAnswersBatch,
  updateSubmissionGrades
} from '../src/queries/submission/submission';
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

function isUniqueViolation(error: unknown): boolean {
  let currentError: unknown = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof currentError !== 'object' || currentError === null) return false;
    if ('code' in currentError && currentError.code === '23505') return true;

    currentError = 'cause' in currentError ? currentError.cause : undefined;
  }

  return false;
}

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
  const [question] = await db
    .insert(schema.question)
    .values({
      exerciseId: ids.exercise,
      title: 'Original question',
      questionTypeId: 3,
      points: 2.5
    })
    .returning();
  assert.ok(question);
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

  const [answer] = await insertQuestionAnswersBatch([
    {
      submissionId: submission.id,
      questionId: question.id,
      groupMemberId: ids.selectedMember,
      answerData: { type: 'TEXTAREA', text: 'Answer' }
    }
  ]);
  assert.ok(answer);
  await assert.rejects(
    insertQuestionAnswersBatch([
      {
        submissionId: submission.id,
        questionId: question.id,
        groupMemberId: ids.selectedMember,
        answerData: { type: 'TEXTAREA', text: 'Duplicate' }
      }
    ]),
    isUniqueViolation
  );

  const gradedSubmission = await updateSubmissionGrades(ids.course, submission.id, {
    answers: [{ questionId: question.id, points: 1.25 }],
    total: 1.25
  });
  assert.equal(gradedSubmission?.score, 1.25);
  assert.equal(gradedSubmission?.total, 1);
  const [gradedAnswer] = await db.select().from(schema.questionAnswer).where(eq(schema.questionAnswer.id, answer.id));
  assert.equal(gradedAnswer?.score, 1.25);
  assert.equal(gradedAnswer?.point, 1);

  const idempotencyKey = randomUUID();
  const keyedSubmission = await createSubmission({
    courseId: ids.course,
    exerciseId: ids.exercise,
    submittedBy: ids.selectedMember,
    idempotencyKey,
    statusId: 1,
    total: 0
  });
  assert.equal(
    (await getSubmissionByIdempotencyKey(ids.exercise, ids.selectedMember, idempotencyKey))?.id,
    keyedSubmission.id
  );
  await assert.rejects(
    db.insert(schema.submission).values({
      courseId: ids.course,
      exerciseId: ids.exercise,
      submittedBy: ids.selectedMember,
      idempotencyKey,
      statusId: 1,
      total: 0
    }),
    isUniqueViolation
  );

  let releaseQuestionUpdate: (() => void) | undefined;
  const questionUpdateCanCommit = new Promise<void>((resolve) => {
    releaseQuestionUpdate = resolve;
  });
  let questionUpdateLocked: (() => void) | undefined;
  const questionUpdateHasLock = new Promise<void>((resolve) => {
    questionUpdateLocked = resolve;
  });
  const questionUpdate = db.transaction(async (tx) => {
    await lockExerciseAssignmentState(ids.exercise, tx);
    await tx.update(schema.question).set({ title: 'Updated question' }).where(eq(schema.question.id, question.id));
    questionUpdateLocked?.();
    await questionUpdateCanCommit;
  });

  await questionUpdateHasLock;
  const submissionQuestionRead = db.transaction(async (tx) => {
    await lockExerciseAssignmentState(ids.exercise, tx);
    const exerciseWithRelations = await getExerciseWithRelationsOptimized(ids.exercise, tx);

    return exerciseWithRelations.questions[0]?.title;
  });
  releaseQuestionUpdate?.();
  await questionUpdate;
  assert.equal(await submissionQuestionRead, 'Updated question');

  await db.transaction(async (tx) => {
    await lockExerciseAssignmentState(ids.exercise, tx);
    await tx.delete(schema.exerciseAssignment).where(eq(schema.exerciseAssignment.exerciseId, ids.exercise));
  });
  const storedSubmissions = await db
    .select()
    .from(schema.submission)
    .where(eq(schema.submission.exerciseId, ids.exercise));
  assert.equal(storedSubmissions.length, 2);
});
