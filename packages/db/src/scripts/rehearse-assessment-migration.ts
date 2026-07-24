import 'dotenv/config';

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres, { type Sql } from 'postgres';

import {
  DB_BACKED_QUESTION_TYPE_REGISTRY,
  ENABLED_QUESTION_TYPE_REGISTRY,
  MAX_INTERACTION_MAX_SCORE
} from '@cio/question-types';

const connectionString = process.env.DATABASE_URL ?? process.env.PRIVATE_DATABASE_URL ?? '';
const scriptPath = fileURLToPath(import.meta.url);
const packageRoot = resolve(dirname(scriptPath), '../..');
const pnpmBinary = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

if (!connectionString) {
  console.error('DATABASE_URL or PRIVATE_DATABASE_URL environment variable is required');
  process.exit(1);
}

function buildDatabaseUrl(databaseName: string): string {
  const databaseUrl = new URL(connectionString);
  databaseUrl.pathname = `/${databaseName}`;

  return databaseUrl.toString();
}

async function runDatabaseSetup(databaseUrl: string): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(pnpmBinary, ['db:setup'], {
      cwd: packageRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl, PRIVATE_DATABASE_URL: databaseUrl },
      stdio: 'inherit',
      shell: process.platform === 'win32'
    });

    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`Database setup rehearsal failed with exit code ${code ?? 'unknown'}`));
    });
  });
}

async function runFinalizeSchemaScript(databaseUrl: string): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(pnpmBinary, ['db:finalize-assessment-schema'], {
      cwd: packageRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl, PRIVATE_DATABASE_URL: databaseUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    });
    let output = '';
    child.stdout?.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      output += String(chunk);
    });

    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      resolvePromise({ exitCode: code ?? 1, output });
    });
  });
}

async function verifyLegacyPointsPreflight(sql: Sql, databaseUrl: string): Promise<void> {
  // The finalize script must refuse to run — loudly, before any student can
  // trigger canonical materialization — while legacy question points sit
  // outside the canonical 0..MAX_INTERACTION_MAX_SCORE/two-decimal range.
  // Prove it end to end by planting one offending row per predicate branch
  // plus an internal composite item that must NOT be flagged, then running
  // the real script.
  const enabledTypeId = ENABLED_QUESTION_TYPE_REGISTRY[0].id;
  const oversizedPoints = MAX_INTERACTION_MAX_SCORE * 2;
  const [probeExercise] = await sql<{ id: string }[]>`
    INSERT INTO exercise (title) VALUES ('legacy points preflight rehearsal') RETURNING id
  `;
  const [negativePointsQuestion] = await sql<{ id: number }[]>`
    INSERT INTO question (title, question_type_id, exercise_id, points)
    VALUES ('rehearsal negative points', ${enabledTypeId}, ${probeExercise.id}, ${-1}) RETURNING id
  `;
  const [oversizedPointsQuestion] = await sql<{ id: number }[]>`
    INSERT INTO question (title, question_type_id, exercise_id, points)
    VALUES ('rehearsal oversized points', ${enabledTypeId}, ${probeExercise.id}, ${oversizedPoints}) RETURNING id
  `;
  const [fractionalPointsQuestion] = await sql<{ id: number }[]>`
    INSERT INTO question (title, question_type_id, exercise_id, points)
    VALUES ('rehearsal fractional points', ${enabledTypeId}, ${probeExercise.id}, ${7.333}) RETURNING id
  `;
  const [internalPointsQuestion] = await sql<{ id: number }[]>`
    INSERT INTO question (title, question_type_id, exercise_id, points)
    VALUES ('rehearsal internal item points', 16, ${probeExercise.id}, ${oversizedPoints}) RETURNING id
  `;

  // The points column is double precision, so PostgreSQL accepts non-finite
  // values; each one must surface in the preflight report, never abort the
  // preflight query through a float->numeric cast. Insertion stays guarded so
  // a future column-type hardening (rejecting non-finite at the schema level)
  // downgrades these probes instead of failing the rehearsal.
  const nonFinitePointsQuestions: Array<{ id: number }> = [];
  for (const nonFiniteLiteral of ['NaN', 'Infinity', '-Infinity']) {
    try {
      const [nonFiniteQuestion] = await sql<{ id: number }[]>`
        INSERT INTO question (title, question_type_id, exercise_id, points)
        VALUES (
          ${`rehearsal non-finite points ${nonFiniteLiteral}`},
          ${enabledTypeId},
          ${probeExercise.id},
          ${nonFiniteLiteral}::double precision
        ) RETURNING id
      `;
      nonFinitePointsQuestions.push(nonFiniteQuestion);
    } catch (error) {
      console.warn(`Skipping non-finite points probe: column rejected ${nonFiniteLiteral}:`, error);
    }
  }

  try {
    const finalizeRun = await runFinalizeSchemaScript(databaseUrl);
    if (finalizeRun.exitCode === 0) {
      throw new Error('Finalize must fail loudly while legacy question points are outside the canonical range');
    }

    const expectedReportedIds = [
      negativePointsQuestion.id,
      oversizedPointsQuestion.id,
      fractionalPointsQuestion.id,
      ...nonFinitePointsQuestions.map((question) => question.id)
    ];
    for (const questionId of expectedReportedIds) {
      if (!finalizeRun.output.includes(`question ${questionId} (`)) {
        throw new Error(`Points preflight must report offending question ${questionId}\n${finalizeRun.output}`);
      }
    }
    if (finalizeRun.output.includes(`question ${internalPointsQuestion.id} (`)) {
      throw new Error(
        `Points preflight must not flag internal composite question ${internalPointsQuestion.id}\n${finalizeRun.output}`
      );
    }
  } finally {
    await sql`DELETE FROM exercise WHERE id = ${probeExercise.id}`;
  }
}

async function verifyAssessmentSchema(sql: Sql): Promise<void> {
  const triggers = await sql<{ triggerName: string }[]>`
    SELECT tgname AS "triggerName"
    FROM pg_trigger
    WHERE tgname IN ('question_answer_score_columns_sync', 'submission_score_columns_sync')
      AND NOT tgisinternal
  `;
  if (triggers.length !== 2) {
    throw new Error(`Expected 2 assessment compatibility triggers, found ${triggers.length}`);
  }

  const indexes = await sql<{ indexName: string; isValid: boolean; isUnique: boolean }[]>`
    SELECT
      index_class.relname AS "indexName",
      index_data.indisvalid AS "isValid",
      index_data.indisunique AS "isUnique"
    FROM pg_class AS index_class
    INNER JOIN pg_index AS index_data ON index_data.indexrelid = index_class.oid
    WHERE index_class.relname IN (
      'question_answer_submission_question_unique',
      'submission_attempt_idempotency_unique'
    )
  `;
  if (indexes.length !== 2 || indexes.some((index) => !index.isValid || !index.isUnique)) {
    throw new Error('Expected 2 valid assessment uniqueness indexes');
  }

  await sql.unsafe('CREATE TEMP TABLE rehearsal_question_score (point bigint, score numeric(12, 2))');
  await sql.unsafe(`
    CREATE TRIGGER rehearsal_question_score_sync
    BEFORE INSERT OR UPDATE ON rehearsal_question_score
    FOR EACH ROW EXECUTE FUNCTION sync_question_answer_score_columns()
  `);
  await sql`INSERT INTO rehearsal_question_score (point) VALUES (7)`;
  await sql`UPDATE rehearsal_question_score SET point = 8`;
  let [questionScore] = await sql<{ point: string; score: string }[]>`
    SELECT point::text AS point, score::text AS score FROM rehearsal_question_score
  `;
  if (questionScore?.point !== '8' || questionScore.score !== '8.00') {
    throw new Error('Legacy question score update did not synchronize the exact score');
  }

  await sql`UPDATE rehearsal_question_score SET score = 2.50`;
  [questionScore] = await sql<{ point: string; score: string }[]>`
    SELECT point::text AS point, score::text AS score FROM rehearsal_question_score
  `;
  if (questionScore?.point !== '3' || questionScore.score !== '2.50') {
    throw new Error('Exact question score update did not project to the legacy integer score');
  }

  await sql`UPDATE rehearsal_question_score SET score = 9999999999.99`;
  const [wideQuestionScore] = await sql<{ point: string; score: string }[]>`
    SELECT point::text AS point, score::text AS score FROM rehearsal_question_score
  `;
  if (wideQuestionScore?.point !== '10000000000' || wideQuestionScore.score !== '9999999999.99') {
    throw new Error('Exact question score projection overflowed the legacy bigint score');
  }

  await sql.unsafe('CREATE TEMP TABLE rehearsal_submission_score (total bigint, score numeric(12, 2))');
  await sql.unsafe(`
    CREATE TRIGGER rehearsal_submission_score_sync
    BEFORE INSERT OR UPDATE ON rehearsal_submission_score
    FOR EACH ROW EXECUTE FUNCTION sync_submission_score_columns()
  `);
  await sql`INSERT INTO rehearsal_submission_score (total) VALUES (9)`;
  let [submissionScore] = await sql<{ total: string; score: string }[]>`
    SELECT total::text AS total, score::text AS score FROM rehearsal_submission_score
  `;
  if (submissionScore?.total !== '9' || submissionScore.score !== '9.00') {
    throw new Error('Legacy submission score insert did not synchronize the exact score');
  }

  await sql`UPDATE rehearsal_submission_score SET score = 4.25`;
  [submissionScore] = await sql<{ total: string; score: string }[]>`
    SELECT total::text AS total, score::text AS score FROM rehearsal_submission_score
  `;
  if (submissionScore?.total !== '4' || submissionScore.score !== '4.25') {
    throw new Error('Exact submission score update did not project to the legacy integer score');
  }

  await sql`UPDATE rehearsal_submission_score SET score = 9999999999.99`;
  const [wideSubmissionScore] = await sql<{ total: string; score: string }[]>`
    SELECT total::text AS total, score::text AS score FROM rehearsal_submission_score
  `;
  if (wideSubmissionScore?.total !== '10000000000' || wideSubmissionScore.score !== '9999999999.99') {
    throw new Error('Exact submission score projection overflowed the legacy bigint score');
  }
}

async function expectSqlErrorCode(label: string, expectedCode: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    const sqlErrorCode = (error as { code?: string }).code;
    if (sqlErrorCode === expectedCode) return;

    throw new Error(`${label}: expected SQLSTATE ${expectedCode}, got ${sqlErrorCode ?? String(error)}`);
  }

  throw new Error(`${label}: expected SQLSTATE ${expectedCode}, but the statement succeeded`);
}

async function verifyRevisionPersistence(sql: Sql): Promise<void> {
  // Deterministic question-type identities: essential seed + migration must land every
  // DB-backed registry entry (enabled types 1-13 and internal ASSESSMENT_ITEM 16) at its fixed id.
  const questionTypeRows = await sql<{ id: number; typename: string | null }[]>`
    SELECT id::int AS id, typename FROM question_type
  `;
  const idByTypename = new Map(questionTypeRows.map((row) => [row.typename, row.id]));
  for (const registryEntry of DB_BACKED_QUESTION_TYPE_REGISTRY) {
    if (idByTypename.get(registryEntry.typename) !== registryEntry.id) {
      throw new Error(
        `question_type "${registryEntry.typename}" expected at id ${registryEntry.id}, found ${idByTypename.get(registryEntry.typename) ?? 'missing'}`
      );
    }
  }

  // The identity sequence must be realigned past the reserved ids so future default inserts cannot collide.
  const [sequenceState] = await sql<{ lastValue: string }[]>`
    SELECT last_value::text AS "lastValue" FROM pg_sequences
    WHERE schemaname = current_schema() AND sequencename = 'question_type_id_seq'
  `;
  if (!sequenceState || Number(sequenceState.lastValue) < 16) {
    throw new Error(`question_type id sequence must be >= 16, found ${sequenceState?.lastValue ?? 'unknown'}`);
  }

  // Direct question deletion must no longer cascade-erase attempted history.
  const [answerQuestionFk] = await sql<{ deleteAction: string }[]>`
    SELECT confdeltype AS "deleteAction" FROM pg_constraint
    WHERE conname = 'question_answer_question_id_fkey'
  `;
  if (answerQuestionFk?.deleteAction !== 'a') {
    throw new Error(
      `question_answer.question_id must be ON DELETE NO ACTION ('a'), found '${answerQuestionFk?.deleteAction ?? 'missing'}'`
    );
  }

  // Probe graph: exercise -> internal composite question -> revisions.
  const [probeExercise] = await sql<{ id: string }[]>`
    INSERT INTO exercise (title) VALUES ('assessment migration rehearsal') RETURNING id
  `;
  const [probeQuestion] = await sql<{ id: number }[]>`
    INSERT INTO question (title, question_type_id, exercise_id)
    VALUES ('rehearsal composite item', 16, ${probeExercise.id}) RETURNING id
  `;
  const [siblingQuestion] = await sql<{ id: number }[]>`
    INSERT INTO question (title, question_type_id, exercise_id)
    VALUES ('rehearsal sibling item', 16, ${probeExercise.id}) RETURNING id
  `;
  const [firstRevision] = await sql<{ id: string }[]>`
    INSERT INTO question_revision (question_id, revision, definition, content_hash)
    VALUES (${probeQuestion.id}, 1, '{"schemaVersion":1}'::jsonb, 'rehearsal-hash-1') RETURNING id
  `;

  await expectSqlErrorCode('duplicate (question_id, revision) must be rejected', '23505', async () => {
    await sql`
      INSERT INTO question_revision (question_id, revision, definition, content_hash)
      VALUES (${probeQuestion.id}, 1, '{"schemaVersion":1}'::jsonb, 'rehearsal-hash-duplicate')
    `;
  });
  await expectSqlErrorCode('revision below 1 must violate the check constraint', '23514', async () => {
    await sql`
      INSERT INTO question_revision (question_id, revision, definition, content_hash)
      VALUES (${probeQuestion.id}, 0, '{"schemaVersion":1}'::jsonb, 'rehearsal-hash-0')
    `;
  });
  await expectSqlErrorCode('revision rows must be immutable', 'P0001', async () => {
    await sql`UPDATE question_revision SET content_hash = 'mutated' WHERE id = ${firstRevision.id}`;
  });
  await expectSqlErrorCode('current pointer must reject a foreign question revision', '23503', async () => {
    await sql`UPDATE question SET current_revision_id = ${firstRevision.id} WHERE id = ${siblingQuestion.id}`;
  });

  await sql`UPDATE question SET current_revision_id = ${firstRevision.id} WHERE id = ${probeQuestion.id}`;

  // Draft (unattempted) deletion stays possible and cascades its revisions, current pointer included.
  await sql`DELETE FROM question WHERE id = ${probeQuestion.id}`;
  const [remainingRevisions] = await sql<{ total: string }[]>`
    SELECT COUNT(*)::text AS total FROM question_revision WHERE question_id = ${probeQuestion.id}
  `;
  if (remainingRevisions?.total !== '0') {
    throw new Error(
      `draft question deletion must cascade its revisions, found ${remainingRevisions?.total ?? 'unknown'}`
    );
  }

  await sql`DELETE FROM exercise WHERE id = ${probeExercise.id}`;
}

async function verifyRevisionIntegrityHardening(sql: Sql): Promise<void> {
  // Probe graph for migration 0012: exercise -> two composite questions -> two revisions,
  // plus the minimal group/groupmember chain required to author question_answer rows.
  const [probeExercise] = await sql<{ id: string }[]>`
    INSERT INTO exercise (title) VALUES ('revision integrity rehearsal') RETURNING id
  `;
  const [probeQuestion] = await sql<{ id: number }[]>`
    INSERT INTO question (title, question_type_id, exercise_id)
    VALUES ('rehearsal integrity item', 16, ${probeExercise.id}) RETURNING id
  `;
  const [siblingQuestion] = await sql<{ id: number }[]>`
    INSERT INTO question (title, question_type_id, exercise_id)
    VALUES ('rehearsal integrity sibling', 16, ${probeExercise.id}) RETURNING id
  `;
  const [firstRevision] = await sql<{ id: string }[]>`
    INSERT INTO question_revision (question_id, revision, definition, content_hash)
    VALUES (${probeQuestion.id}, 1, '{"schemaVersion":1}'::jsonb, 'integrity-hash-1') RETURNING id
  `;
  const [secondRevision] = await sql<{ id: string }[]>`
    INSERT INTO question_revision (question_id, revision, definition, content_hash)
    VALUES (${probeQuestion.id}, 2, '{"schemaVersion":1}'::jsonb, 'integrity-hash-2') RETURNING id
  `;
  await sql`UPDATE question SET current_revision_id = ${secondRevision.id} WHERE id = ${probeQuestion.id}`;

  // Append-only deletes: a non-current, unreferenced revision must survive a direct DELETE
  // while its parent question exists (BEFORE DELETE trigger, WHEN pg_trigger_depth() = 0).
  await expectSqlErrorCode(
    'direct deletion of a non-current unreferenced revision must be rejected',
    'P0001',
    async () => {
      await sql`DELETE FROM question_revision WHERE id = ${firstRevision.id}`;
    }
  );

  const [answerRole] = await sql<{ id: string }[]>`SELECT id FROM role ORDER BY id LIMIT 1`;
  if (!answerRole) {
    throw new Error('revision integrity rehearsal requires the essential role seed');
  }
  const [probeGroup] = await sql<{ id: string }[]>`
    INSERT INTO "group" (name) VALUES ('revision integrity rehearsal') RETURNING id
  `;
  const [probeMember] = await sql<{ id: string }[]>`
    INSERT INTO groupmember (group_id, role_id) VALUES (${probeGroup.id}, ${answerRole.id}) RETURNING id
  `;

  // Same-question linkage must pass the composite FK.
  const [linkedAnswer] = await sql<{ id: number }[]>`
    INSERT INTO question_answer (question_id, group_member_id, question_revision_id)
    VALUES (${probeQuestion.id}, ${probeMember.id}, ${firstRevision.id}) RETURNING id
  `;

  // Cross-question linkage must fail the composite FK even though the revision row exists,
  // so the single-column FK from 0011 cannot be the constraint that raises here.
  await expectSqlErrorCode('answer linking another question revision must be rejected', '23503', async () => {
    await sql`
      INSERT INTO question_answer (question_id, group_member_id, question_revision_id)
      VALUES (${siblingQuestion.id}, ${probeMember.id}, ${firstRevision.id})
    `;
  });

  // Legacy rows keep a NULL revision link (MATCH SIMPLE exempts them from the composite FK).
  const [legacyAnswer] = await sql<{ id: number }[]>`
    INSERT INTO question_answer (question_id, group_member_id)
    VALUES (${siblingQuestion.id}, ${probeMember.id}) RETURNING id
  `;

  // Cleanup in dependency order; the exercise delete must still cascade questions and
  // revisions through the append-only trigger (pg_trigger_depth() > 0 on the cascade path).
  await sql`DELETE FROM question_answer WHERE id IN (${linkedAnswer.id}, ${legacyAnswer.id})`;
  await sql`DELETE FROM exercise WHERE id = ${probeExercise.id}`;
  const [remainingRevisions] = await sql<{ total: string }[]>`
    SELECT COUNT(*)::text AS total FROM question_revision WHERE question_id = ${probeQuestion.id}
  `;
  if (remainingRevisions?.total !== '0') {
    throw new Error(
      `exercise deletion must cascade questions and their revisions, found ${remainingRevisions?.total ?? 'unknown'}`
    );
  }

  await sql`DELETE FROM groupmember WHERE id = ${probeMember.id}`;
  await sql`DELETE FROM "group" WHERE id = ${probeGroup.id}`;
}

async function rehearseAssessmentMigration(): Promise<void> {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const databaseName = `classroomhub_assessment_rehearsal_${suffix}`;
  const adminUrl = buildDatabaseUrl('postgres');
  const rehearsalUrl = buildDatabaseUrl(databaseName);
  const adminSql = postgres(adminUrl, { max: 1 });

  try {
    await adminSql`CREATE DATABASE ${adminSql(databaseName)}`;
    await runDatabaseSetup(rehearsalUrl);

    const rehearsalSql = postgres(rehearsalUrl, { max: 1 });
    try {
      await verifyAssessmentSchema(rehearsalSql);
      await verifyRevisionPersistence(rehearsalSql);
      await verifyRevisionIntegrityHardening(rehearsalSql);
      await verifyLegacyPointsPreflight(rehearsalSql, rehearsalUrl);
    } finally {
      await rehearsalSql.end();
    }

    console.log('Assessment migration rehearsal passed');
  } finally {
    await adminSql`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = ${databaseName}
        AND pid <> pg_backend_pid()
    `;
    await adminSql`DROP DATABASE IF EXISTS ${adminSql(databaseName)}`;
    await adminSql.end();
  }
}

rehearseAssessmentMigration().catch((error) => {
  console.error('Assessment migration rehearsal failed:', error);
  process.exitCode = 1;
});
