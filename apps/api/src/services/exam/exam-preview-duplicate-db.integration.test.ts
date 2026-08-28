import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

/**
 * Reading a paper before it goes out, and copying one for a second sitting.
 *
 * The two claims worth pinning are that a preview of a draft does not freeze anything —
 * previewing must never be the act that fixes the paper — and that a copy owns its own
 * questions, since two exams sharing a container would mean editing one rewrote what the
 * other freezes next.
 */
const integrationVariable = ['RUN', 'DB', 'INTEGRATION'].join('_');
const runDatabaseIntegration = process['env'][integrationVariable] === '1';

describe.runIf(runDatabaseIntegration)('previewing and copying an exam', () => {
  async function load() {
    const [{ db }, schema, service] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('./exam')
    ]);
    return { db, schema, service };
  }

  async function addQuestion(db: any, schema: any, exerciseId: string, order: number) {
    const [question] = await db
      .insert(schema.question)
      .values({ exerciseId, title: `Question ${order}`, questionTypeId: 1, points: 1, order })
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
        definition: {
          schemaVersion: 1,
          blocks: [
            {
              id: `b${order}`,
              kind: 'interaction',
              interaction: {
                kind: 'choice',
                prompt: { format: 'html', html: `<p>Question ${order}</p>` },
                required: true,
                maxScore: 1,
                config: {
                  cardinality: 'single',
                  presentation: 'list',
                  options: [
                    { id: '1', html: '<p>Four</p>' },
                    { id: '2', html: '<p>Seven</p>' }
                  ],
                  correctOptionIds: ['2']
                }
              }
            }
          ]
        },
        contentHash: randomUUID()
      })
      .returning({ id: schema.questionRevision.id });

    await db.update(schema.question).set({ currentRevisionId: revision.id }).where(eq(schema.question.id, question.id));
  }

  async function seedDraftExam(db: any, schema: any, questionCount = 2) {
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
    for (let order = 1; order <= questionCount; order += 1) {
      await addQuestion(db, schema, exerciseId, order);
    }

    const [exam] = await db
      .insert(schema.exam)
      .values({
        organizationId: organization.id,
        exerciseId,
        title: 'Đề ca 1',
        slug: randomUUID().replace(/-/g, '').slice(0, 16),
        createdBy: user.id,
        mode: 'public',
        workingSeconds: 900,
        maxAttempts: 1,
        requiresClass: true,
        opensAt: new Date('2026-08-28T01:00:00.000Z').toISOString(),
        passwordHash: 'scrypt$aa$bb'
      })
      .returning({ id: schema.exam.id });

    return { examId: exam.id as string, exerciseId, questionCount };
  }

  it('shows a draft paper without freezing it', async () => {
    const { db, schema, service } = await load();
    const { examId, questionCount } = await seedDraftExam(db, schema);

    const preview = await service.previewExamPaperService(examId);

    expect(preview.frozen).toBe(false);
    expect(preview.paper.questions).toHaveLength(questionCount);

    // Previewing must not be the act that fixes the paper: a teacher looking at a draft
    // expects to still be able to change it.
    const [row] = await db
      .select({ paperSnapshot: schema.exam.paperSnapshot, status: schema.exam.status })
      .from(schema.exam)
      .where(eq(schema.exam.id, examId));

    expect(row.paperSnapshot).toBeNull();
    expect(row.status).toBe('draft');
  });

  it('shows an opened exam the paper its candidates are sitting', async () => {
    const { db, schema, service } = await load();
    const { examId } = await seedDraftExam(db, schema);

    await service.openExamService(examId);

    const preview = await service.previewExamPaperService(examId);
    expect(preview.frozen).toBe(true);
  });

  it('serves the preview without the answer key, exactly as a candidate is served', async () => {
    const { db, schema, service } = await load();
    const { examId } = await seedDraftExam(db, schema);

    const preview = await service.previewExamPaperService(examId);

    expect(JSON.stringify(preview.paper)).not.toContain('correctOptionIds');
  });

  it('gives the copy its own questions, its own link, and no password', async () => {
    const { db, schema, service } = await load();
    const { examId, exerciseId, questionCount } = await seedDraftExam(db, schema);

    const copy = await service.duplicateExamService(examId, 'Đề ca 2');

    const [original] = await db.select().from(schema.exam).where(eq(schema.exam.id, examId));
    const [duplicate] = await db.select().from(schema.exam).where(eq(schema.exam.id, copy.id));

    expect(duplicate.title).toBe('Đề ca 2');
    expect(duplicate.exerciseId).not.toBe(exerciseId);
    expect(duplicate.slug).not.toBe(original.slug);
    expect(duplicate.status).toBe('draft');
    expect(duplicate.paperSnapshot).toBeNull();

    // Carried over, because they describe how the paper is sat rather than when.
    expect(duplicate.workingSeconds).toBe(900);
    expect(duplicate.maxAttempts).toBe(1);
    expect(duplicate.requiresClass).toBe(true);

    // Not carried over: the people who sat the original know the password, and the copy's
    // window is by definition a different one.
    expect(duplicate.passwordHash).toBeNull();
    expect(duplicate.opensAt).toBeNull();

    const copiedQuestions = await db
      .select({ id: schema.question.id })
      .from(schema.question)
      .where(eq(schema.question.exerciseId, duplicate.exerciseId));

    expect(copiedQuestions).toHaveLength(questionCount);
  });
});
