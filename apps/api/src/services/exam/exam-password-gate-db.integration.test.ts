import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

/**
 * The password gate on a protected exam.
 *
 * The sitting side already collected a password and the start path already accepted one as
 * a parameter; nothing compared it. Because nothing could set a hash either, the gap was
 * not reachable — but a box asking for a password that admits any answer is worse than no
 * box, so the check is pinned here rather than left to the write path's arrival.
 */
const integrationVariable = ['RUN', 'DB', 'INTEGRATION'].join('_');
const runDatabaseIntegration = process['env'][integrationVariable] === '1';

describe.runIf(runDatabaseIntegration)('sitting a password-protected exam', () => {
  async function load() {
    const [{ db }, schema, attempt, password] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('./exam-attempt'),
      import('./exam-password')
    ]);
    return { db, schema, attempt, password };
  }

  async function seedProtectedExam(db: any, schema: any, passwordHash: string | null) {
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

    const [exam] = await db
      .insert(schema.exam)
      .values({
        organizationId: organization.id,
        exerciseId,
        title: 'Protected',
        slug: randomUUID().replace(/-/g, '').slice(0, 16),
        createdBy: user.id,
        mode: 'public',
        status: 'open',
        requiresName: true,
        requiresClass: false,
        requiresCandidateNumber: false,
        passwordHash,
        paperSnapshot: {
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
        }
      })
      .returning();

    return exam;
  }

  function sitting(exam: any, password: string | null) {
    return {
      exam,
      identity: { displayName: 'Nguyễn Văn A', className: null, candidateNumber: null },
      profileId: null,
      password,
      ipHash: null,
      userAgent: null,
      deviceHash: null,
      fingerprintHash: null,
      priorAttemptsOnDevice: 0,
      now: new Date()
    };
  }

  it('refuses a wrong password, and refuses none at all', async () => {
    const { db, schema, attempt, password } = await load();
    const exam = await seedProtectedExam(db, schema, await password.hashExamPassword('ca-mot'));

    await expect(attempt.startAttemptService(sitting(exam, 'ca-hai'))).rejects.toThrow();
    await expect(attempt.startAttemptService(sitting(exam, null))).rejects.toThrow();
    await expect(attempt.startAttemptService(sitting(exam, ''))).rejects.toThrow();
  });

  it('starts the sitting when the password is right', async () => {
    const { db, schema, attempt, password } = await load();
    const exam = await seedProtectedExam(db, schema, await password.hashExamPassword('ca-mot'));

    const started = await attempt.startAttemptService(sitting(exam, 'ca-mot'));

    expect(started.attempt.examId).toBe(exam.id);
  });

  it('leaves an unprotected exam open to anyone with the link', async () => {
    const { db, schema, attempt } = await load();
    const exam = await seedProtectedExam(db, schema, null);

    const started = await attempt.startAttemptService(sitting(exam, null));

    expect(started.attempt.examId).toBe(exam.id);
  });
});
