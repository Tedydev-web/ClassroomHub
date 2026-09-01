import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

/**
 * Reading and correcting the answer key of a paper people have already sat.
 *
 * The claim that matters is the one about the second correction: a key fix names the key
 * it replaces, and that name is checked. Without the check two teachers reading the same
 * question would each correct it against what they read, and the later one would overwrite
 * the earlier silently, re-scoring the class to match.
 */
const integrationVariable = ['RUN', 'DB', 'INTEGRATION'].join('_');
const runDatabaseIntegration = process['env'][integrationVariable] === '1';

describe.runIf(runDatabaseIntegration)('the answer key of a sat paper', () => {
  async function load() {
    const [{ db }, schema, keys, results] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('./exam-answer-keys'),
      import('./exam-results')
    ]);
    return { db, schema, keys, results };
  }

  function choiceDefinition(correctOptionIds: string[]) {
    return {
      schemaVersion: 1,
      blocks: [
        {
          id: 'b1',
          kind: 'interaction',
          interaction: {
            kind: 'choice',
            prompt: { html: '<p>Which one?</p>' },
            required: true,
            maxScore: 1,
            config: {
              cardinality: 'single',
              presentation: 'list',
              options: [
                { id: '1', html: '<p>Four</p>' },
                { id: '2', html: '<p>Seven</p>' }
              ],
              correctOptionIds
            }
          }
        }
      ]
    };
  }

  async function seedSatExam(db: any, schema: any) {
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
        title: 'Paper',
        slug: randomUUID().replace(/-/g, '').slice(0, 16),
        createdBy: user.id,
        mode: 'public',
        status: 'open',
        paperSnapshot: {
          frozenAt: new Date().toISOString(),
          questions: [
            {
              questionId: 1,
              questionRevisionId: randomUUID(),
              order: 1,
              points: 1,
              // Frozen with the wrong option marked correct, which is the situation the
              // whole corrections path exists for.
              definition: choiceDefinition(['1'])
            }
          ]
        }
      })
      .returning({ id: schema.exam.id });

    await db.insert(schema.examAttempt).values({
      examId: exam.id,
      displayName: 'Nguyễn Văn A',
      tokenHash: randomUUID(),
      startedAt: new Date(Date.now() - 600_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      status: 'submitted',
      gradingState: 'complete',
      answers: [
        {
          questionId: 1,
          questionRevisionId: randomUUID(),
          answerData: {
            schemaVersion: 1,
            responses: [{ interactionId: 'b1', response: { kind: 'choice', selectedOptionIds: ['2'] } }]
          }
        }
      ]
    });

    return { examId: exam.id as string, by: user.id as string };
  }

  it('reports the key in force, with the labels a candidate saw', async () => {
    const { db, schema, keys } = await load();
    const { examId } = await seedSatExam(db, schema);

    const { questions } = await keys.listExamAnswerKeysService(examId);
    const [question] = questions;

    expect(question.position).toBe(1);
    expect(question.effectiveKey).toEqual(['1']);
    expect(question.options.map((option: { label: string }) => option.label)).toEqual(['A', 'B']);
    expect(question.keyFixable).toBe(true);
    expect(question.cardinality).toBe('single');
    expect(question.hasSeveralChoiceParts).toBe(false);
    expect(question.corrected).toBe(false);
  });

  it('applies a correction, re-scores the sitting, and then reports the corrected key', async () => {
    const { db, schema, keys, results } = await load();
    const { examId, by } = await seedSatExam(db, schema);

    const outcome = await results.addCorrectionService(examId, {
      kind: 'keyFix',
      questionId: 1,
      previousKey: ['1'],
      correctedKey: ['2'],
      by,
      at: new Date().toISOString()
    });

    expect(outcome.rescored).toBe(1);

    const { questions } = await keys.listExamAnswerKeysService(examId);
    const [question] = questions;
    expect(question.effectiveKey).toEqual(['2']);
    expect(question.corrected).toBe(true);

    // The sitting answered B, which the frozen paper called wrong. Re-scoring against the
    // corrected key is what the count above claims happened; this is that claim in marks.
    const [attempt] = await db
      .select({ score: schema.examAttempt.score })
      .from(schema.examAttempt)
      .where(eq(schema.examAttempt.examId, examId))
      .limit(1);

    expect(Number(attempt.score)).toBe(1);
  });

  it('refuses a key the grader would read as nobody being right', async () => {
    const { db, schema, results } = await load();
    const { examId, by } = await seedSatExam(db, schema);

    // The question lets a candidate pick one option, so every stored response names one.
    // A key naming two can never equal a response of one, and the grader compares them by
    // size first — so this would mark the entire class wrong on this question.
    await expect(
      results.addCorrectionService(examId, {
        kind: 'keyFix',
        questionId: 1,
        previousKey: ['1'],
        correctedKey: ['1', '2'],
        by,
        at: new Date().toISOString()
      })
    ).rejects.toThrow(/must name exactly one/);

    await expect(
      results.addCorrectionService(examId, {
        kind: 'keyFix',
        questionId: 1,
        previousKey: ['1'],
        correctedKey: [],
        by,
        at: new Date().toISOString()
      })
    ).rejects.toThrow(/at least one option/);
  });

  it('refuses a correction measured against a key that has since moved', async () => {
    const { db, schema, results } = await load();
    const { examId, by } = await seedSatExam(db, schema);
    const at = new Date().toISOString();

    await results.addCorrectionService(examId, {
      kind: 'keyFix',
      questionId: 1,
      previousKey: ['1'],
      correctedKey: ['2'],
      by,
      at
    });

    // A second teacher, still reading the key the paper froze with.
    await expect(
      results.addCorrectionService(examId, {
        kind: 'keyFix',
        questionId: 1,
        previousKey: ['1'],
        correctedKey: ['1'],
        by,
        at
      })
    ).rejects.toThrow(/changed while you were reading it/);
  });
});
