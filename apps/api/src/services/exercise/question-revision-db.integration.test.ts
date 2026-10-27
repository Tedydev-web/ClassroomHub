import { randomUUID } from 'node:crypto';

import { config } from 'dotenv';
import { eq, inArray, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { parseAssessmentItemDefinition } from '@cio/question-types';

config();

const postCommitMocks = vi.hoisted(() => ({
  emitCourseWebhookEvent: vi.fn().mockResolvedValue(undefined),
  enqueueTransactionalEmail: vi.fn().mockResolvedValue(undefined),
  evaluateCourseCertification: vi.fn().mockResolvedValue(undefined),
  syncComplianceProgressFromSubmission: vi.fn().mockResolvedValue(undefined)
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

/**
 * Integration contract for the question-revision service gateway at
 * `@cio/core/services/assessment/question-revision` — the single owner of
 * canonical publish, legacy materialization, and attempted-question resolution.
 *
 * Authored canonical publishes are accepted only for internal composite
 * assessment items; live legacy question types fail closed (no canonical
 * scoring engine exists for them) and keep flowing through the legacy editor
 * plus lazy materialization.
 *
 * The gateway is loaded dynamically inside the guarded suite so the default
 * (non-integration) test run never evaluates the import. The local types
 * below are the asserted contract surface.
 */
const QUESTION_REVISION_GATEWAY_SPECIFIER = '@cio/core/services/assessment/question-revision';

type PublishedQuestionRevision = {
  id: string;
  questionId: number;
  revision: number;
  contentHash: string;
};

type AttemptedQuestionResolutionEntry = {
  questionId: number;
  questionRevisionId: string;
  archivedAt: string | null;
  /** Two-decimal maximum derived from the exact attempted definition. */
  maxScore: number;
  /** Grading capabilities derived from the exact attempted definition. */
  capabilities: { gradingMode: string; autoGradable: boolean; manualGradingRequired: boolean };
};

type QuestionRevisionGatewayModule = {
  publishQuestionRevision: (input: {
    questionId: number;
    expectedRevision: number;
    definition: unknown;
  }) => Promise<PublishedQuestionRevision>;
  materializeLegacyQuestionRevision: (questionId: number, dbClient?: unknown) => Promise<PublishedQuestionRevision>;
  resolveAttemptedQuestionSet: (submissionId: string) => Promise<AttemptedQuestionResolutionEntry[]>;
};

type QuestionRevisionRowSnapshot = {
  id: string;
  revision: number;
  contentHash: string;
  definition: unknown;
};

type QuestionArchiveSnapshot = {
  exists: boolean;
  archivedAt: string | null;
  currentRevisionId: string | null;
};

/**
 * Flattens an error and its `cause` chain into one string: the drizzle driver
 * wraps database errors ("Failed query: ..."), so constraint/trigger messages
 * only surface on the inner cause.
 */
function errorChainText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    parts.push(current.message);
    current = current.cause;
  }
  if (current != null) parts.push(String(current));

  return parts.join(' | ');
}

/** Rewrites one authored text occurrence so a definition gets a new content hash without pinning the kernel shape. */
function mutateDefinitionText(definition: unknown, search: string, replacement: string): unknown {
  const serialized = JSON.stringify(definition);
  // The legacy adapter maps the question title into authored prompt HTML; if this
  // stops holding, the mutation would silently become a hash no-op, so fail loudly.
  expect(serialized).toContain(search);

  return JSON.parse(serialized.replaceAll(search, replacement)) as unknown;
}

const runDatabaseIntegration = process.env.RUN_DB_INTEGRATION === '1';

describe.runIf(runDatabaseIntegration)('question revision persistence and archive contract', () => {
  it('enforces immutable revisions, answer linkage, publish serialization, and archive history', async () => {
    const [{ db }, schema, submissionServices, exerciseServices] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('../submission/submission'),
      import('@cio/core/services/exercise/exercise')
    ]);
    const profileId = randomUUID();
    const ids = {
      course: randomUUID(),
      draftExercise: randomUUID(),
      exercise: randomUUID(),
      group: randomUUID(),
      member: randomUUID(),
      organization: randomUUID(),
      profile: profileId,
      user: profileId
    };
    const exerciseIds = [ids.exercise, ids.draftExercise];
    const attemptedQuestionTitle = 'Archive-bound attempted question';
    const keptQuestionTitle = 'Kept active question';
    const draftQuestionTitle = 'Unattempted draft question';

    try {
      const gateway = (await import(
        /* @vite-ignore */ QUESTION_REVISION_GATEWAY_SPECIFIER
      )) as QuestionRevisionGatewayModule;

      async function listQuestionRevisions(questionId: number): Promise<QuestionRevisionRowSnapshot[]> {
        const rows = await db.execute(sql`
          SELECT id, revision, content_hash, definition
          FROM question_revision
          WHERE question_id = ${questionId}
          ORDER BY revision ASC
        `);

        return [...rows].map((row) => ({
          id: String(row.id),
          revision: Number(row.revision),
          contentHash: String(row.content_hash),
          definition: row.definition
        }));
      }

      async function getQuestionArchiveSnapshot(questionId: number): Promise<QuestionArchiveSnapshot> {
        const rows = await db.execute(sql`
          SELECT archived_at, current_revision_id
          FROM question
          WHERE id = ${questionId}
        `);
        const [row] = [...rows];
        if (!row) return { exists: false, archivedAt: null, currentRevisionId: null };

        return {
          exists: true,
          archivedAt: row.archived_at == null ? null : String(row.archived_at),
          currentRevisionId: row.current_revision_id == null ? null : String(row.current_revision_id)
        };
      }

      async function listAnswerRevisionLinks(
        submissionId: string
      ): Promise<Array<{ questionId: number; questionRevisionId: string | null; score: number | null }>> {
        const rows = await db.execute(sql`
          SELECT question_id, question_revision_id, score
          FROM question_answer
          WHERE submission_id = ${submissionId}::uuid
          ORDER BY question_id ASC
        `);

        return [...rows].map((row) => ({
          questionId: Number(row.question_id),
          questionRevisionId: row.question_revision_id == null ? null : String(row.question_revision_id),
          score: row.score == null ? null : Number(row.score)
        }));
      }

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
        .values([{ id: 5, label: 'Short answer', typename: 'SHORT_ANSWER' }])
        .onConflictDoNothing();

      const email = `${ids.user}@example.com`;
      await db.insert(schema.user).values({ id: ids.user, name: 'Revision integration student', email });
      await db.insert(schema.profile).values({
        id: ids.profile,
        fullname: 'Revision integration student',
        username: `revision-${ids.profile}`,
        email
      });
      await db.insert(schema.organization).values({
        id: ids.organization,
        name: 'Revision integration organization',
        siteName: `revision-${ids.organization}`
      });
      await db.insert(schema.group).values({
        id: ids.group,
        name: 'Revision integration group',
        organizationId: ids.organization
      });
      await db.insert(schema.course).values({
        id: ids.course,
        groupId: ids.group,
        title: 'Revision integration course',
        description: 'Revision integration course'
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
          id: ids.exercise,
          courseId: ids.course,
          title: 'Revision lifecycle exercise',
          slug: 'test-item',
          allowMultipleAttempts: true,
          order: 1
        },
        {
          id: ids.draftExercise,
          courseId: ids.course,
          title: 'Draft deletion exercise',
          slug: 'test-item',
          allowMultipleAttempts: true,
          order: 2
        }
      ]);
      const questions = await db
        .insert(schema.question)
        .values([
          {
            exerciseId: ids.exercise,
            title: attemptedQuestionTitle,
            questionTypeId: 5,
            points: 2,
            settings: { required: true }
          },
          {
            exerciseId: ids.exercise,
            title: keptQuestionTitle,
            questionTypeId: 5,
            points: 2,
            settings: { required: true }
          },
          {
            exerciseId: ids.draftExercise,
            title: draftQuestionTitle,
            questionTypeId: 16,
            points: 2,
            settings: { required: true }
          }
        ])
        .returning({ id: schema.question.id, title: schema.question.title });
      const attemptedQuestion = questions.find((question) => question.title === attemptedQuestionTitle);
      const keptQuestion = questions.find((question) => question.title === keptQuestionTitle);
      const draftQuestion = questions.find((question) => question.title === draftQuestionTitle);
      expect(attemptedQuestion).toBeDefined();
      expect(keptQuestion).toBeDefined();
      expect(draftQuestion).toBeDefined();
      if (!attemptedQuestion || !keptQuestion || !draftQuestion) {
        throw new Error('Revision integration questions were not created');
      }

      // --- Legacy first-attempt materialization + idempotency replay (no double materialization) ---
      const idempotencyKey = randomUUID();
      const answersPayload = [
        { questionId: attemptedQuestion.id, answer: 'first attempt answer one' },
        { questionId: keptQuestion.id, answer: 'first attempt answer two' }
      ];
      const [firstAttempt, replayedAttempt] = await Promise.all([
        submissionServices.createSubmissionService(ids.course, ids.exercise, ids.member, answersPayload, {
          idempotencyKey
        }),
        submissionServices.createSubmissionService(ids.course, ids.exercise, ids.member, answersPayload, {
          idempotencyKey
        })
      ]);
      expect(replayedAttempt.id).toBe(firstAttempt.id);

      const attemptedRevisionsAfterFirst = await listQuestionRevisions(attemptedQuestion.id);
      const keptRevisionsAfterFirst = await listQuestionRevisions(keptQuestion.id);
      expect(attemptedRevisionsAfterFirst.map((revision) => revision.revision)).toEqual([1]);
      expect(keptRevisionsAfterFirst.map((revision) => revision.revision)).toEqual([1]);
      const attemptedRevisionOne = attemptedRevisionsAfterFirst[0];
      const keptRevisionOne = keptRevisionsAfterFirst[0];

      // Every new answer row links the exact materialized revision.
      const firstAttemptLinks = await listAnswerRevisionLinks(firstAttempt.id);
      expect(firstAttemptLinks).toEqual([
        expect.objectContaining({ questionId: attemptedQuestion.id, questionRevisionId: attemptedRevisionOne.id }),
        expect.objectContaining({ questionId: keptQuestion.id, questionRevisionId: keptRevisionOne.id })
      ]);

      // Materialized questions expose the revision as the current pointer.
      const attemptedPointerAfterFirst = await getQuestionArchiveSnapshot(attemptedQuestion.id);
      expect(attemptedPointerAfterFirst).toMatchObject({
        exists: true,
        archivedAt: null,
        currentRevisionId: attemptedRevisionOne.id
      });

      // --- Reuse on second attempt: no new revision rows, same linkage ---
      const secondAttempt = await submissionServices.createSubmissionService(
        ids.course,
        ids.exercise,
        ids.member,
        [
          { questionId: attemptedQuestion.id, answer: 'second attempt answer one' },
          { questionId: keptQuestion.id, answer: 'second attempt answer two' }
        ],
        { idempotencyKey: randomUUID() }
      );
      expect((await listQuestionRevisions(attemptedQuestion.id)).map((revision) => revision.revision)).toEqual([1]);
      const secondAttemptLinks = await listAnswerRevisionLinks(secondAttempt.id);
      expect(secondAttemptLinks).toEqual([
        expect.objectContaining({ questionId: attemptedQuestion.id, questionRevisionId: attemptedRevisionOne.id }),
        expect.objectContaining({ questionId: keptQuestion.id, questionRevisionId: keptRevisionOne.id })
      ]);

      // Authored canonical publishing fails closed for live legacy questions;
      // their existing materialized revision remains the immutable attempt source.
      await expect(
        gateway.publishQuestionRevision({
          questionId: attemptedQuestion.id,
          expectedRevision: 1,
          definition: mutateDefinitionText(
            attemptedRevisionOne.definition,
            attemptedQuestionTitle,
            `${attemptedQuestionTitle} authored`
          )
        })
      ).rejects.toMatchObject({ statusCode: 409 });
      expect((await listQuestionRevisions(attemptedQuestion.id)).map((revision) => revision.revision)).toEqual([1]);

      // --- Publish lifecycle on an internal composite assessment item ---
      const definitionA = mutateDefinitionText(
        attemptedRevisionOne.definition,
        attemptedQuestionTitle,
        draftQuestionTitle
      );
      const definitionB = mutateDefinitionText(definitionA, draftQuestionTitle, `${draftQuestionTitle} v2`);

      const revisionOne = await gateway.publishQuestionRevision({
        questionId: draftQuestion.id,
        expectedRevision: 0,
        definition: definitionA
      });
      expect(revisionOne).toMatchObject({ questionId: draftQuestion.id, revision: 1 });
      expect(await getQuestionArchiveSnapshot(draftQuestion.id)).toMatchObject({
        currentRevisionId: revisionOne.id
      });

      // Expected-revision conflict: a stale expectation must fail without writing.
      await expect(
        gateway.publishQuestionRevision({
          questionId: draftQuestion.id,
          expectedRevision: 0,
          definition: mutateDefinitionText(definitionA, draftQuestionTitle, `${draftQuestionTitle} stale`)
        })
      ).rejects.toMatchObject({ statusCode: 409 });
      expect((await listQuestionRevisions(draftQuestion.id)).map((revision) => revision.revision)).toEqual([1]);

      // Content-hash no-op: republishing the current content creates no row and keeps the pointer.
      const noOpResult = await gateway.publishQuestionRevision({
        questionId: draftQuestion.id,
        expectedRevision: 1,
        definition: definitionA
      });
      expect(noOpResult).toMatchObject({ id: revisionOne.id, revision: 1 });
      expect((await listQuestionRevisions(draftQuestion.id)).map((revision) => revision.revision)).toEqual([1]);

      const revisionTwo = await gateway.publishQuestionRevision({
        questionId: draftQuestion.id,
        expectedRevision: 1,
        definition: definitionB
      });
      expect(revisionTwo).toMatchObject({ questionId: draftQuestion.id, revision: 2 });

      // A-B-A: returning to earlier content creates a third monotonic revision with the original hash.
      const revisionThree = await gateway.publishQuestionRevision({
        questionId: draftQuestion.id,
        expectedRevision: 2,
        definition: definitionA
      });
      expect(revisionThree).toMatchObject({ questionId: draftQuestion.id, revision: 3 });
      const revisionsAfterAba = await listQuestionRevisions(draftQuestion.id);
      expect(revisionsAfterAba.map((revision) => revision.revision)).toEqual([1, 2, 3]);
      expect(revisionsAfterAba[2].contentHash).toBe(revisionsAfterAba[0].contentHash);
      expect(revisionsAfterAba[2].contentHash).not.toBe(revisionsAfterAba[1].contentHash);

      // Concurrent publish serialization: same expected revision, exactly one winner, no gaps.
      const concurrentResults = await Promise.allSettled([
        gateway.publishQuestionRevision({
          questionId: draftQuestion.id,
          expectedRevision: 3,
          definition: mutateDefinitionText(definitionA, draftQuestionTitle, `${draftQuestionTitle} racer-a`)
        }),
        gateway.publishQuestionRevision({
          questionId: draftQuestion.id,
          expectedRevision: 3,
          definition: mutateDefinitionText(definitionA, draftQuestionTitle, `${draftQuestionTitle} racer-b`)
        })
      ]);
      const fulfilledPublishes = concurrentResults.filter((result) => result.status === 'fulfilled');
      const rejectedPublishes = concurrentResults.filter((result) => result.status === 'rejected');
      expect(fulfilledPublishes).toHaveLength(1);
      expect(rejectedPublishes).toHaveLength(1);
      expect((await listQuestionRevisions(draftQuestion.id)).map((revision) => revision.revision)).toEqual([
        1, 2, 3, 4
      ]);

      // Exercise metadata and canonical publishes share one transaction. A stale
      // canonical revision must roll back the metadata update that preceded it.
      const parsedAtomicDefinition = parseAssessmentItemDefinition(definitionA);
      expect(parsedAtomicDefinition.success).toBe(true);
      if (!parsedAtomicDefinition.success) {
        throw new Error('Atomic rollback fixture is not a valid assessment definition');
      }
      await expect(
        exerciseServices.updateExerciseService(ids.draftExercise, {
          title: 'This title must be rolled back',
          assessmentItemMutations: [
            {
              action: 'publish',
              clientMutationId: 'stale-publish',
              questionId: draftQuestion.id,
              title: draftQuestionTitle,
              expectedRevision: 3,
              definition: parsedAtomicDefinition.data
            }
          ]
        })
      ).rejects.toMatchObject({ statusCode: 409 });
      const draftExerciseRows = await db.execute(sql`SELECT title FROM exercise WHERE id = ${ids.draftExercise}::uuid`);
      expect([...draftExerciseRows][0]?.title).toBe('Draft deletion exercise');
      expect((await listQuestionRevisions(draftQuestion.id)).map((revision) => revision.revision)).toEqual([
        1, 2, 3, 4
      ]);

      // Historical answers still reference their attempted revisions after unrelated canonical publishes.
      expect(await listAnswerRevisionLinks(firstAttempt.id)).toEqual([
        expect.objectContaining({ questionId: attemptedQuestion.id, questionRevisionId: attemptedRevisionOne.id }),
        expect.objectContaining({ questionId: keptQuestion.id, questionRevisionId: keptRevisionOne.id })
      ]);

      // --- Row immutability and pointer ownership are database-enforced ---
      const tamperError = await db
        .execute(
          sql`
          UPDATE question_revision
          SET content_hash = 'tampered'
          WHERE id = ${attemptedRevisionOne.id}::uuid
        `
        )
        .then(
          () => null,
          (error: unknown) => error
        );
      expect(tamperError).not.toBeNull();
      expect(errorChainText(tamperError)).toMatch(/immutable/i);

      const foreignPointerError = await db
        .execute(
          sql`
          UPDATE question
          SET current_revision_id = ${attemptedRevisionOne.id}::uuid
          WHERE id = ${keptQuestion.id}
        `
        )
        .then(
          () => null,
          (error: unknown) => error
        );
      expect(foreignPointerError).not.toBeNull();
      expect(errorChainText(foreignPointerError)).toMatch(/foreign key|constraint/i);

      // --- Removing an attempted question archives it and preserves history ---
      const removalTimestamp = new Date().toISOString();
      await exerciseServices.updateExerciseService(ids.exercise, {
        questions: [
          {
            id: attemptedQuestion.id,
            question: attemptedQuestionTitle,
            questionTypeId: 5,
            points: 2,
            settings: { required: true },
            deletedAt: removalTimestamp
          },
          {
            id: keptQuestion.id,
            question: keptQuestionTitle,
            questionTypeId: 5,
            points: 2,
            settings: { required: true }
          }
        ]
      });

      const archivedSnapshot = await getQuestionArchiveSnapshot(attemptedQuestion.id);
      expect(archivedSnapshot.exists).toBe(true);
      expect(archivedSnapshot.archivedAt).not.toBeNull();
      expect((await listQuestionRevisions(attemptedQuestion.id)).map((revision) => revision.revision)).toEqual([1]);
      expect(await listAnswerRevisionLinks(firstAttempt.id)).toHaveLength(2);

      // Archived questions cannot receive new revisions.
      await expect(
        gateway.publishQuestionRevision({
          questionId: attemptedQuestion.id,
          expectedRevision: 1,
          definition: mutateDefinitionText(
            attemptedRevisionOne.definition,
            attemptedQuestionTitle,
            `${attemptedQuestionTitle} post-archive`
          )
        })
      ).rejects.toBeInstanceOf(Error);

      // --- Archived question leaves active delivery ---
      const postArchiveAttempt = await submissionServices.createSubmissionService(
        ids.course,
        ids.exercise,
        ids.member,
        [{ questionId: keptQuestion.id, answer: 'post-archive answer' }],
        { idempotencyKey: randomUUID() }
      );
      const postArchiveLinks = await listAnswerRevisionLinks(postArchiveAttempt.id);
      expect(postArchiveLinks).toEqual([
        expect.objectContaining({ questionId: keptQuestion.id, questionRevisionId: keptRevisionOne.id })
      ]);

      await expect(
        submissionServices.createSubmissionService(
          ids.course,
          ids.exercise,
          ids.member,
          [
            { questionId: attemptedQuestion.id, answer: 'answer for an archived question' },
            { questionId: keptQuestion.id, answer: 'kept answer' }
          ],
          { idempotencyKey: randomUUID() }
        )
      ).rejects.toMatchObject({ statusCode: 400 });

      // Invalid submissions leave nothing behind: no submission row, no new
      // answers, and no new revisions survive the failed attempt.
      const submissionCountRows = await db.execute(
        sql`SELECT count(*)::int AS count FROM submission WHERE exercise_id = ${ids.exercise}::uuid`
      );
      expect(Number([...submissionCountRows][0]?.count)).toBe(3);
      expect((await listQuestionRevisions(attemptedQuestion.id)).map((revision) => revision.revision)).toEqual([1]);
      expect((await listQuestionRevisions(keptQuestion.id)).map((revision) => revision.revision)).toEqual([1]);

      // --- Archived question stays available to historical grading ---
      const attemptedSet = await gateway.resolveAttemptedQuestionSet(firstAttempt.id);
      expect(attemptedSet).toHaveLength(2);
      const attemptedEntry = attemptedSet.find((entry) => entry.questionId === attemptedQuestion.id);
      const keptEntry = attemptedSet.find((entry) => entry.questionId === keptQuestion.id);
      expect(attemptedEntry).toMatchObject({ questionRevisionId: attemptedRevisionOne.id });
      expect(attemptedEntry?.archivedAt).not.toBeNull();
      expect(keptEntry).toMatchObject({ questionRevisionId: keptRevisionOne.id, archivedAt: null });

      // Semantic fields derive from the exact attempted definition: legacy
      // SHORT_ANSWER (2 points) adapts to a manual text interaction, so the
      // maximum matches the attempted points even after later publishes.
      expect(attemptedEntry?.maxScore).toBe(2);
      expect(attemptedEntry?.capabilities.manualGradingRequired).toBe(true);
      expect(keptEntry?.maxScore).toBe(2);

      const gradedSubmission = await submissionServices.updateSubmissionGradesBatch(firstAttempt.id, ids.course, {
        answers: [
          { questionId: attemptedQuestion.id, points: 1.5 },
          { questionId: keptQuestion.id, points: 2 }
        ],
        total: 3.5
      });
      expect(gradedSubmission).toMatchObject({ id: firstAttempt.id, gradingState: 'completed', score: 3.5 });
      const gradedLinks = await listAnswerRevisionLinks(firstAttempt.id);
      expect(gradedLinks).toEqual([
        expect.objectContaining({ questionId: attemptedQuestion.id, score: 1.5 }),
        expect.objectContaining({ questionId: keptQuestion.id, score: 2 })
      ]);

      // --- Unattempted internal drafts are hard-deleted together with their revisions ---
      expect((await listQuestionRevisions(draftQuestion.id)).map((revision) => revision.revision)).toEqual([
        1, 2, 3, 4
      ]);

      await exerciseServices.updateExerciseService(ids.draftExercise, {
        questions: [
          {
            id: draftQuestion.id,
            question: draftQuestionTitle,
            questionTypeId: 16,
            points: 2,
            settings: { required: true },
            deletedAt: new Date().toISOString()
          }
        ]
      });
      expect((await getQuestionArchiveSnapshot(draftQuestion.id)).exists).toBe(false);
      expect(await listQuestionRevisions(draftQuestion.id)).toHaveLength(0);
    } finally {
      await db.delete(schema.submission).where(inArray(schema.submission.exerciseId, exerciseIds));
      await db.delete(schema.exercise).where(inArray(schema.exercise.id, exerciseIds));
      await db.delete(schema.groupmember).where(eq(schema.groupmember.id, ids.member));
      await db.delete(schema.course).where(eq(schema.course.id, ids.course));
      await db.delete(schema.group).where(eq(schema.group.id, ids.group));
      await db.delete(schema.organization).where(eq(schema.organization.id, ids.organization));
      await db.delete(schema.profile).where(eq(schema.profile.id, ids.profile));
      await db.delete(schema.user).where(eq(schema.user.id, ids.user));
    }
  }, 60_000);
});
