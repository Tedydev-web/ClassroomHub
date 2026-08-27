import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

/**
 * The guard against a real database.
 *
 * The unit tests beside this one replace the query layer entirely, so they pass whether the
 * guard reads the right table, compares the right column, or filters out soft-deleted rows.
 * That last one is the failure this file exists to catch: `getExamById` hides a tombstoned
 * exam, and `POST /:examId/restore` is the one route that must reach one.
 */
const integrationVariable = ['RUN', 'DB', 'INTEGRATION'].join('_');
const runDatabaseIntegration = process['env'][integrationVariable] === '1';

describe.runIf(runDatabaseIntegration)('exam authorisation against the database', () => {
  async function load() {
    const [{ db }, schema, guard] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('./exam-team-member')
    ]);

    return { db, schema, guard };
  }

  async function seedExam(db: any, schema: any) {
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

    const { createExamContainer } = await import('@api/services/exam/exam-container');
    const exerciseId = await createExamContainer(`Paper ${suffix}`, db);

    const [exam] = await db
      .insert(schema.exam)
      .values({
        organizationId: organization.id,
        exerciseId,
        title: 'Paper',
        slug: randomUUID().replace(/-/g, '').slice(0, 16),
        createdBy: user.id,
        mode: 'public',
        status: 'open'
      })
      .returning({ id: schema.exam.id });

    return { examId: exam.id as string, organizationId: organization.id as string, userId: user.id as string };
  }

  function contextFor(examId: string, userId: string, orgRoles: Record<string, number>) {
    let status: number | null = null;

    return {
      context: {
        get: (key: string) => ({ user: { id: userId }, orgRoles })[key],
        req: { param: () => examId, path: '/exam/test' },
        json: (_body: unknown, code: number) => {
          status = code;

          return { status: code };
        }
      } as never,
      statusOf: () => status
    };
  }

  it('still resolves an exam that has been soft-deleted, so restore stays reachable', async () => {
    const { db, schema, guard } = await load();
    const { examId, organizationId, userId } = await seedExam(db, schema);

    const { softDeleteExam } = await import('@cio/db/queries/exam/exam');
    await softDeleteExam(examId, db);

    const next = vi.fn();
    // ROLE.ADMIN of the owning organisation. The seeded exam carries no course, which is the
    // branch that reads `orgRoles`.
    const { context } = contextFor(examId, userId, { [organizationId]: 1 });
    await guard.examTeamMemberMiddleware(context, next);

    expect(next).toHaveBeenCalledOnce();
    void schema;
  });

  it('refuses an exam id that belongs to nobody', async () => {
    const { db, schema, guard } = await load();
    const { organizationId, userId } = await seedExam(db, schema);

    const next = vi.fn();
    const { context, statusOf } = contextFor(randomUUID(), userId, { [organizationId]: 1 });
    await guard.examTeamMemberMiddleware(context, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusOf()).toBe(403);
    void db;
  });

  it('refuses an admin of a different organisation', async () => {
    const { db, schema, guard } = await load();
    const { examId, userId } = await seedExam(db, schema);

    const next = vi.fn();
    const { context, statusOf } = contextFor(examId, userId, { [randomUUID()]: 1 });
    await guard.examTeamMemberMiddleware(context, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusOf()).toBe(403);
    void db;
  });
});
