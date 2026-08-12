import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

/**
 * Proves the exam tables enforce their own rules, rather than trusting the code
 * above them to. Every case here is a constraint the database must refuse or
 * permit on its own.
 *
 * Gated on the same environment variable as the other database-backed tests, and
 * living in `apps/api` for the same reason they do: `packages/db` has no Vitest
 * configuration, so a test placed beside the schema would never run.
 */
const integrationVariable = ['RUN', 'DB', 'INTEGRATION'].join('_');
const runDatabaseIntegration = process['env'][integrationVariable] === '1';

describe.runIf(runDatabaseIntegration)('exam schema constraints', () => {
  async function loadDb() {
    const [{ db }, schema] = await Promise.all([import('@cio/db/drizzle'), import('@cio/db/schema')]);
    return { db, schema };
  }

  /** A container is an exercise carrying no course and no lesson — see phase 8. */
  async function createContainer(db: Awaited<ReturnType<typeof loadDb>>['db'], schema: any) {
    const [exercise] = await db
      .insert(schema.exercise)
      .values({ title: `container ${randomUUID()}`, assignmentMode: 'SELECTED_STUDENTS' })
      .returning({ id: schema.exercise.id });
    return exercise.id as string;
  }

  /**
   * Builds its own fixtures rather than borrowing whatever happens to be in the
   * database, so the suite runs against an empty schema as well as a populated one.
   * `profile.id` is a foreign key to better-auth's `user`, hence the chain.
   */
  async function createTeacher(db: Awaited<ReturnType<typeof loadDb>>['db'], schema: any) {
    const suffix = randomUUID().slice(0, 8);
    const [user] = await db
      .insert(schema.user)
      .values({ id: randomUUID(), name: 'Test Teacher', email: `teacher-${suffix}@test.local` })
      .returning({ id: schema.user.id });
    const [profile] = await db
      .insert(schema.profile)
      .values({ id: user.id, fullname: 'Test Teacher', username: `teacher-${suffix}` })
      .returning({ id: schema.profile.id });
    return profile.id as string;
  }

  async function createOrganization(db: Awaited<ReturnType<typeof loadDb>>['db'], schema: any) {
    const [organization] = await db
      .insert(schema.organization)
      .values({ name: `Org ${randomUUID().slice(0, 8)}` })
      .returning({ id: schema.organization.id });
    return organization.id as string;
  }

  async function createExam(
    db: Awaited<ReturnType<typeof loadDb>>['db'],
    schema: any,
    overrides: Record<string, unknown> = {}
  ) {
    const organizationId = await createOrganization(db, schema);
    const createdBy = await createTeacher(db, schema);
    const exerciseId = await createContainer(db, schema);

    const [exam] = await db
      .insert(schema.exam)
      .values({
        organizationId,
        exerciseId,
        title: 'Paper',
        slug: randomUUID().replace(/-/g, '').slice(0, 16),
        createdBy,
        ...overrides
      })
      .returning({ id: schema.exam.id, exerciseId: schema.exam.exerciseId });

    return exam as { id: string; exerciseId: string };
  }

  it('accepts two anonymous sitters who type the same name', async () => {
    const { db, schema } = await loadDb();
    const exam = await createExam(db, schema);

    const rows = await db
      .insert(schema.examAttempt)
      .values([
        { examId: exam.id, displayName: 'Nguyễn Văn A', tokenHash: randomUUID(), startedAt: new Date().toISOString() },
        { examId: exam.id, displayName: 'Nguyễn Văn A', tokenHash: randomUUID(), startedAt: new Date().toISOString() }
      ])
      .returning({ id: schema.examAttempt.id });

    expect(rows).toHaveLength(2);
  });

  it('refuses an attempt that names nobody', async () => {
    const { db, schema } = await loadDb();
    const exam = await createExam(db, schema);

    await expect(
      db.insert(schema.examAttempt).values({
        examId: exam.id,
        tokenHash: randomUUID(),
        startedAt: new Date().toISOString()
      })
    ).rejects.toThrow();
  });

  it('takes an attempt with a profile and no declared name', async () => {
    const { db, schema } = await loadDb();
    const exam = await createExam(db, schema);
    const profileId = await createTeacher(db, schema);

    const [attempt] = await db
      .insert(schema.examAttempt)
      .values({
        examId: exam.id,
        profileId,
        tokenHash: randomUUID(),
        startedAt: new Date().toISOString()
      })
      .returning({ id: schema.examAttempt.id });

    expect(attempt.id).toBeTruthy();
  });

  it('removes the attempts when the exam row goes', async () => {
    const { db, schema } = await loadDb();
    const exam = await createExam(db, schema);
    await db.insert(schema.examAttempt).values({
      examId: exam.id,
      displayName: 'Trần Thị B',
      tokenHash: randomUUID(),
      startedAt: new Date().toISOString()
    });

    await db.delete(schema.exam).where(eq(schema.exam.id, exam.id));

    const left = await db.select().from(schema.examAttempt).where(eq(schema.examAttempt.examId, exam.id));
    expect(left).toHaveLength(0);
  });

  it('refuses a second exam on the same slug', async () => {
    const { db, schema } = await loadDb();
    const slug = randomUUID().replace(/-/g, '').slice(0, 16);
    await createExam(db, schema, { slug });

    await expect(createExam(db, schema, { slug })).rejects.toThrow();
  });

  it('refuses an exam whose container does not exist', async () => {
    const { db, schema } = await loadDb();
    const organizationId = await createOrganization(db, schema);
    const createdBy = await createTeacher(db, schema);

    await expect(
      db.insert(schema.exam).values({
        organizationId,
        exerciseId: randomUUID(),
        title: 'Paper',
        slug: randomUUID().replace(/-/g, '').slice(0, 16),
        createdBy
      })
    ).rejects.toThrow();
  });

  it('keeps the container when its exam is deleted, because another exam may still deliver it', async () => {
    const { db, schema } = await loadDb();
    const exam = await createExam(db, schema);

    await db.delete(schema.exam).where(eq(schema.exam.id, exam.id));

    const container = await db.select().from(schema.exercise).where(eq(schema.exercise.id, exam.exerciseId));
    expect(container).toHaveLength(1);
  });
});
