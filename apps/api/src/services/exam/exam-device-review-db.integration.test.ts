import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

const integrationVariable = ['RUN', 'DB', 'INTEGRATION'].join('_');
const runDatabaseIntegration = process['env'][integrationVariable] === '1';

describe.runIf(runDatabaseIntegration)('one sitting per device', () => {
  async function load() {
    const [{ db }, schema, attempt, results] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('./exam-attempt'),
      import('./exam-results')
    ]);
    return { db, schema, attempt, results };
  }

  async function seedExam(db: any, schema: any, settings: Record<string, unknown>) {
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
        title: 'Device rule',
        slug: randomUUID().replace(/-/g, '').slice(0, 16),
        createdBy: user.id,
        mode: 'public',
        status: 'open',
        requiresName: true,
        requiresClass: false,
        requiresCandidateNumber: false,
        scoreVisibility: 'on_submit',
        maxAttempts: 1,
        paperSnapshot: {
          frozenAt: new Date().toISOString(),
          questions: [1, 2, 3, 4].map((questionId) => ({
            questionId,
            questionRevisionId: randomUUID(),
            order: questionId,
            points: 1,
            definition: { schemaVersion: 1, blocks: [] }
          }))
        },
        ...settings
      })
      .returning();

    return exam;
  }

  async function sit(attempt: any, exam: any, name: string, deviceHash: string | null, now = new Date()) {
    const priorAttemptsOnDevice = await attempt.countAttemptsOnDevice(exam.id, { tokenHash: null, deviceHash });

    return attempt.startAttemptService({
      exam,
      identity: { displayName: name },
      profileId: null,
      password: null,
      ipHash: 'network-1',
      userAgent: null,
      deviceHash,
      fingerprintHash: 'fingerprint-1',
      priorAttemptsOnDevice,
      now
    });
  }

  it('counts the attempts a device already made, whatever cookie it carries now', async () => {
    const { db, schema, attempt } = await load();
    const exam = await seedExam(db, schema, {});

    await sit(attempt, exam, 'Nguyễn Văn Ảo', 'device-1');

    expect(await attempt.countAttemptsOnDevice(exam.id, { tokenHash: null, deviceHash: 'device-1' })).toBe(1);
    expect(await attempt.countAttemptsOnDevice(exam.id, { tokenHash: null, deviceHash: 'device-2' })).toBe(0);
    expect(await attempt.countAttemptsOnDevice(exam.id, { tokenHash: null, deviceHash: null })).toBe(0);
  });

  it('records a second sitting on the same device as usual when the teacher did not ask to hold it', async () => {
    const { db, schema, attempt } = await load();
    const exam = await seedExam(db, schema, { holdSharedDevice: false });

    await sit(attempt, exam, 'Nguyễn Văn Ảo', 'device-1');
    const second = await sit(attempt, exam, 'Trần Thị Thật', 'device-1');

    expect(second.attempt.reviewStatus).toBeNull();
  });

  it('holds a second sitting on the same device, hides its score, and lets the teacher accept it once', async () => {
    const { db, schema, attempt, results } = await load();
    const exam = await seedExam(db, schema, { holdSharedDevice: true });

    const first = await sit(attempt, exam, 'Nguyễn Văn Ảo', 'device-1');
    const second = await sit(attempt, exam, 'Trần Thị Thật', 'device-1');
    const elsewhere = await sit(attempt, exam, 'Lê Văn Khác', 'device-2');

    expect(first.attempt.reviewStatus).toBeNull();
    expect(second.attempt.reviewStatus).toBe('held');
    expect(elsewhere.attempt.reviewStatus).toBeNull();

    await attempt.submitAttemptService(second.attempt.id, new Date());
    expect(await results.revealedScoreForSitterService(second.attempt.id)).toBeNull();

    const accepted = await results.acceptHeldAttemptService(second.attempt.id);
    expect(accepted.reviewStatus).toBe('accepted');
    await expect(results.acceptHeldAttemptService(second.attempt.id)).rejects.toThrow();
    await expect(results.acceptHeldAttemptService(elsewhere.attempt.id)).rejects.toThrow();
  });

  it('tells the teacher which sitting a held one shares a device with', async () => {
    const { db, schema, attempt, results } = await load();
    const exam = await seedExam(db, schema, { holdSharedDevice: true });

    const throwaway = await sit(attempt, exam, 'Nguyễn Văn Ảo', 'device-1');
    await attempt.submitAttemptService(throwaway.attempt.id, new Date());
    const real = await sit(attempt, exam, 'Trần Thị Thật', 'device-1');

    const rows = await results.listExamResultsService(exam.id);
    const realRow = rows.find((row: any) => row.attemptId === real.attempt.id);

    expect(realRow?.reviewStatus).toBe('held');
    expect(realRow?.linkage.links).toEqual([
      expect.objectContaining({ attemptId: throwaway.attempt.id, signal: 'device' })
    ]);
    expect(realRow?.linkage.startedAfterSubmitOf).toEqual(
      expect.objectContaining({ attemptId: throwaway.attempt.id, displayName: 'Nguyễn Văn Ảo', minutes: 0 })
    );
    expect(Object.keys(realRow ?? {})).not.toContain('deviceHash');
  });

  it('refuses a start once the start window after opening has passed', async () => {
    const { db, schema, attempt } = await load();
    const opensAt = new Date(Date.now() - 20 * 60_000);
    const exam = await seedExam(db, schema, { opensAt: opensAt.toISOString(), startWindowMinutes: 15 });

    await expect(sit(attempt, exam, 'Muộn', 'device-1')).rejects.toThrow(attempt.START_WINDOW_PASSED);

    const onTime = await sit(attempt, exam, 'Đúng giờ', 'device-2', new Date(opensAt.getTime() + 10 * 60_000));
    expect(onTime.attempt.id).toBeTruthy();
  });

  function choicePaper() {
    return {
      frozenAt: new Date().toISOString(),
      questions: [1, 2, 3, 4, 5, 6, 7, 8].map((questionId) => ({
        questionId,
        questionRevisionId: randomUUID(),
        order: questionId,
        points: 1,
        definition: {
          schemaVersion: 1,
          blocks: [
            {
              id: 'b1',
              kind: 'interaction',
              interaction: {
                kind: 'choice',
                prompt: { html: `<p>Question ${questionId}</p>`, format: 'html' },
                required: true,
                maxScore: 1,
                config: {
                  cardinality: 'single',
                  presentation: 'list',
                  options: ['a', 'b', 'c', 'd'].map((letter) => ({
                    id: `q${questionId}-${letter}`,
                    html: `<p>${questionId}${letter}</p>`
                  })),
                  correctOptionIds: [`q${questionId}-c`]
                }
              }
            }
          ]
        }
      }))
    };
  }

  it('serves a shuffled paper in the same order on start and on resume, and grades it in full', async () => {
    const { db, schema, attempt, results } = await load();
    const exam = await seedExam(db, schema, {
      shuffleQuestions: true,
      shuffleOptions: true,
      paperSnapshot: choicePaper()
    });

    const started = await sit(attempt, exam, 'Nguyễn Văn A', 'device-1');
    const resumed = attempt.sittingPaperFor(exam, started.attempt.id);
    const servedOrder = started.paper.questions.map((question: any) => question.questionId);

    expect(resumed.questions.map((question: any) => question.questionId)).toEqual(servedOrder);
    expect([...servedOrder].sort((a: number, b: number) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(servedOrder).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    await attempt.saveAnswersService(
      started.attempt.id,
      started.paper.questions.map((question: any) => {
        const options = question.definition.blocks[0].interaction.config.options;
        const correct = options.find((option: any) => option.id.endsWith('-c'));
        return {
          questionId: question.questionId,
          answerData: {
            schemaVersion: 1,
            responses: [{ interactionId: 'b1', response: { kind: 'choice', selectedOptionIds: [correct.id] } }]
          }
        };
      }),
      new Date()
    );
    await attempt.submitAttemptService(started.attempt.id, new Date());

    const rows = await results.listExamResultsService(exam.id);
    expect(Number(rows[0]?.score)).toBe(8);
  });
});
