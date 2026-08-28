import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

/**
 * Editing an exam after it exists, and the one thing re-opening must never do.
 *
 * Both claims here are about what a stored row still holds after a write, so neither can
 * be observed without a real database.
 */
const integrationVariable = ['RUN', 'DB', 'INTEGRATION'].join('_');
const runDatabaseIntegration = process['env'][integrationVariable] === '1';

describe.runIf(runDatabaseIntegration)('editing an exam', () => {
  async function load() {
    const [{ db }, schema, service] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('./exam')
    ]);
    return { db, schema, service };
  }

  /** One answerable question, so the container is something `freezeExamPaper` accepts. */
  async function addQuestion(db: any, schema: any, exerciseId: string) {
    const [question] = await db
      .insert(schema.question)
      .values({ exerciseId, title: 'Question 1', questionTypeId: 1, points: 1, order: 1 })
      .returning({ id: schema.question.id });

    await db.insert(schema.option).values([
      { questionId: question.id, label: 'A', isCorrect: true },
      { questionId: question.id, label: 'B', isCorrect: false }
    ]);

    const [revision] = await db
      .insert(schema.questionRevision)
      .values({
        questionId: question.id,
        revision: 1,
        definition: { schemaVersion: 1, blocks: [] },
        contentHash: randomUUID()
      })
      .returning({ id: schema.questionRevision.id });

    await db.update(schema.question).set({ currentRevisionId: revision.id }).where(eq(schema.question.id, question.id));
  }

  async function seedExam(db: any, schema: any, overrides: Record<string, unknown> = {}) {
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

    const { createExamContainer } = await import('./exam-container');
    const exerciseId = await createExamContainer(`Paper ${suffix}`, db);
    await addQuestion(db, schema, exerciseId);

    const [exam] = await db
      .insert(schema.exam)
      .values({
        organizationId: organization.id,
        exerciseId,
        title: 'Original title',
        slug: randomUUID().replace(/-/g, '').slice(0, 16),
        createdBy: user.id,
        mode: 'private',
        status: 'draft',
        workingSeconds: 900,
        maxAttempts: 1,
        ...overrides
      })
      .returning({ id: schema.exam.id });

    return { examId: exam.id as string, exerciseId };
  }

  it('changes only the settings named in the patch', async () => {
    const { db, schema, service } = await load();
    const opensAt = new Date('2026-08-28T01:00:00.000Z').toISOString();
    const { examId } = await seedExam(db, schema, { opensAt, mode: 'private' });

    const updated = await service.updateExamSettingsService(examId, { title: 'Corrected title' });

    expect(updated.title).toBe('Corrected title');
    expect(updated.workingSeconds).toBe(900);
    expect(updated.maxAttempts).toBe(1);
    expect(updated.mode).toBe('private');
    // The window survives a patch that never mentioned it, and survives it as the same
    // instant — the stored form carries an offset rather than a zone-less local time.
    expect(new Date(updated.opensAt as string).toISOString()).toBe(opensAt);
  });

  it('sets, keeps and removes the password without being asked twice', async () => {
    const { db, schema, service } = await load();
    const { examId } = await seedExam(db, schema);

    await service.updateExamSettingsService(examId, { password: 'ca-mot' });

    const stored = async () => {
      const [row] = await db
        .select({ passwordHash: schema.exam.passwordHash })
        .from(schema.exam)
        .where(eq(schema.exam.id, examId));
      return row.passwordHash as string | null;
    };

    const afterSetting = await stored();
    expect(afterSetting).toBeTruthy();

    const { verifyExamPassword } = await import('./exam-password');
    await expect(verifyExamPassword('ca-mot', afterSetting as string)).resolves.toBe(true);

    // Editing something else must not disarm the exam. The patch says nothing about the
    // password, so the password stays exactly as it was.
    await service.updateExamSettingsService(examId, { title: 'Corrected title' });
    expect(await stored()).toBe(afterSetting);

    // An explicit null is the only thing that removes it.
    await service.updateExamSettingsService(examId, { password: null });
    expect(await stored()).toBeNull();
  });

  it('does not hand the frozen paper back to whoever changed a title', async () => {
    const { db, schema, service } = await load();
    const { examId } = await seedExam(db, schema, {
      paperSnapshot: { frozenAt: new Date().toISOString(), questions: [] }
    });

    const updated = await service.updateExamSettingsService(examId, { title: 'Corrected title' });

    expect(updated).not.toHaveProperty('paperSnapshot');
    expect(updated).not.toHaveProperty('passwordHash');
  });

  it('refuses a patch that breaks an invariant it never mentions', async () => {
    const { db, schema, service } = await load();
    // Stored as the safe pairing: answers on submit, one attempt only.
    const { examId } = await seedExam(db, schema, { answerVisibility: 'on_submit', maxAttempts: 1 });

    // The patch says nothing about answers, but raising the attempt limit would let a
    // sitter read the key and sit again.
    await expect(service.updateExamSettingsService(examId, { maxAttempts: 3 })).rejects.toThrow();

    const [row] = await db
      .select({ maxAttempts: schema.exam.maxAttempts })
      .from(schema.exam)
      .where(eq(schema.exam.id, examId));
    expect(row.maxAttempts).toBe(1);
  });

  it('keeps the paper somebody already sat when the exam is re-opened', async () => {
    const { db, schema, service } = await load();
    const frozen = {
      frozenAt: new Date().toISOString(),
      questions: [
        {
          questionId: 1,
          questionRevisionId: randomUUID(),
          order: 1,
          points: 1,
          definition: { schemaVersion: 1, blocks: [] }
        }
      ]
    };
    const { examId } = await seedExam(db, schema, { status: 'closed', paperSnapshot: frozen });
    // The container holds a real question, so re-freezing would succeed and would write a
    // different snapshot. The assertion below therefore fails if the guard is removed,
    // rather than passing because freezing happened to be impossible.

    await db.insert(schema.examAttempt).values({
      examId,
      displayName: 'Nguyễn Văn A',
      tokenHash: randomUUID(),
      startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      answers: []
    });

    const reopened = await service.openExamService(examId);

    expect(reopened.status).toBe('open');
    expect(reopened.paperSnapshot).toEqual(frozen);
  });
});
