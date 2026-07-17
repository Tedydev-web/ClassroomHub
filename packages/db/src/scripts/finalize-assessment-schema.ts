import 'dotenv/config';

import postgres, { type Sql } from 'postgres';

import { ENABLED_QUESTION_TYPE_REGISTRY, MAX_INTERACTION_MAX_SCORE } from '@cio/question-types';

const connectionString = process.env.DATABASE_URL ?? process.env.PRIVATE_DATABASE_URL ?? '';
const BACKFILL_BATCH_SIZE = 5_000;
const POINTS_PREFLIGHT_REPORT_LIMIT = 20;

interface ConcurrentIndexDefinition {
  name: string;
  tableName: string;
  columns: string[];
  predicateColumn: string;
  createStatement: string;
}

interface ConcurrentIndexState {
  isValid: boolean;
  isUnique: boolean;
  tableName: string;
  columns: string[];
  predicate: string | null;
}

if (!connectionString) {
  console.error('DATABASE_URL or PRIVATE_DATABASE_URL environment variable is required');
  process.exit(1);
}

/**
 * Fail-loud preflight: legacy questions with `points` outside the canonical
 * assessment range (0..MAX_INTERACTION_MAX_SCORE, at most two decimals) either
 * block every new student submission on their exercise (above the cap fails
 * canonical materialization with a 400) or silently materialize with a
 * different effective maximum (negative/non-finite values clamp to 0, extra
 * decimals round). Surfacing them here — before any student hits
 * materialization — lets an operator fix the rows deliberately. This check
 * never rewrites data. Internal composite items never pass through the legacy
 * adapter, so only enabled (author-selectable) question types are scanned.
 *
 * The extra-decimal branch is CASE-guarded: `points` is double precision, so a
 * row can hold NaN or ±Infinity, and OR branches have no guaranteed evaluation
 * order — without the guard the float->numeric cast could abort the whole
 * preflight query instead of reporting the offending row.
 */
async function assertLegacyQuestionPointsAreCanonical(sql: Sql): Promise<void> {
  const enabledTypeIds = ENABLED_QUESTION_TYPE_REGISTRY.map((type) => type.id);
  const offendingRows = await sql<
    { id: number; exerciseId: string | null; questionTypeId: number; points: string; totalOffending: number }[]
  >`
    SELECT
      id::int AS id,
      exercise_id AS "exerciseId",
      question_type_id::int AS "questionTypeId",
      points::text AS points,
      COUNT(*) OVER ()::int AS "totalOffending"
    FROM question
    WHERE question_type_id = ANY(${enabledTypeIds}::int[])
      AND points IS NOT NULL
      AND (
        points < 0
        OR points > ${MAX_INTERACTION_MAX_SCORE}
        OR CASE
          WHEN points = 'NaN'::double precision OR abs(points) = 'Infinity'::double precision THEN TRUE
          ELSE points <> ROUND(points::numeric, 2)::double precision
        END
      )
    ORDER BY id
    LIMIT ${POINTS_PREFLIGHT_REPORT_LIMIT}
  `;
  if (offendingRows.length === 0) return;

  const totalOffending = offendingRows[0].totalOffending;
  const reportedRows = offendingRows.map(
    (row) =>
      `question ${row.id} (exercise ${row.exerciseId ?? 'none'}, type ${row.questionTypeId}): points=${row.points}`
  );
  const truncationNote =
    totalOffending > reportedRows.length ? [`… and ${totalOffending - reportedRows.length} more row(s)`] : [];

  throw new Error(
    [
      `Legacy question points preflight failed: ${totalOffending} question(s) have points outside the canonical range (0..${MAX_INTERACTION_MAX_SCORE} with at most two decimals).`,
      'New student submissions on these exercises would fail or silently change their maximum when the questions are materialized into canonical revisions.',
      'No data was modified. Fix the points values manually, then re-run this script.',
      ...reportedRows,
      ...truncationNote
    ].join('\n')
  );
}

async function ensureScoreCompatibilityTriggers(sql: Sql): Promise<void> {
  await sql.begin(async (transaction) => {
    await transaction.unsafe(`
      CREATE OR REPLACE FUNCTION sync_question_answer_score_columns()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW.score IS NULL THEN
            NEW.score := COALESCE(NEW.point, 0)::numeric;
          ELSE
            NEW.point := ROUND(NEW.score)::bigint;
          END IF;
        ELSIF NEW.score IS DISTINCT FROM OLD.score THEN
          NEW.point := ROUND(COALESCE(NEW.score, 0))::bigint;
        ELSIF NEW.point IS DISTINCT FROM OLD.point OR NEW.score IS NULL THEN
          NEW.score := COALESCE(NEW.point, 0)::numeric;
        END IF;

        RETURN NEW;
      END
      $$
    `);
    await transaction.unsafe('DROP TRIGGER IF EXISTS question_answer_score_columns_sync ON question_answer');
    await transaction.unsafe(`
      CREATE TRIGGER question_answer_score_columns_sync
      BEFORE INSERT OR UPDATE ON question_answer
      FOR EACH ROW
      EXECUTE FUNCTION sync_question_answer_score_columns()
    `);

    await transaction.unsafe(`
      CREATE OR REPLACE FUNCTION sync_submission_score_columns()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW.score IS NULL THEN
            NEW.score := COALESCE(NEW.total, 0)::numeric;
          ELSE
            NEW.total := ROUND(NEW.score)::bigint;
          END IF;
        ELSIF NEW.score IS DISTINCT FROM OLD.score THEN
          NEW.total := ROUND(COALESCE(NEW.score, 0))::bigint;
        ELSIF NEW.total IS DISTINCT FROM OLD.total OR NEW.score IS NULL THEN
          NEW.score := COALESCE(NEW.total, 0)::numeric;
        END IF;

        RETURN NEW;
      END
      $$
    `);
    await transaction.unsafe('DROP TRIGGER IF EXISTS submission_score_columns_sync ON submission');
    await transaction.unsafe(`
      CREATE TRIGGER submission_score_columns_sync
      BEFORE INSERT OR UPDATE ON submission
      FOR EACH ROW
      EXECUTE FUNCTION sync_submission_score_columns()
    `);
  });
}

async function backfillQuestionAnswerScores(sql: Sql): Promise<number> {
  let totalUpdated = 0;

  while (true) {
    const updatedRows = await sql<{ id: number }[]>`
      WITH batch AS (
        SELECT id
        FROM question_answer
        WHERE score IS NULL
        ORDER BY id
        LIMIT ${BACKFILL_BATCH_SIZE}
      )
      UPDATE question_answer AS answer
      SET score = COALESCE(answer.point, 0)::numeric
      FROM batch
      WHERE answer.id = batch.id
      RETURNING answer.id
    `;
    totalUpdated += updatedRows.length;
    if (updatedRows.length < BACKFILL_BATCH_SIZE) return totalUpdated;
  }
}

async function backfillSubmissionScores(sql: Sql): Promise<number> {
  let totalUpdated = 0;

  while (true) {
    const updatedRows = await sql<{ id: string }[]>`
      WITH batch AS (
        SELECT id
        FROM submission
        WHERE score IS NULL
        ORDER BY id
        LIMIT ${BACKFILL_BATCH_SIZE}
      )
      UPDATE submission AS attempt
      SET score = COALESCE(attempt.total, 0)::numeric
      FROM batch
      WHERE attempt.id = batch.id
      RETURNING attempt.id
    `;
    totalUpdated += updatedRows.length;
    if (updatedRows.length < BACKFILL_BATCH_SIZE) return totalUpdated;
  }
}

async function assertNoDuplicateAnswers(sql: Sql): Promise<void> {
  const duplicateRows = await sql<{ submissionId: string; questionId: number; count: string }[]>`
    SELECT submission_id AS "submissionId", question_id AS "questionId", COUNT(*)::text AS count
    FROM question_answer
    WHERE submission_id IS NOT NULL
    GROUP BY submission_id, question_id
    HAVING COUNT(*) > 1
    LIMIT 1
  `;

  if (duplicateRows.length > 0) {
    throw new Error('Cannot enforce one answer per submission question: duplicate rows exist');
  }
}

async function assertNoDuplicateIdempotencyKeys(sql: Sql): Promise<void> {
  const duplicateRows = await sql<{ exerciseId: string; submittedBy: string; idempotencyKey: string }[]>`
    SELECT exercise_id AS "exerciseId", submitted_by AS "submittedBy", idempotency_key AS "idempotencyKey"
    FROM submission
    WHERE idempotency_key IS NOT NULL
    GROUP BY exercise_id, submitted_by, idempotency_key
    HAVING COUNT(*) > 1
    LIMIT 1
  `;

  if (duplicateRows.length > 0) {
    throw new Error('Cannot enforce submission idempotency: duplicate keys exist');
  }
}

function normalizeSqlExpression(value: string): string {
  return value.toLowerCase().replace(/[\s()\"]/g, '');
}

async function getConcurrentIndexState(sql: Sql, indexName: string): Promise<ConcurrentIndexState | null> {
  const [state] = await sql<ConcurrentIndexState[]>`
    SELECT
      index_data.indisvalid AS "isValid",
      index_data.indisunique AS "isUnique",
      table_class.relname AS "tableName",
      ARRAY(
        SELECT pg_get_indexdef(index_data.indexrelid, key_position, true)
        FROM generate_series(1, index_data.indnkeyatts) AS key_position
        ORDER BY key_position
      ) AS columns,
      pg_get_expr(index_data.indpred, index_data.indrelid) AS predicate
    FROM pg_class AS index_class
    INNER JOIN pg_index AS index_data ON index_data.indexrelid = index_class.oid
    INNER JOIN pg_class AS table_class ON table_class.oid = index_data.indrelid
    INNER JOIN pg_namespace AS namespace ON namespace.oid = index_class.relnamespace
    WHERE index_class.relname = ${indexName}
      AND namespace.nspname = current_schema()
    LIMIT 1
  `;

  return state ?? null;
}

function assertExpectedConcurrentIndex(state: ConcurrentIndexState, definition: ConcurrentIndexDefinition): void {
  const normalizedPredicate = state.predicate ? normalizeSqlExpression(state.predicate) : '';
  const expectedPredicate = normalizeSqlExpression(`${definition.predicateColumn} IS NOT NULL`);
  const hasExpectedDefinition =
    state.isValid &&
    state.isUnique &&
    state.tableName === definition.tableName &&
    state.columns.length === definition.columns.length &&
    state.columns.every((column, index) => column === definition.columns[index]) &&
    normalizedPredicate === expectedPredicate;

  if (!hasExpectedDefinition) {
    throw new Error(`Existing index ${definition.name} does not match the required assessment schema`);
  }
}

async function ensureConcurrentUniqueIndex(sql: Sql, definition: ConcurrentIndexDefinition): Promise<void> {
  const existing = await getConcurrentIndexState(sql, definition.name);
  if (existing && !existing.isValid) {
    await sql.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS "${definition.name}"`);
  } else if (existing) {
    assertExpectedConcurrentIndex(existing, definition);
    return;
  }

  await sql.unsafe(definition.createStatement);

  const created = await getConcurrentIndexState(sql, definition.name);
  if (!created) {
    throw new Error(`Concurrent index ${definition.name} was not created`);
  }

  assertExpectedConcurrentIndex(created, definition);
}

async function finalizeAssessmentSchema(): Promise<void> {
  const sql = postgres(connectionString, { max: 1 });

  try {
    await assertLegacyQuestionPointsAreCanonical(sql);
    await ensureScoreCompatibilityTriggers(sql);

    const questionAnswersUpdated = await backfillQuestionAnswerScores(sql);
    const submissionsUpdated = await backfillSubmissionScores(sql);

    await assertNoDuplicateAnswers(sql);
    await assertNoDuplicateIdempotencyKeys(sql);

    await ensureConcurrentUniqueIndex(sql, {
      name: 'question_answer_submission_question_unique',
      tableName: 'question_answer',
      columns: ['submission_id', 'question_id'],
      predicateColumn: 'submission_id',
      createStatement: `
        CREATE UNIQUE INDEX CONCURRENTLY question_answer_submission_question_unique
        ON question_answer (submission_id, question_id)
        WHERE submission_id IS NOT NULL
      `
    });
    await ensureConcurrentUniqueIndex(sql, {
      name: 'submission_attempt_idempotency_unique',
      tableName: 'submission',
      columns: ['exercise_id', 'submitted_by', 'idempotency_key'],
      predicateColumn: 'idempotency_key',
      createStatement: `
        CREATE UNIQUE INDEX CONCURRENTLY submission_attempt_idempotency_unique
        ON submission (exercise_id, submitted_by, idempotency_key)
        WHERE idempotency_key IS NOT NULL
      `
    });

    console.log(
      `Assessment schema finalized: ${questionAnswersUpdated} question answers and ${submissionsUpdated} submissions backfilled`
    );
  } catch (error) {
    console.error('Failed to finalize assessment schema:', error);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

await finalizeAssessmentSchema();
