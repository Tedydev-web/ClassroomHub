import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { eq } from 'drizzle-orm';

import { db } from '../src/drizzle';
import * as schema from '../src/schema';
import {
  getExerciseTitleAndMaxPoints,
  getHistoricalMaxPointsBySubmissionIds
} from '../src/queries/course/certification-exercise';
import { isExercisePassedForMember } from '../src/queries/course/progression';
import { getCourseContentItems } from '../src/queries/course/content';
import { getMarksByCourseId } from '../src/queries/mark/mark';
import { getUserExercisesStats } from '../src/queries/analytics/analytics';
import { getLMSExercises } from '../src/queries/exercise/lms';
import { findNonAutoGradableQuestionsInCourse } from '../src/queries/course/public-course';

const ids = {
  organization: randomUUID(),
  user: randomUUID(),
  group: randomUUID(),
  course: randomUUID(),
  exercise: randomUUID(),
  emptyExercise: randomUUID(),
  member: randomUUID()
};

test('archive-aware active aggregates and historical attempt denominators', async (testContext) => {
  testContext.after(async () => {
    await db.delete(schema.submission).where(eq(schema.submission.exerciseId, ids.exercise));
    await db.delete(schema.exercise).where(eq(schema.exercise.id, ids.exercise));
    await db.delete(schema.exercise).where(eq(schema.exercise.id, ids.emptyExercise));
    await db.delete(schema.groupmember).where(eq(schema.groupmember.groupId, ids.group));
    await db.delete(schema.course).where(eq(schema.course.id, ids.course));
    await db.delete(schema.group).where(eq(schema.group.id, ids.group));
    await db.delete(schema.organization).where(eq(schema.organization.id, ids.organization));
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
  await db.insert(schema.organization).values({
    id: ids.organization,
    name: 'Archive aggregates organization',
    siteName: `archive-agg-${ids.organization}`
  });
  await db.insert(schema.group).values({ id: ids.group, name: 'Group', organizationId: ids.organization });
  await db.insert(schema.course).values({ id: ids.course, groupId: ids.group, title: 'Course', description: 'C' });
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
    completionPolicy: 'passed',
    passThreshold: 70
  });
  await db.insert(schema.exercise).values({
    id: ids.emptyExercise,
    courseId: ids.course,
    title: 'No submissions exercise'
  });

  // Q1 active legacy 2.5 | Q2 archived after the attempt, legacy 4 | Q3 revision-linked, live points 3.5
  const [q1] = await db
    .insert(schema.question)
    .values({ exerciseId: ids.exercise, title: 'Q1', questionTypeId: 1, points: 2.5 })
    .returning();
  const [q2] = await db
    .insert(schema.question)
    .values({ exerciseId: ids.exercise, title: 'Q2', questionTypeId: 3, points: 4 })
    .returning();
  const [q3] = await db
    .insert(schema.question)
    .values({ exerciseId: ids.exercise, title: 'Q3', questionTypeId: 1, points: 3.5 })
    .returning();
  const [emptyQ] = await db
    .insert(schema.question)
    .values({ exerciseId: ids.emptyExercise, title: 'EQ', questionTypeId: 1, points: 1.75 })
    .returning();
  assert.ok(q1 && q2 && q3 && emptyQ);

  // Attempted revision for Q3: interaction maxima sum to 2.0, diverging from live points 3.5.
  const [revision] = await db
    .insert(schema.questionRevision)
    .values({
      questionId: q3.id,
      revision: 1,
      contentHash: 'archive-agg-check-1',
      definition: {
        schemaVersion: 1,
        blocks: [
          { kind: 'content', id: 'c1', html: '<p>intro</p>' },
          { kind: 'interaction', id: 'b1', interaction: { kind: 'text', maxScore: 1.25 } },
          { kind: 'interaction', id: 'b2', interaction: { kind: 'choice', maxScore: 0.75 } }
        ]
      }
    })
    .returning();
  assert.ok(revision);

  const [fullSubmission] = await db
    .insert(schema.submission)
    .values({
      courseId: ids.course,
      exerciseId: ids.exercise,
      submittedBy: ids.member,
      statusId: 1,
      gradingState: 'completed',
      total: 5,
      score: 5
    })
    .returning();
  const [partialSubmission] = await db
    .insert(schema.submission)
    .values({
      courseId: ids.course,
      exerciseId: ids.exercise,
      submittedBy: ids.member,
      statusId: 1,
      gradingState: 'completed',
      total: 1,
      score: 1
    })
    .returning();
  assert.ok(fullSubmission && partialSubmission);
  await db.insert(schema.questionAnswer).values([
    { submissionId: fullSubmission.id, questionId: q1.id, groupMemberId: ids.member, answerData: null },
    { submissionId: fullSubmission.id, questionId: q2.id, groupMemberId: ids.member, answerData: null },
    {
      submissionId: fullSubmission.id,
      questionId: q3.id,
      groupMemberId: ids.member,
      answerData: null,
      questionRevisionId: revision.id
    },
    // Second submission answered only Q1 — its denominator is its own attempted set.
    { submissionId: partialSubmission.id, questionId: q1.id, groupMemberId: ids.member, answerData: null }
  ]);

  // Archive Q2 after the attempt.
  await db.update(schema.question).set({ archivedAt: new Date().toISOString() }).where(eq(schema.question.id, q2.id));

  // Active max excludes archived Q2: 2.5 + 3.5 = 6.
  const { maxPoints: activeMax } = await getExerciseTitleAndMaxPoints(ids.exercise);
  assert.equal(activeMax, 6);

  // Batch denominators come back for N submissions from one call (no N+1):
  // full = legacy Q1 2.5 + archived legacy Q2 4 + revision maxima 2.0 = 8.5; partial = 2.5.
  const historical = await getHistoricalMaxPointsBySubmissionIds([fullSubmission.id, partialSubmission.id]);
  assert.equal(historical.size, 2);
  assert.equal(historical.get(fullSubmission.id), 8.5);
  assert.equal(historical.get(partialSubmission.id), 2.5);

  // Pass percentage pinned per submission: best attempt is 5 / 8.5 = 58.8%
  // (partial attempt is 1 / 2.5 = 40%). Fails 70, passes 55.
  // The live active total 6 would give 83.3% and pass both thresholds.
  assert.equal(await isExercisePassedForMember(ids.exercise, ids.member, 70), false);
  assert.equal(await isExercisePassedForMember(ids.exercise, ids.member, 55), true);

  // Course content: questionCount counts active only; isComplete follows the pinned percentage.
  const contentAt70 = await getCourseContentItems(ids.course, ids.user);
  const exerciseItemAt70 = contentAt70.find((item) => item.id === ids.exercise);
  assert.ok(exerciseItemAt70);
  assert.equal(exerciseItemAt70.questionCount, 2);
  assert.equal(exerciseItemAt70.isComplete, false);

  await db.update(schema.exercise).set({ passThreshold: 55 }).where(eq(schema.exercise.id, ids.exercise));
  const contentAt55 = await getCourseContentItems(ids.course, ids.user);
  assert.equal(contentAt55.find((item) => item.id === ids.exercise)?.isComplete, true);

  // Gradebook: each submission row keeps its own fractional historical denominator
  // (8.5 proves ::int removal); submission-less exercise shows the fractional active maximum.
  const marks = await getMarksByCourseId(ids.course);
  const fullMark = marks.find((mark) => mark.exerciseId === ids.exercise && mark.totalPointsGotten === 5);
  const partialMark = marks.find((mark) => mark.exerciseId === ids.exercise && mark.totalPointsGotten === 1);
  const emptyMark = marks.find((mark) => mark.exerciseId === ids.emptyExercise);
  assert.equal(fullMark?.exercisePoints, 8.5);
  assert.equal(partialMark?.exercisePoints, 2.5);
  assert.equal(emptyMark?.exercisePoints, 1.75);

  // Analytics maxima are active-only.
  const stats = await getUserExercisesStats(ids.course, ids.user);
  assert.equal(stats.find((stat) => stat.id === ids.exercise)?.totalPoints, 6);

  // LMS maxima are active-only.
  const lms = await getLMSExercises(ids.user, ids.organization);
  const lmsExercise = lms.find((entry) => entry.id === ids.exercise);
  assert.deepEqual(
    lmsExercise?.questions.map((question) => question.points).sort((a, b) => a - b),
    [2.5, 3.5]
  );

  // Public-course capability scan ignores archived non-auto-gradable Q2 (typeId 3 not allowlisted).
  const nonAutoGradable = await findNonAutoGradableQuestionsInCourse(ids.course, [1]);
  assert.deepEqual(nonAutoGradable, []);

  // Stored definitions violating the v1 contract fail explicitly with the revision id
  // in the error — future versions, unknown kinds, and invalid maxScore shapes are
  // rejected, never counted and never silently replaced by live data.
  const rejectionCases: Array<{
    label: string;
    questionId: number;
    revision: number;
    definition: unknown;
    expectedMessage: string;
  }> = [
    {
      label: 'blocks not an array',
      questionId: q1.id,
      revision: 1,
      definition: { schemaVersion: 1, blocks: 'not-an-array' },
      expectedMessage: 'assessment blocks is not an array in question revision'
    },
    {
      label: 'future schemaVersion with valid-looking blocks',
      questionId: q1.id,
      revision: 2,
      definition: {
        schemaVersion: 2,
        blocks: [{ kind: 'interaction', id: 'b1', interaction: { kind: 'text', maxScore: 1 } }]
      },
      expectedMessage: 'unsupported assessment schemaVersion in question revision'
    },
    {
      label: 'unknown interaction kind',
      questionId: q1.id,
      revision: 3,
      definition: {
        schemaVersion: 1,
        blocks: [{ kind: 'interaction', id: 'b1', interaction: { kind: 'hotspot_future', maxScore: 1 } }]
      },
      expectedMessage: 'unsupported interaction kind in question revision'
    },
    {
      label: 'maxScore as JSON string',
      questionId: q1.id,
      revision: 4,
      definition: {
        schemaVersion: 1,
        blocks: [{ kind: 'interaction', id: 'b1', interaction: { kind: 'text', maxScore: '2.5' } }]
      },
      expectedMessage: 'missing or non-numeric interaction maxScore in question revision'
    },
    {
      label: 'maxScore missing entirely',
      questionId: q2.id,
      revision: 1,
      definition: { schemaVersion: 1, blocks: [{ kind: 'interaction', id: 'b1', interaction: { kind: 'text' } }] },
      expectedMessage: 'missing or non-numeric interaction maxScore in question revision'
    },
    {
      label: 'maxScore beyond two decimal places',
      questionId: q1.id,
      revision: 5,
      definition: {
        schemaVersion: 1,
        blocks: [{ kind: 'interaction', id: 'b1', interaction: { kind: 'text', maxScore: 1.234 } }]
      },
      expectedMessage: 'interaction maxScore exceeds two decimal places in question revision'
    },
    {
      label: 'maxScore above canonical MAX_INTERACTION_MAX_SCORE (10000)',
      questionId: q1.id,
      revision: 6,
      definition: {
        schemaVersion: 1,
        blocks: [{ kind: 'interaction', id: 'b1', interaction: { kind: 'text', maxScore: 20000 } }]
      },
      expectedMessage: 'interaction maxScore out of range in question revision'
    },
    {
      label: 'duplicate block ids',
      questionId: q1.id,
      revision: 7,
      definition: {
        schemaVersion: 1,
        blocks: [
          { kind: 'interaction', id: 'b1', interaction: { kind: 'text', maxScore: 1 } },
          { kind: 'interaction', id: 'b1', interaction: { kind: 'text', maxScore: 1 } }
        ]
      },
      expectedMessage: 'duplicate assessment block id in question revision'
    }
  ];

  for (const rejectionCase of rejectionCases) {
    const [badRevision] = await db
      .insert(schema.questionRevision)
      .values({
        questionId: rejectionCase.questionId,
        revision: rejectionCase.revision,
        contentHash: `archive-agg-check-reject-${rejectionCase.revision}-${rejectionCase.questionId}`,
        definition: rejectionCase.definition
      })
      .returning();
    assert.ok(badRevision, rejectionCase.label);
    const [badSubmission] = await db
      .insert(schema.submission)
      .values({
        courseId: ids.course,
        exerciseId: ids.exercise,
        submittedBy: ids.member,
        statusId: 1,
        gradingState: 'completed',
        total: 1,
        score: 1
      })
      .returning();
    assert.ok(badSubmission, rejectionCase.label);
    await db.insert(schema.questionAnswer).values({
      submissionId: badSubmission.id,
      questionId: rejectionCase.questionId,
      groupMemberId: ids.member,
      answerData: null,
      questionRevisionId: badRevision.id
    });

    await assert.rejects(
      () => getHistoricalMaxPointsBySubmissionIds([badSubmission.id]),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes(rejectionCase.expectedMessage) &&
        error.message.includes(badRevision.id),
      rejectionCase.label
    );
  }
});
