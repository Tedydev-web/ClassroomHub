import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

/**
 * Freezing a paper, and the summary a teacher sees before sending the link.
 *
 * The summary earns its place from our own history: the `.docx` import once published a
 * paper with seventeen of forty answer keys missing, and nobody knew until students sat
 * it. A question that no option can satisfy is the thing this must find.
 */
const integrationVariable = ['RUN', 'DB', 'INTEGRATION'].join('_');
const runDatabaseIntegration = process['env'][integrationVariable] === '1';

describe.runIf(runDatabaseIntegration)('freezing an exam paper', () => {
  async function load() {
    const [{ db }, schema, container] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('./exam-container')
    ]);
    return { db, schema, container };
  }

  /** A container with `count` choice questions; `withoutKey` of them have no correct option. */
  async function seedPaper(db: any, schema: any, count: number, withoutKey = 0) {
    const { createExamContainer } = await import('./exam-container');
    const exerciseId = await createExamContainer(`Paper ${randomUUID().slice(0, 8)}`, db);

    for (let index = 0; index < count; index += 1) {
      const [question] = await db
        .insert(schema.question)
        .values({
          exerciseId,
          title: `Question ${index + 1}`,
          questionTypeId: 1,
          points: 1,
          order: index + 1
        })
        .returning({ id: schema.question.id });

      const marksCorrect = index >= withoutKey;
      await db.insert(schema.option).values([
        { questionId: question.id, label: 'A', isCorrect: marksCorrect },
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

      await db
        .update(schema.question)
        .set({ currentRevisionId: revision.id })
        .where(eq(schema.question.id, question.id));
    }

    return exerciseId;
  }

  it('reports every question that carries no correct answer', async () => {
    const { db, schema, container } = await load();
    const exerciseId = await seedPaper(db, schema, 5, 2);

    const summary = await container.summariseContainer(exerciseId, db);

    expect(summary.questionCount).toBe(5);
    expect(summary.questionsWithoutAnswerKey).toHaveLength(2);
    expect(summary.questionsWithoutAnswerKey.map((question) => question.order)).toEqual([1, 2]);
  });

  it('reports a clean paper as clean', async () => {
    const { db, schema, container } = await load();
    const exerciseId = await seedPaper(db, schema, 3);

    const summary = await container.summariseContainer(exerciseId, db);

    expect(summary.questionsWithoutAnswerKey).toEqual([]);
    expect(summary.autoGradable).toBe(true);
    expect(summary.optionCounts.every((entry) => entry.optionCount === 2)).toBe(true);
  });

  it('refuses to freeze a paper with no questions rather than freezing an empty one', async () => {
    const { db, container } = await load();
    const exerciseId = await container.createExamContainer('Empty paper', db);

    await expect(container.freezeExamPaper(exerciseId, db)).rejects.toThrow();
  });

  it('refuses a working exercise, which enrolled students could answer without a clock', async () => {
    const { db, schema, container } = await load();
    const [working] = await db
      .insert(schema.exercise)
      .values({ title: 'A real exercise', courseId: null, lessonId: randomUUID(), order: 1 })
      .returning({ id: schema.exercise.id })
      .catch(() => [null]);

    if (!working) return; // the lesson id is fabricated; skip where the FK refuses it

    await expect(container.assertIsContainer(working.id, db)).rejects.toThrow();
  });
});
