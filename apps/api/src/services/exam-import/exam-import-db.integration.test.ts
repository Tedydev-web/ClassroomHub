import { randomUUID } from 'node:crypto';

import type { DbOrTxClient } from '@cio/db/drizzle';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createExerciseFromAuthoringPlan: vi.fn(),
  createExamImportPublishPlan: vi.fn(),
  getCourseWithOrgData: vi.fn(),
  isCourseTeamMemberOrOrgAdmin: vi.fn()
}));

vi.mock('@cio/core/config/env', () => ({
  env: { EXAM_IMPORT_ENABLED: 'true', EXAM_ENABLED: 'true' }
}));
vi.mock('@cio/core/services/exercise/exercise', () => ({
  createExerciseFromAuthoringPlan: mocks.createExerciseFromAuthoringPlan
}));
vi.mock('@cio/db/queries/course', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cio/db/queries/course')>();

  return {
    ...actual,
    getCourseWithOrgData: mocks.getCourseWithOrgData
  };
});
vi.mock('@cio/db/queries/group', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cio/db/queries/group')>();

  return {
    ...actual,
    isCourseTeamMemberOrOrgAdmin: mocks.isCourseTeamMemberOrOrgAdmin
  };
});
vi.mock('@cio/exam-import', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@cio/exam-import')>();

  return {
    ...actual,
    createExamImportPublishPlan: mocks.createExamImportPublishPlan
  };
});

const integrationVariable = ['RUN', 'DB', 'INTEGRATION'].join('_');
const runDatabaseIntegration = process['env'][integrationVariable] === '1';

describe.runIf(runDatabaseIntegration)('exam import publish persistence', () => {
  it('keeps a completed checkpoint terminal against stale attempts', async () => {
    const [{ db }, schema, { getJobStep, upsertJobStep }] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('@cio/db/queries/jobs')
    ]);
    const runId = randomUUID();

    try {
      await upsertJobStep({
        domain: 'exam-import',
        runId,
        stepKey: 'source',
        status: 'completed',
        attempt: 1,
        result: { pointer: 'completed' }
      });
      await upsertJobStep({
        domain: 'exam-import',
        runId,
        stepKey: 'source',
        status: 'failed',
        attempt: 2,
        error: { code: 'STALE_ATTEMPT', message: 'Must not overwrite completed state' }
      });

      await expect(getJobStep('exam-import', runId, 'source')).resolves.toMatchObject({
        status: 'completed',
        attempt: 1,
        result: { pointer: 'completed' }
      });
    } finally {
      await db
        .delete(schema.jobStep)
        .where(and(eq(schema.jobStep.domain, 'exam-import'), eq(schema.jobStep.runId, runId)));
    }
  });

  it('serializes concurrent publish requests and creates exactly one exercise', async () => {
    const [{ db }, schema, { publishExamImportService }] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('./exam-import')
    ]);
    const ids = {
      course: randomUUID(),
      exercise: randomUUID(),
      group: randomUUID(),
      import: randomUUID(),
      organization: randomUUID(),
      user: randomUUID()
    };
    const startedAt = new Date().toISOString();
    const scope = {
      organizationId: ids.organization,
      courseId: ids.course,
      userId: ids.user
    };

    try {
      await db.insert(schema.organization).values({
        id: ids.organization,
        name: `Exam import integration ${ids.organization}`,
        siteName: `exam-import-${ids.organization}`
      });
      await db.insert(schema.group).values({
        id: ids.group,
        name: 'Exam import integration group',
        organizationId: ids.organization
      });
      await db.insert(schema.course).values({
        id: ids.course,
        title: 'Exam import integration course',
        description: 'Integration fixture',
        groupId: ids.group,
        slug: `exam-import-${ids.course}`
      });
      await db.insert(schema.examImport).values({
        id: ids.import,
        organizationId: ids.organization,
        courseId: ids.course,
        actorProfileId: null,
        sourceAssetId: null,
        status: 'draft_ready',
        extractor: 'docx',
        startedAt,
        draftReadyAt: startedAt
      });
      await db.insert(schema.examImportDraft).values({
        importId: ids.import,
        draft: { schemaVersion: 1 },
        schemaVersion: 1,
        expiresAt: '2999-01-01T00:00:00.000Z'
      });

      mocks.getCourseWithOrgData.mockResolvedValue({ orgId: ids.organization });
      mocks.isCourseTeamMemberOrOrgAdmin.mockResolvedValue(true);
      mocks.createExamImportPublishPlan.mockReturnValue({
        title: 'Imported exam',
        sections: []
      });
      mocks.createExerciseFromAuthoringPlan.mockImplementation(async (_plan: unknown, dbClient: DbOrTxClient) => {
        const [exercise] = await dbClient
          .insert(schema.exercise)
          .values({
            id: ids.exercise,
            title: 'Imported exam',
            slug: 'test-item',
            courseId: ids.course,
            order: 1
          })
          .returning();
        if (!exercise) {
          throw new Error('Exercise insert returned no row');
        }

        return exercise;
      });

      const results = await Promise.all([
        publishExamImportService(scope, ids.import),
        publishExamImportService(scope, ids.import)
      ]);

      expect(results).toEqual(
        expect.arrayContaining([
          { exerciseId: ids.exercise, replayed: false },
          { exerciseId: ids.exercise, replayed: true }
        ])
      );
      expect(mocks.createExerciseFromAuthoringPlan).toHaveBeenCalledOnce();
    } finally {
      await db.delete(schema.examImportDraft).where(eq(schema.examImportDraft.importId, ids.import));
      await db.delete(schema.examImport).where(eq(schema.examImport.id, ids.import));
      await db.delete(schema.exercise).where(eq(schema.exercise.id, ids.exercise));
      await db.delete(schema.course).where(eq(schema.course.id, ids.course));
      await db.delete(schema.group).where(eq(schema.group.id, ids.group));
      await db.delete(schema.organization).where(eq(schema.organization.id, ids.organization));
    }
  }, 30_000);
  it('publishes into a detached container and its exam when the target is an exam', async () => {
    const [{ db }, schema, { publishExamImportService }] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('./exam-import')
    ]);
    const ids = {
      course: randomUUID(),
      exercise: randomUUID(),
      group: randomUUID(),
      import: randomUUID(),
      organization: randomUUID(),
      user: randomUUID()
    };
    const startedAt = new Date().toISOString();
    const scope = {
      organizationId: ids.organization,
      courseId: ids.course,
      userId: ids.user
    };

    try {
      await db.insert(schema.organization).values({
        id: ids.organization,
        name: `Exam import exam target ${ids.organization}`,
        siteName: `exam-import-exam-${ids.organization}`
      });
      await db.insert(schema.group).values({
        id: ids.group,
        name: 'Exam import exam target group',
        organizationId: ids.organization
      });
      // The exam records who created it, so the actor has to exist for the FK — and a
      // profile is an account, so the account comes first.
      await db.insert(schema.user).values({
        id: ids.user,
        name: 'Exam import integration actor',
        email: `exam-import-${ids.user}@example.test`,
        emailVerified: true
      });
      await db.insert(schema.profile).values({
        id: ids.user,
        fullname: 'Exam import integration actor',
        username: `exam-import-${ids.user}`
      });
      await db.insert(schema.course).values({
        id: ids.course,
        title: 'Exam import exam target course',
        description: 'Integration fixture',
        groupId: ids.group,
        slug: `exam-import-exam-${ids.course}`
      });
      await db.insert(schema.examImport).values({
        id: ids.import,
        organizationId: ids.organization,
        courseId: ids.course,
        actorProfileId: null,
        sourceAssetId: null,
        status: 'draft_ready',
        extractor: 'docx',
        startedAt,
        draftReadyAt: startedAt
      });
      await db.insert(schema.examImportDraft).values({
        importId: ids.import,
        draft: { schemaVersion: 1 },
        schemaVersion: 1,
        expiresAt: '2999-01-01T00:00:00.000Z'
      });

      mocks.getCourseWithOrgData.mockResolvedValue({ orgId: ids.organization });
      mocks.isCourseTeamMemberOrOrgAdmin.mockResolvedValue(true);
      mocks.createExamImportPublishPlan.mockReturnValue({
        title: 'Imported paper',
        sections: []
      });
      mocks.createExerciseFromAuthoringPlan.mockImplementation(async (_plan: unknown, dbClient: DbOrTxClient) => {
        const [exercise] = await dbClient
          .insert(schema.exercise)
          .values({
            id: ids.exercise,
            title: 'Imported paper',
            slug: 'test-item',
            courseId: ids.course,
            order: 1
          })
          .returning();
        if (!exercise) {
          throw new Error('Exercise insert returned no row');
        }

        return exercise;
      });
      // The spies are module-level, so a count assertion here would carry the calls the
      // test above made.
      mocks.createExerciseFromAuthoringPlan.mockClear();

      const published = await publishExamImportService(scope, ids.import, 'exam');

      expect(published.exerciseId).toBe(ids.exercise);
      expect(published.examId).toBeTruthy();
      expect(published.replayed).toBe(false);

      // Detached: an enrolled student must not be able to open the paper untimed, which is
      // exactly what a container with no course and no lesson prevents.
      const [container] = await db
        .select({ courseId: schema.exercise.courseId, lessonId: schema.exercise.lessonId })
        .from(schema.exercise)
        .where(eq(schema.exercise.id, ids.exercise))
        .limit(1);
      expect(container).toEqual({ courseId: null, lessonId: null });

      const [exam] = await db
        .select({ exerciseId: schema.exam.exerciseId, courseId: schema.exam.courseId, status: schema.exam.status })
        .from(schema.exam)
        .where(eq(schema.exam.id, published.examId!))
        .limit(1);
      expect(exam).toEqual({ exerciseId: ids.exercise, courseId: ids.course, status: 'draft' });

      // Replaying resolves the same exam rather than building a second one.
      const replayed = await publishExamImportService(scope, ids.import, 'exam');
      expect(replayed).toEqual({ exerciseId: ids.exercise, examId: published.examId, replayed: true });
      expect(mocks.createExerciseFromAuthoringPlan).toHaveBeenCalledOnce();
    } finally {
      await db.delete(schema.exam).where(eq(schema.exam.exerciseId, ids.exercise));
      await db.delete(schema.examImportDraft).where(eq(schema.examImportDraft.importId, ids.import));
      await db.delete(schema.examImport).where(eq(schema.examImport.id, ids.import));
      await db.delete(schema.exercise).where(eq(schema.exercise.id, ids.exercise));
      await db.delete(schema.course).where(eq(schema.course.id, ids.course));
      await db.delete(schema.profile).where(eq(schema.profile.id, ids.user));
      await db.delete(schema.user).where(eq(schema.user.id, ids.user));
      await db.delete(schema.group).where(eq(schema.group.id, ids.group));
      await db.delete(schema.organization).where(eq(schema.organization.id, ids.organization));
    }
  }, 30_000);
});
