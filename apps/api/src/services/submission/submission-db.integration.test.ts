import { randomUUID } from 'node:crypto';

import { config } from 'dotenv';
import { and, eq, inArray } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { QUESTION_TYPE_IDS, type AssessmentItemDefinition } from '@cio/question-types';

config();

const postCommitMocks = vi.hoisted(() => ({
  emitCourseWebhookEvent: vi.fn().mockResolvedValue(undefined),
  enqueueTransactionalEmail: vi.fn().mockResolvedValue(undefined),
  evaluateCourseCertification: vi.fn().mockResolvedValue(undefined),
  syncComplianceProgressFromSubmission: vi.fn().mockResolvedValue(undefined)
}));
const storageCleanupMocks = vi.hoisted(() => ({
  enqueueAssetStorageCleanup: vi.fn().mockResolvedValue(undefined)
}));
const databaseRaceHooks = vi.hoisted(() => ({
  afterAssetUsageCreated: vi.fn().mockResolvedValue(undefined),
  afterExerciseSubmissionCheck: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@api/services/jobs', () => ({
  enqueueTransactionalEmail: postCommitMocks.enqueueTransactionalEmail
}));
vi.mock('@api/services/course/compliance', () => ({
  syncComplianceProgressFromSubmission: postCommitMocks.syncComplianceProgressFromSubmission
}));
vi.mock('@api/services/course/completion', () => ({
  evaluateCourseCertification: postCommitMocks.evaluateCourseCertification
}));
vi.mock('@cio/core/services/webhook/emit', () => ({
  emitCourseWebhookEvent: postCommitMocks.emitCourseWebhookEvent
}));
vi.mock('@cio/jobs', () => ({
  enqueueAssetStorageCleanup: storageCleanupMocks.enqueueAssetStorageCleanup,
  isRedisConfigured: () => true
}));
vi.mock('@cio/db/queries/course', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cio/db/queries/course')>();

  return {
    ...actual,
    getCourseById: vi.fn().mockResolvedValue([]),
    getCourseWithOrgData: vi.fn().mockResolvedValue(null),
    touchCourseUpdatedAt: vi.fn().mockResolvedValue(undefined)
  };
});
vi.mock('@cio/db/queries/course/people', () => ({
  getCourseTeachers: vi.fn().mockResolvedValue([]),
  getProfileByGroupMemberId: vi.fn().mockResolvedValue(null)
}));
vi.mock('@cio/db/queries/assets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cio/db/queries/assets')>();

  return {
    ...actual,
    createAssetUsage: async (...args: Parameters<typeof actual.createAssetUsage>) => {
      const usage = await actual.createAssetUsage(...args);
      await databaseRaceHooks.afterAssetUsageCreated(args[0].assetId);

      return usage;
    }
  };
});
vi.mock('@cio/db/queries/exercise', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cio/db/queries/exercise')>();

  return {
    ...actual,
    hasExerciseSubmissions: async (...args: Parameters<typeof actual.hasExerciseSubmissions>) => {
      const hasSubmissions = await actual.hasExerciseSubmissions(...args);
      await databaseRaceHooks.afterExerciseSubmissionCheck(args[0], hasSubmissions);

      return hasSubmissions;
    }
  };
});

function createAsyncBarrier() {
  let signalReached = (): void => {
    throw new Error('Barrier reached signal was not initialized');
  };
  let releaseWaiter = (): void => {
    throw new Error('Barrier release was not initialized');
  };
  const reached = new Promise<void>((resolve) => {
    signalReached = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseWaiter = resolve;
  });

  return {
    reached,
    wait: async () => {
      signalReached();
      await released;
    },
    release: releaseWaiter
  };
}

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

// The single scenario walks the full transaction graph twice through async
// barriers, so it needs well beyond the 5s vitest default to pass anywhere.
const DATABASE_INTEGRATION_TEST_TIMEOUT_MS = 120_000;

function createCompositeAssessmentDefinition(
  contentHtml: string,
  choiceMaxScore: number,
  textMaxScore: number
): AssessmentItemDefinition {
  return {
    schemaVersion: 1,
    blocks: [
      {
        id: 'content-1',
        kind: 'content',
        content: { format: 'html', html: contentHtml }
      },
      {
        id: 'choice-1',
        kind: 'interaction',
        interaction: {
          kind: 'choice',
          prompt: { format: 'html', html: '<p>Choose the correct option.</p>' },
          required: true,
          maxScore: choiceMaxScore,
          config: {
            cardinality: 'single',
            presentation: 'list',
            options: [
              { id: 'option-a', html: '<p>Option A</p>' },
              { id: 'option-b', html: '<p>Option B</p>' }
            ],
            correctOptionIds: ['option-b']
          }
        }
      },
      {
        id: 'text-1',
        kind: 'interaction',
        interaction: {
          kind: 'text',
          prompt: { format: 'html', html: '<p>Explain your reasoning.</p>' },
          required: true,
          maxScore: textMaxScore,
          config: { format: 'plain', minCharacters: 3, maxCharacters: 500 }
        }
      }
    ],
    feedback: []
  };
}

describe.runIf(runDatabaseIntegration)('createSubmissionService database transaction contract', () => {
  it(
    'preserves the attempted composite revision through authoring, hybrid grading, editing, and review',
    async () => {
      const [{ db }, schema, assessmentItemServices, exerciseServices, submissionServices] = await Promise.all([
        import('@cio/db/drizzle'),
        import('@cio/db/schema'),
        import('@cio/core/services/exercise/assessment-item'),
        import('@cio/core/services/exercise/exercise'),
        import('./submission')
      ]);
      const profileId = randomUUID();
      const ids = {
        course: randomUUID(),
        exercise: randomUUID(),
        exerciseSectionOne: randomUUID(),
        exerciseSectionTwo: randomUUID(),
        group: randomUUID(),
        member: randomUUID(),
        organization: randomUUID(),
        profile: profileId,
        user: profileId
      };
      const definitionOne = createCompositeAssessmentDefinition('<p>Attempted revision content.</p>', 2, 3);
      const definitionAfterDelivery = createCompositeAssessmentDefinition('<p>Delivered revision content.</p>', 2, 3);
      const definitionTwo = createCompositeAssessmentDefinition('<p>Current revision content.</p>', 1, 1);

      try {
        await db.insert(schema.role).values({ id: 3, type: 'student' }).onConflictDoNothing();
        await db
          .insert(schema.submissionstatus)
          .values([
            { id: 1, label: 'Submitted' },
            { id: 2, label: 'In Progress' },
            { id: 3, label: 'Graded' }
          ])
          .onConflictDoNothing();
        await db
          .insert(schema.questionType)
          .values({
            id: QUESTION_TYPE_IDS.ASSESSMENT_ITEM,
            label: 'Assessment item',
            typename: 'ASSESSMENT_ITEM'
          })
          .onConflictDoNothing();

        const email = `${ids.user}@example.com`;
        await db.insert(schema.user).values({ id: ids.user, name: 'Assessment student', email });
        await db.insert(schema.profile).values({
          id: ids.profile,
          fullname: 'Assessment student',
          username: `assessment-${ids.profile}`,
          email
        });
        await db.insert(schema.organization).values({
          id: ids.organization,
          name: 'Assessment organization',
          siteName: `assessment-${ids.organization}`
        });
        await db.insert(schema.group).values({
          id: ids.group,
          name: 'Assessment group',
          organizationId: ids.organization
        });
        await db.insert(schema.course).values({
          id: ids.course,
          groupId: ids.group,
          title: 'Assessment course',
          description: 'Assessment lifecycle course'
        });
        await db.insert(schema.groupmember).values({
          id: ids.member,
          groupId: ids.group,
          roleId: 3,
          profileId: ids.profile,
          email
        });
        await db.insert(schema.exercise).values({
          id: ids.exercise,
          courseId: ids.course,
          title: 'Composite lifecycle exercise',
          slug: 'test-item',
          allowMultipleAttempts: true,
          order: 1
        });
        await db.insert(schema.exerciseSection).values([
          { id: ids.exerciseSectionOne, exerciseId: ids.exercise, title: 'First section', order: 0 },
          { id: ids.exerciseSectionTwo, exerciseId: ids.exercise, title: 'Second section', order: 1 }
        ]);
        await expect(
          assessmentItemServices.createAssessmentItemForCourseService(
            ids.course,
            ids.exercise,
            'Foreign section item',
            definitionOne,
            randomUUID()
          )
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });

        const createdItem = await assessmentItemServices.createAssessmentItemForCourseService(
          ids.course,
          ids.exercise,
          'Composite lifecycle item',
          definitionOne,
          ids.exerciseSectionTwo
        );
        expect(createdItem).toMatchObject({
          exerciseSectionId: ids.exerciseSectionTwo,
          order: 0,
          revision: 1,
          definition: definitionOne
        });
        const renamedItem = await assessmentItemServices.publishAssessmentItemForCourseService(
          ids.course,
          ids.exercise,
          createdItem.questionId,
          'Renamed composite lifecycle item',
          1,
          definitionOne
        );
        expect(renamedItem).toMatchObject({
          title: 'Renamed composite lifecycle item',
          revision: 1,
          revisionId: createdItem.revisionId,
          definition: definitionOne
        });
        const exerciseRead = await exerciseServices.getExercise(ids.exercise);
        expect(exerciseRead.canonicalQuestions).toEqual([
          expect.objectContaining({
            id: createdItem.questionId,
            title: 'Renamed composite lifecycle item',
            points: 5,
            gradingMode: 'hybrid'
          })
        ]);

        const authorItem = await assessmentItemServices.getAssessmentItemForAuthorService(
          ids.course,
          ids.exercise,
          createdItem.questionId
        );
        const learnerItem = await assessmentItemServices.getAssessmentItemForLearnerService(
          ids.course,
          ids.exercise,
          createdItem.questionId
        );
        expect(Object.keys(authorItem).sort()).toEqual(Object.keys(learnerItem).sort());
        expect(authorItem.authorDefinition).toEqual(definitionOne);
        expect(authorItem.title).toBe('Renamed composite lifecycle item');
        expect(JSON.stringify(authorItem.definition)).not.toContain('correctOptionIds');
        expect(learnerItem.revision).toBe(1);
        expect(learnerItem.revisionId).toEqual(expect.any(String));
        expect(learnerItem.revisionId).toBe(createdItem.revisionId);
        expect(learnerItem.authorDefinition).toBeNull();
        expect(JSON.stringify(learnerItem.definition)).toContain('Attempted revision content.');
        expect(JSON.stringify(learnerItem.definition)).not.toContain('correctOptionIds');

        const canonicalResponse = {
          schemaVersion: 1 as const,
          responses: [
            {
              interactionId: 'choice-1',
              response: { kind: 'choice' as const, selectedOptionIds: ['option-b'] }
            },
            {
              interactionId: 'text-1',
              response: { kind: 'text' as const, text: 'The second option satisfies the prompt.' }
            }
          ]
        };
        const deliveredAfterOpen = await assessmentItemServices.publishAssessmentItemForCourseService(
          ids.course,
          ids.exercise,
          createdItem.questionId,
          'Renamed composite lifecycle item',
          1,
          definitionAfterDelivery
        );
        expect(deliveredAfterOpen).toMatchObject({ revision: 2, definition: definitionAfterDelivery });
        await expect(
          submissionServices.createSubmissionService(
            ids.course,
            ids.exercise,
            ids.member,
            [
              {
                questionId: createdItem.questionId,
                questionRevisionId: learnerItem.revisionId,
                response: canonicalResponse
              }
            ],
            { idempotencyKey: randomUUID() }
          )
        ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
        const submissionsAfterStaleAttempt = await db
          .select({ id: schema.submission.id })
          .from(schema.submission)
          .where(eq(schema.submission.exerciseId, ids.exercise));
        expect(submissionsAfterStaleAttempt).toEqual([]);

        const refreshedLearnerItem = await assessmentItemServices.getAssessmentItemForLearnerService(
          ids.course,
          ids.exercise,
          createdItem.questionId
        );
        expect(refreshedLearnerItem).toMatchObject({
          revisionId: deliveredAfterOpen.revisionId,
          revision: 2
        });
        const submission = await submissionServices.createSubmissionService(
          ids.course,
          ids.exercise,
          ids.member,
          [
            {
              questionId: createdItem.questionId,
              questionRevisionId: refreshedLearnerItem.revisionId,
              response: canonicalResponse
            }
          ],
          { idempotencyKey: randomUUID() }
        );
        expect(submission).toMatchObject({
          overallStatus: 'hybrid',
          gradingState: 'awaiting_manual',
          score: 2
        });

        const [attemptedAnswer] = await db
          .select({
            questionRevisionId: schema.questionAnswer.questionRevisionId,
            score: schema.questionAnswer.score
          })
          .from(schema.questionAnswer)
          .where(eq(schema.questionAnswer.submissionId, submission.id));
        expect(attemptedAnswer).toMatchObject({ score: 2 });
        expect(attemptedAnswer?.questionRevisionId).toBeTruthy();

        const publishedItem = await assessmentItemServices.publishAssessmentItemForCourseService(
          ids.course,
          ids.exercise,
          createdItem.questionId,
          'Post-submission renamed item',
          2,
          definitionTwo
        );
        expect(publishedItem).toMatchObject({
          title: 'Post-submission renamed item',
          revision: 3,
          definition: definitionTwo
        });
        expect(publishedItem.definition).not.toEqual(definitionOne);

        const gradedSubmission = await submissionServices.updateSubmissionGradesBatch(submission.id, ids.course, {
          answers: [{ questionId: createdItem.questionId, points: 4.5 }],
          total: 4.5,
          feedback: 'Automatic choice score reviewed with the written response.'
        });
        expect(gradedSubmission).toMatchObject({ gradingState: 'completed', score: 4.5, total: 5 });

        const archivedAt = new Date().toISOString();
        await db.update(schema.question).set({ archivedAt }).where(eq(schema.question.id, createdItem.questionId));

        const [reviewedSubmission] = await submissionServices.listSubmissionsByExercise(
          ids.course,
          ids.exercise,
          ids.member
        );
        const reviewedAnswer = reviewedSubmission?.answers?.find(
          (answer) => answer.questionId === createdItem.questionId
        );
        expect(reviewedAnswer?.questionRevisionId).toBe(attemptedAnswer?.questionRevisionId);
        expect(JSON.stringify(reviewedAnswer?.assessmentDefinition)).toContain('Delivered revision content.');
        expect(JSON.stringify(reviewedAnswer?.assessmentDefinition)).not.toContain('Attempted revision content.');
        expect(JSON.stringify(reviewedAnswer?.assessmentDefinition)).not.toContain('Current revision content.');
        expect(JSON.stringify(reviewedAnswer?.assessmentDefinition)).not.toContain('correctOptionIds');
        expect(reviewedAnswer?.attemptedQuestion).toMatchObject({
          id: createdItem.questionId,
          title: 'Renamed composite lifecycle item',
          archivedAt: expect.any(String)
        });
        expect(new Date(reviewedAnswer!.attemptedQuestion!.archivedAt!).toISOString()).toBe(archivedAt);
      } finally {
        await db.delete(schema.submission).where(eq(schema.submission.exerciseId, ids.exercise));
        await db.delete(schema.exercise).where(eq(schema.exercise.id, ids.exercise));
        await db.delete(schema.groupmember).where(eq(schema.groupmember.id, ids.member));
        await db.delete(schema.course).where(eq(schema.course.id, ids.course));
        await db.delete(schema.group).where(eq(schema.group.id, ids.group));
        await db.delete(schema.organization).where(eq(schema.organization.id, ids.organization));
        await db.delete(schema.profile).where(eq(schema.profile.id, ids.profile));
        await db.delete(schema.user).where(eq(schema.user.id, ids.user));
      }
    },
    DATABASE_INTEGRATION_TEST_TIMEOUT_MS
  );

  it(
    'rolls back invalid writes and preserves one keyed attempt under concurrency',
    async () => {
      const [{ db }, schema, { createSubmissionService }, exerciseServices, assetServices] = await Promise.all([
        import('@cio/db/drizzle'),
        import('@cio/db/schema'),
        import('./submission'),
        import('@cio/core/services/exercise/exercise'),
        import('@cio/core/services/assets/assets')
      ]);
      const profileId = randomUUID();
      const ids = {
        course: randomUUID(),
        crossCourse: randomUUID(),
        crossLesson: randomUUID(),
        crossSection: randomUUID(),
        group: randomUUID(),
        idempotentExercise: randomUUID(),
        invalidExercise: randomUUID(),
        member: randomUUID(),
        organization: randomUUID(),
        profile: profileId,
        user: profileId,
        videoExercise: randomUUID()
      };
      const exerciseIds = [ids.invalidExercise, ids.idempotentExercise, ids.videoExercise];
      const validAssetId = randomUUID();

      try {
        await db.insert(schema.role).values({ id: 3, type: 'student' }).onConflictDoNothing();
        await db
          .insert(schema.submissionstatus)
          .values([
            { id: 1, label: 'Submitted' },
            { id: 2, label: 'In Progress' },
            { id: 3, label: 'Graded' }
          ])
          .onConflictDoNothing();
        await db
          .insert(schema.questionType)
          .values([
            { id: 3, label: 'Paragraph', typename: 'TEXTAREA' },
            { id: 5, label: 'Short answer', typename: 'SHORT_ANSWER' },
            { id: 13, label: 'Video recording', typename: 'VIDEO_RECORDING' }
          ])
          .onConflictDoNothing();

        const registeredQuestionTypes = await db
          .select({ id: schema.questionType.id, typename: schema.questionType.typename })
          .from(schema.questionType)
          .where(inArray(schema.questionType.id, [3, 5, 13]));
        expect(registeredQuestionTypes).toEqual(
          expect.arrayContaining([
            { id: 3, typename: 'TEXTAREA' },
            { id: 5, typename: 'SHORT_ANSWER' },
            { id: 13, typename: 'VIDEO_RECORDING' }
          ])
        );

        const email = `${ids.user}@example.com`;
        await db.insert(schema.user).values({
          id: ids.user,
          name: 'Submission integration student',
          email
        });
        await db.insert(schema.profile).values({
          id: ids.profile,
          fullname: 'Submission integration student',
          username: `submission-${ids.profile}`,
          email
        });
        await db.insert(schema.organization).values({
          id: ids.organization,
          name: 'Submission integration organization',
          siteName: `submission-${ids.organization}`
        });
        await db.insert(schema.group).values({
          id: ids.group,
          name: 'Submission integration group',
          organizationId: ids.organization
        });
        await db.insert(schema.course).values({
          id: ids.course,
          groupId: ids.group,
          title: 'Submission integration course',
          description: 'Submission integration course'
        });
        await db.insert(schema.course).values({
          id: ids.crossCourse,
          groupId: ids.group,
          title: 'Cross-course placement target',
          description: 'Cross-course placement target'
        });
        await db.insert(schema.courseSection).values({
          id: ids.crossSection,
          courseId: ids.crossCourse,
          title: 'Cross-course section',
          order: 1
        });
        await db.insert(schema.lesson).values({
          id: ids.crossLesson,
          courseId: ids.crossCourse,
          title: 'Cross-course lesson',
          slug: 'test-item',
          order: 1
        });
        await db.insert(schema.groupmember).values({
          id: ids.member,
          groupId: ids.group,
          roleId: 3,
          profileId: ids.profile,
          email
        });
        await db.insert(schema.exercise).values([
          {
            id: ids.invalidExercise,
            courseId: ids.course,
            title: 'Invalid payload exercise',
            slug: 'test-item',
            allowMultipleAttempts: true,
            order: 1
          },
          {
            id: ids.idempotentExercise,
            courseId: ids.course,
            title: 'Idempotent exercise',
            slug: 'test-item',
            allowMultipleAttempts: true,
            order: 2
          },
          {
            id: ids.videoExercise,
            courseId: ids.course,
            title: 'Video rollback exercise',
            slug: 'test-item',
            allowMultipleAttempts: true,
            order: 3
          }
        ]);
        const questions = await db
          .insert(schema.question)
          .values([
            {
              exerciseId: ids.invalidExercise,
              title: 'Required answer',
              questionTypeId: 5,
              points: 2,
              settings: { required: true }
            },
            {
              exerciseId: ids.idempotentExercise,
              title: 'Idempotent answer',
              questionTypeId: 5,
              points: 2,
              settings: { required: true }
            },
            {
              exerciseId: ids.videoExercise,
              title: 'Recorded answer',
              questionTypeId: 13,
              points: 2,
              settings: { required: true, maxDurationSeconds: 60 }
            }
          ])
          .returning({ id: schema.question.id, exerciseId: schema.question.exerciseId });
        const invalidQuestion = questions.find((question) => question.exerciseId === ids.invalidExercise);
        const idempotentQuestion = questions.find((question) => question.exerciseId === ids.idempotentExercise);
        const videoQuestion = questions.find((question) => question.exerciseId === ids.videoExercise);
        expect(invalidQuestion).toBeDefined();
        expect(idempotentQuestion).toBeDefined();
        expect(videoQuestion).toBeDefined();
        if (!invalidQuestion || !idempotentQuestion || !videoQuestion) {
          throw new Error('Submission integration questions were not created');
        }

        const invalidRequests = [
          [
            { questionId: invalidQuestion.id, answer: 'first' },
            { questionId: invalidQuestion.id, answer: 'duplicate' }
          ],
          [{ questionId: Number.MAX_SAFE_INTEGER, answer: 'unknown question' }],
          [{ questionId: invalidQuestion.id, answer: '   ' }]
        ];
        for (const answers of invalidRequests) {
          await expect(
            createSubmissionService(ids.course, ids.invalidExercise, ids.member, answers, {
              idempotencyKey: randomUUID()
            })
          ).rejects.toMatchObject({ statusCode: 400 });
        }

        const invalidSubmissions = await db
          .select({ id: schema.submission.id })
          .from(schema.submission)
          .where(eq(schema.submission.exerciseId, ids.invalidExercise));
        const invalidAnswers = await db
          .select({ id: schema.questionAnswer.id })
          .from(schema.questionAnswer)
          .innerJoin(schema.submission, eq(schema.questionAnswer.submissionId, schema.submission.id))
          .where(eq(schema.submission.exerciseId, ids.invalidExercise));
        expect(invalidSubmissions).toHaveLength(0);
        expect(invalidAnswers).toHaveLength(0);

        const authoringBarrier = createAsyncBarrier();
        databaseRaceHooks.afterExerciseSubmissionCheck.mockImplementation(
          async (checkedExerciseId: string, hasSubmissions: boolean) => {
            if (checkedExerciseId !== ids.invalidExercise || hasSubmissions) return;

            await authoringBarrier.wait();
          }
        );
        const authoringPromise = exerciseServices.updateExerciseService(ids.invalidExercise, {
          questions: [
            {
              id: invalidQuestion.id,
              question: 'Required paragraph after concurrent edit',
              questionTypeId: 3,
              points: 2,
              settings: { required: true, minCharacters: 20 }
            }
          ]
        });
        // Same fail-fast rule as the asset barrier below: a pre-barrier
        // authoring rejection must fail the test immediately, not time it out.
        await Promise.race([authoringBarrier.reached, authoringPromise]);
        const submissionAfterAuthoringPromise = createSubmissionService(
          ids.course,
          ids.invalidExercise,
          ids.member,
          [{ questionId: invalidQuestion.id, answer: 'too short' }],
          { idempotencyKey: randomUUID() }
        );
        authoringBarrier.release();

        await expect(authoringPromise).resolves.toMatchObject({ id: ids.invalidExercise });
        await expect(submissionAfterAuthoringPromise).rejects.toMatchObject({ statusCode: 400 });
        databaseRaceHooks.afterExerciseSubmissionCheck.mockResolvedValue(undefined);

        const updatedQuestionGraph = await db
          .select({
            title: schema.question.title,
            questionTypeId: schema.question.questionTypeId,
            settings: schema.question.settings
          })
          .from(schema.question)
          .where(eq(schema.question.id, invalidQuestion.id));
        expect(updatedQuestionGraph).toEqual([
          {
            title: 'Required paragraph after concurrent edit',
            questionTypeId: 3,
            settings: { required: true, minCharacters: 20 }
          }
        ]);

        const submissionsRejectedAgainstUpdatedGraph = await db
          .select({ id: schema.submission.id })
          .from(schema.submission)
          .where(eq(schema.submission.exerciseId, ids.invalidExercise));
        expect(submissionsRejectedAgainstUpdatedGraph).toHaveLength(0);

        const idempotencyKey = randomUUID();
        const [firstAttempt, retriedAttempt] = await Promise.all([
          createSubmissionService(
            ids.course,
            ids.idempotentExercise,
            ids.member,
            [{ questionId: idempotentQuestion.id, answer: 'same intent' }],
            { idempotencyKey }
          ),
          createSubmissionService(
            ids.course,
            ids.idempotentExercise,
            ids.member,
            [{ questionId: idempotentQuestion.id, answer: 'same intent' }],
            { idempotencyKey }
          )
        ]);
        expect(retriedAttempt.id).toBe(firstAttempt.id);

        const keyedSubmissions = await db
          .select({ id: schema.submission.id })
          .from(schema.submission)
          .where(eq(schema.submission.exerciseId, ids.idempotentExercise));
        const keyedAnswers = await db
          .select({ id: schema.questionAnswer.id })
          .from(schema.questionAnswer)
          .innerJoin(schema.submission, eq(schema.questionAnswer.submissionId, schema.submission.id))
          .where(eq(schema.submission.exerciseId, ids.idempotentExercise));
        expect(keyedSubmissions).toEqual([{ id: firstAttempt.id }]);
        expect(keyedAnswers).toHaveLength(1);

        const metadataUpdate = await exerciseServices.updateExerciseService(ids.idempotentExercise, {
          title: 'Idempotent exercise updated'
        });
        expect(metadataUpdate.title).toBe('Idempotent exercise updated');

        await expect(
          exerciseServices.updateExerciseService(ids.idempotentExercise, {
            questions: [
              {
                id: idempotentQuestion.id,
                question: 'Changed after submission',
                questionTypeId: 5,
                points: 3
              }
            ]
          })
        ).rejects.toMatchObject({ statusCode: 409 });
        await expect(
          exerciseServices.replaceExerciseService(ids.idempotentExercise, {
            questions: [
              {
                question: 'Replacement after submission',
                questionTypeId: 5,
                points: 3
              }
            ]
          })
        ).rejects.toMatchObject({ statusCode: 409 });
        await expect(exerciseServices.deleteExerciseService(ids.idempotentExercise)).rejects.toMatchObject({
          statusCode: 409
        });

        const preservedQuestion = await db
          .select({ title: schema.question.title, points: schema.question.points })
          .from(schema.question)
          .where(eq(schema.question.id, idempotentQuestion.id));
        expect(preservedQuestion).toEqual([{ title: 'Idempotent answer', points: 2 }]);
        const preservedAnswers = await db
          .select({ id: schema.questionAnswer.id })
          .from(schema.questionAnswer)
          .where(eq(schema.questionAnswer.submissionId, firstAttempt.id));
        expect(preservedAnswers).toHaveLength(1);

        await expect(
          exerciseServices.createExerciseForCourseService(ids.course, {
            courseId: ids.course,
            lessonId: ids.crossLesson,
            title: 'Cross-course create attempt',
            order: 1
          })
        ).rejects.toMatchObject({ statusCode: 404 });
        await expect(
          exerciseServices.updateExerciseForCourseService(ids.course, ids.invalidExercise, {
            sectionId: ids.crossSection
          })
        ).rejects.toMatchObject({ statusCode: 404 });
        const crossCourseExercises = await db
          .select({ id: schema.exercise.id })
          .from(schema.exercise)
          .where(eq(schema.exercise.lessonId, ids.crossLesson));
        expect(crossCourseExercises).toHaveLength(0);

        const invalidAssetId = randomUUID();
        const videoAnswer = {
          type: 'VIDEO_RECORDING',
          assetId: invalidAssetId,
          storageKey: `recordings/${randomUUID()}.webm`,
          fileName: 'recording.webm',
          mimeType: 'video/webm',
          size: 1024,
          durationSeconds: 20,
          recordedAt: '2026-07-16T00:00:00.000Z',
          uploadedAt: '2026-07-16T00:00:01.000Z',
          provider: 'cloudflare'
        };
        await expect(
          createSubmissionService(
            ids.course,
            ids.videoExercise,
            ids.member,
            [{ questionId: videoQuestion.id, answer: JSON.stringify(videoAnswer) }],
            { idempotencyKey: randomUUID() }
          )
        ).rejects.toMatchObject({ statusCode: 400 });

        const videoSubmissions = await db
          .select({ id: schema.submission.id })
          .from(schema.submission)
          .where(eq(schema.submission.exerciseId, ids.videoExercise));
        const videoAnswers = await db
          .select({ id: schema.questionAnswer.id })
          .from(schema.questionAnswer)
          .innerJoin(schema.submission, eq(schema.questionAnswer.submissionId, schema.submission.id))
          .where(eq(schema.submission.exerciseId, ids.videoExercise));
        const videoAssetUsages = await db
          .select({ id: schema.assetUsage.id })
          .from(schema.assetUsage)
          .where(
            and(
              eq(schema.assetUsage.organizationId, ids.organization),
              eq(schema.assetUsage.targetType, 'submission_answer')
            )
          );
        expect(videoSubmissions).toHaveLength(0);
        expect(videoAnswers).toHaveLength(0);
        expect(videoAssetUsages).toHaveLength(0);

        const validStorageKey = `recordings/${randomUUID()}.webm`;
        await db.insert(schema.asset).values({
          id: validAssetId,
          organizationId: ids.organization,
          kind: 'video',
          provider: 'cloudflare',
          // The service pins the displayed fileName to the locked asset title.
          title: videoAnswer.fileName,
          storageKey: validStorageKey,
          mimeType: 'video/webm',
          byteSize: 1024,
          durationSeconds: 20,
          status: 'active',
          createdByProfileId: ids.profile,
          metadata: {
            source: 'exercise_video_recording',
            courseId: ids.course,
            exerciseId: ids.videoExercise,
            questionId: videoQuestion.id,
            groupMemberId: ids.member
          }
        });
        const validVideoAnswer = {
          ...videoAnswer,
          assetId: validAssetId,
          storageKey: validStorageKey
        };
        const assetUsageBarrier = createAsyncBarrier();
        databaseRaceHooks.afterAssetUsageCreated.mockImplementation(async (assetId: string) => {
          if (assetId !== validAssetId) return;

          await assetUsageBarrier.wait();
        });
        const submissionPromise = createSubmissionService(
          ids.course,
          ids.videoExercise,
          ids.member,
          [{ questionId: videoQuestion.id, answer: JSON.stringify(validVideoAnswer) }],
          { idempotencyKey: randomUUID() }
        );
        // Racing the barrier against the submission turns a pre-barrier
        // rejection into an immediate failure instead of a full test timeout.
        await Promise.race([assetUsageBarrier.reached, submissionPromise]);
        const deletionPromise = assetServices.deleteAssetService(ids.organization, validAssetId);
        const concurrentQuestionMutationPromise = exerciseServices.updateExerciseService(ids.videoExercise, {
          questions: [
            {
              id: videoQuestion.id,
              question: 'Changed while submission is committing',
              questionTypeId: 13,
              points: 2,
              settings: { required: true, maxDurationSeconds: 30 }
            }
          ]
        });
        assetUsageBarrier.release();

        await expect(submissionPromise).resolves.toMatchObject({ exerciseId: ids.videoExercise });
        await expect(deletionPromise).rejects.toMatchObject({ statusCode: 409 });
        await expect(concurrentQuestionMutationPromise).rejects.toMatchObject({ statusCode: 409 });
        databaseRaceHooks.afterAssetUsageCreated.mockResolvedValue(undefined);

        const racedSubmissions = await db
          .select({ id: schema.submission.id })
          .from(schema.submission)
          .where(eq(schema.submission.exerciseId, ids.videoExercise));
        const racedAsset = await db
          .select({ id: schema.asset.id })
          .from(schema.asset)
          .where(eq(schema.asset.id, validAssetId));
        const racedUsages = await db
          .select({ id: schema.assetUsage.id })
          .from(schema.assetUsage)
          .where(eq(schema.assetUsage.assetId, validAssetId));
        expect(racedSubmissions).toHaveLength(1);
        expect(racedAsset).toEqual([{ id: validAssetId }]);
        expect(racedUsages).toHaveLength(1);
      } finally {
        await db.delete(schema.submission).where(inArray(schema.submission.exerciseId, exerciseIds));
        await db.delete(schema.assetUsage).where(eq(schema.assetUsage.assetId, validAssetId));
        await db.delete(schema.asset).where(eq(schema.asset.id, validAssetId));
        await db.delete(schema.exercise).where(inArray(schema.exercise.id, exerciseIds));
        await db.delete(schema.groupmember).where(eq(schema.groupmember.id, ids.member));
        await db.delete(schema.lesson).where(eq(schema.lesson.id, ids.crossLesson));
        await db.delete(schema.courseSection).where(eq(schema.courseSection.id, ids.crossSection));
        await db.delete(schema.course).where(inArray(schema.course.id, [ids.course, ids.crossCourse]));
        await db.delete(schema.group).where(eq(schema.group.id, ids.group));
        await db.delete(schema.organization).where(eq(schema.organization.id, ids.organization));
        await db.delete(schema.profile).where(eq(schema.profile.id, ids.profile));
        await db.delete(schema.user).where(eq(schema.user.id, ids.user));
      }
    },
    DATABASE_INTEGRATION_TEST_TIMEOUT_MS
  );
});
