import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

/**
 * Deleting an exam and finding it again.
 *
 * Soft delete was already implemented and already unreachable in practice: the list
 * excluded deleted exams unconditionally, so once an exam was deleted nothing could ever
 * name it, and the restore that exists for it had no caller. The claim under test is that
 * a deleted exam is out of the ordinary list and still findable on request.
 */
const integrationVariable = ['RUN', 'DB', 'INTEGRATION'].join('_');
const runDatabaseIntegration = process['env'][integrationVariable] === '1';

describe.runIf(runDatabaseIntegration)('deleting and restoring an exam', () => {
  async function load() {
    const [{ db }, schema, service] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('./exam')
    ]);
    return { db, schema, service };
  }

  async function seedCourseWithExam(db: any, schema: any) {
    const suffix = randomUUID().slice(0, 8);

    const [organization] = await db
      .insert(schema.organization)
      .values({ name: `Org ${suffix}` })
      .returning({ id: schema.organization.id });
    const [user] = await db
      .insert(schema.user)
      .values({ id: randomUUID(), name: 'T', email: `t-${suffix}@test.local` })
      .returning({ id: schema.user.id });
    await db.insert(schema.profile).values({ id: user.id, fullname: 'T', username: `t-${suffix}` });

    const [group] = await db
      .insert(schema.group)
      .values({ organizationId: organization.id, name: `Group ${suffix}` })
      .returning({ id: schema.group.id });
    const [course] = await db
      .insert(schema.course)
      .values({ title: `Course ${suffix}`, description: '', groupId: group.id, slug: `c-${suffix}` })
      .returning({ id: schema.course.id });

    const { createExamContainer } = await import('./exam-container');
    const exerciseId = await createExamContainer(`Paper ${suffix}`, db);

    const [exam] = await db
      .insert(schema.exam)
      .values({
        organizationId: organization.id,
        courseId: course.id,
        exerciseId,
        title: 'Deletable',
        slug: randomUUID().replace(/-/g, '').slice(0, 16),
        createdBy: user.id
      })
      .returning({ id: schema.exam.id });

    return { courseId: course.id as string, examId: exam.id as string };
  }

  it('takes a deleted exam out of the list, and gives it back when asked for', async () => {
    const { db, schema, service } = await load();
    const { courseId, examId } = await seedCourseWithExam(db, schema);

    expect((await service.listExamsService(courseId)).map((exam: { id: string }) => exam.id)).toContain(examId);

    await service.deleteExamService(examId);

    expect((await service.listExamsService(courseId)).map((exam: { id: string }) => exam.id)).not.toContain(examId);

    const withDeleted = await service.listExamsService(courseId, true);
    const deleted = withDeleted.find((exam: { id: string }) => exam.id === examId);

    expect(deleted).toBeDefined();
    expect(deleted?.deletedAt).not.toBeNull();
  });

  it('puts a restored exam back in the ordinary list', async () => {
    const { db, schema, service } = await load();
    const { courseId, examId } = await seedCourseWithExam(db, schema);

    await service.deleteExamService(examId);
    await service.restoreExamService(examId);

    const listed = await service.listExamsService(courseId);
    const restored = listed.find((exam: { id: string }) => exam.id === examId);

    expect(restored).toBeDefined();
    expect(restored?.deletedAt).toBeNull();
  });
});
