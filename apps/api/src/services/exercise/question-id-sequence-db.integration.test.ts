import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

/**
 * The question identity sequence, and the one rule that keeps concurrent authoring alive.
 *
 * Syncing it to `max(id)` before every insert looks harmless and is not: an uncommitted
 * writer's rows are invisible to `max(id)`, so a second writer's sync rewinds the sequence
 * below ids already handed out, and the next insert dies on `question_pkey`. It surfaced
 * as two publishes colliding, which is two teachers working at the same time.
 */
const integrationVariable = ['RUN', 'DB', 'INTEGRATION'].join('_');
const runDatabaseIntegration = process['env'][integrationVariable] === '1';

describe.runIf(runDatabaseIntegration)('the question id sequence', () => {
  async function load() {
    const [{ db, sql }, schema, queries] = await Promise.all([
      import('@cio/db/drizzle'),
      import('@cio/db/schema'),
      import('@cio/db/queries/exercise/exercise')
    ]);
    return { db, sql, schema, queries };
  }

  async function lastValue(db: any, sql: any): Promise<number> {
    const rows = await db.execute(
      sql`SELECT COALESCE(pg_sequence_last_value(pg_get_serial_sequence('question', 'id')::regclass), 0) AS value`
    );
    return Number((rows as Array<{ value: string }>)[0].value);
  }

  it('never moves the sequence backwards', async () => {
    const { db, sql, queries } = await load();

    // Stand where a concurrent writer would have left it: ahead of every committed row,
    // because its own rows are still inside an open transaction.
    const ahead = (await lastValue(db, sql)) + 500;
    await db.execute(sql`SELECT setval(pg_get_serial_sequence('question', 'id')::regclass, ${ahead}, true)`);

    await queries.syncQuestionIdSequence(db);

    expect(await lastValue(db, sql)).toBe(ahead);
  });

  it('still catches the sequence up when a restore left it behind', async () => {
    const { db, sql, schema, queries } = await load();

    const [exercise] = await db
      .insert(schema.exercise)
      .values({ title: `Paper ${randomUUID().slice(0, 8)}`, courseId: null, lessonId: null })
      .returning({ id: schema.exercise.id });

    // A restored row carries its own id and does not touch the sequence — the situation
    // this function exists for.
    const restoredId = (await lastValue(db, sql)) + 1_000;
    await db
      .insert(schema.question)
      .values({ id: restoredId, exerciseId: exercise.id, title: 'Restored', questionTypeId: 1, points: 1, order: 1 });

    await queries.syncQuestionIdSequence(db);

    expect(await lastValue(db, sql)).toBeGreaterThanOrEqual(restoredId);

    // And the next insert must not collide with the restored row.
    const [next] = await db
      .insert(schema.question)
      .values({ exerciseId: exercise.id, title: 'Next', questionTypeId: 1, points: 1, order: 2 })
      .returning({ id: schema.question.id });

    expect(next.id).toBeGreaterThan(restoredId);
  });
});
