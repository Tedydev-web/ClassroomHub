import * as schema from '@db/schema';

import { and, asc, eq, inArray, isNull, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';

import { db } from '@db/drizzle';

/**
 * Whether an exercise is part of a course (direct course_id or via lesson).
 */
export async function exerciseBelongsToCourse(exerciseId: string, courseId: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ id: schema.exercise.id })
      .from(schema.exercise)
      .leftJoin(schema.lesson, eq(schema.exercise.lessonId, schema.lesson.id))
      .where(
        and(
          eq(schema.exercise.id, exerciseId),
          or(eq(schema.exercise.courseId, courseId), eq(schema.lesson.courseId, courseId))
        )
      )
      .limit(1);

    return !!row;
  } catch (error) {
    console.error('exerciseBelongsToCourse error:', error);
    throw new Error(
      `Failed to check exercise belongs to course: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Title and the ACTIVE max points of an exercise (archived questions excluded).
 * This is the denominator for new attempts only; historical pass/review math must
 * use {@link getHistoricalMaxPointsBySubmissionIds} so past submissions keep the
 * denominator they were attempted against.
 */
export async function getExerciseTitleAndMaxPoints(exerciseId: string): Promise<{ title: string; maxPoints: number }> {
  try {
    const [ex] = await db
      .select({ title: schema.exercise.title })
      .from(schema.exercise)
      .where(eq(schema.exercise.id, exerciseId))
      .limit(1);

    if (!ex) {
      return { title: '', maxPoints: 0 };
    }

    const [sumRow] = await db
      .select({
        maxPoints: sql<number>`coalesce(sum(${schema.question.points}), 0)::float`
      })
      .from(schema.question)
      .where(and(eq(schema.question.exerciseId, exerciseId), isNull(schema.question.archivedAt)));

    return { title: ex.title ?? '', maxPoints: Number(sumRow?.maxPoints ?? 0) };
  } catch (error) {
    console.error('getExerciseTitleAndMaxPoints error:', error);
    throw new Error(
      `Failed to get exercise title and max points: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

export async function getStudentSubmissionsForExercise(
  groupMemberId: string,
  exerciseId: string
): Promise<Array<{ id: string; score: number; gradingState: string | null }>> {
  try {
    return db
      .select({
        id: schema.submission.id,
        score: sql<number>`COALESCE(${schema.submission.score}, ${schema.submission.total}::numeric, 0)::float`,
        gradingState: schema.submission.gradingState
      })
      .from(schema.submission)
      .where(and(eq(schema.submission.exerciseId, exerciseId), eq(schema.submission.submittedBy, groupMemberId)))
      .orderBy(asc(schema.submission.createdAt));
  } catch (error) {
    console.error('getStudentSubmissionsForExercise error:', error);
    throw new Error(
      `Failed to list submissions for exercise: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Contract-violation branch for stored revision definitions: concatenating the revision
 * id into a non-numeric string and casting makes Postgres raise
 * `22P02 invalid input syntax for type numeric: "<detail> in question revision <uuid>"`,
 * so malformed data fails the read loudly with context instead of being counted or
 * silently replaced by live data. Non-constant concat defeats plan-time folding; CASE
 * branch order guarantees the cast only runs on actual violations.
 */
function revisionContractViolationSql(detail: string): SQL<number> {
  return sql.raw(`('${detail} in question revision ' || qa.question_revision_id)::numeric`) as SQL<number>;
}

/**
 * Scalar SQL for one submission's historical max points. Each answer row pins its
 * denominator to the attempted question revision's interaction maxima; answers without
 * a revision link (pre-revision history) fall back to that answer's own question points.
 * Archived questions stay included and the live active exercise total is never consulted,
 * so later edits or archiving cannot retroactively move historical pass percentages.
 *
 * Yields NULL when the submission has no answer rows; callers COALESCE to 0.
 *
 * The revision branch enforces the schema-version-1 contract before counting anything
 * (mirrors `@cio/question-types/assessment` structure at the denominator-relevant level;
 * v1 has no top-level item object — ids live on blocks, and the block id is the
 * interaction identifier): top-level object, numeric schemaVersion exactly 1, non-empty
 * blocks array, every block an object with non-empty string id and content/interaction
 * kind, unique block ids, interaction blocks carrying an interaction object with a known
 * v1 kind and a JSON-number maxScore within [0, 10000] (canonical
 * MAX_INTERACTION_MAX_SCORE) at two decimal places or fewer, and at least one interaction
 * block. Any violation — including future schema versions and unknown interaction
 * kinds — fails via {@link revisionContractViolationSql}.
 */
export function submissionHistoricalMaxPointsSql(submissionId: SQLWrapper): SQL<number | null> {
  return sql<number | null>`(
    SELECT SUM(
      CASE
        WHEN qa.question_revision_id IS NOT NULL THEN CASE
          WHEN jsonb_typeof(qr.definition) IS DISTINCT FROM 'object'
            THEN ${revisionContractViolationSql('non-object assessment definition')}
          WHEN jsonb_typeof(qr.definition -> 'schemaVersion') IS DISTINCT FROM 'number'
            THEN ${revisionContractViolationSql('missing or non-numeric schemaVersion')}
          WHEN (qr.definition ->> 'schemaVersion')::numeric <> 1
            THEN ${revisionContractViolationSql('unsupported assessment schemaVersion')}
          WHEN jsonb_typeof(qr.definition -> 'blocks') IS DISTINCT FROM 'array'
            THEN ${revisionContractViolationSql('assessment blocks is not an array')}
          WHEN jsonb_array_length(qr.definition -> 'blocks') = 0
            THEN ${revisionContractViolationSql('assessment blocks is empty')}
          WHEN EXISTS (
            SELECT 1
            FROM jsonb_array_elements(qr.definition -> 'blocks') AS blk
            WHERE jsonb_typeof(blk) IS DISTINCT FROM 'object'
               OR jsonb_typeof(blk -> 'id') IS DISTINCT FROM 'string'
               OR blk ->> 'id' = ''
               OR blk ->> 'kind' IS NULL
               OR blk ->> 'kind' NOT IN ('content', 'interaction')
          ) THEN ${revisionContractViolationSql('malformed assessment block')}
          WHEN (
            SELECT COUNT(*) <> COUNT(DISTINCT blk ->> 'id')
            FROM jsonb_array_elements(qr.definition -> 'blocks') AS blk
          ) THEN ${revisionContractViolationSql('duplicate assessment block id')}
          WHEN EXISTS (
            SELECT 1
            FROM jsonb_array_elements(qr.definition -> 'blocks') AS blk
            WHERE blk ->> 'kind' = 'interaction'
              AND jsonb_typeof(blk -> 'interaction') IS DISTINCT FROM 'object'
          ) THEN ${revisionContractViolationSql('interaction is not an object')}
          WHEN NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(qr.definition -> 'blocks') AS blk
            WHERE blk ->> 'kind' = 'interaction'
          ) THEN ${revisionContractViolationSql('no interaction blocks')}
          WHEN EXISTS (
            SELECT 1
            FROM jsonb_array_elements(qr.definition -> 'blocks') AS blk
            WHERE blk ->> 'kind' = 'interaction'
              AND (
                jsonb_typeof(blk -> 'interaction' -> 'kind') IS DISTINCT FROM 'string'
                OR blk -> 'interaction' ->> 'kind' NOT IN (
                  'choice', 'text', 'numeric', 'fill_blank', 'word_bank',
                  'ordering', 'file_upload', 'link', 'star_rating', 'video_recording'
                )
              )
          ) THEN ${revisionContractViolationSql('unsupported interaction kind')}
          WHEN EXISTS (
            SELECT 1
            FROM jsonb_array_elements(qr.definition -> 'blocks') AS blk
            WHERE blk ->> 'kind' = 'interaction'
              AND jsonb_typeof(blk -> 'interaction' -> 'maxScore') IS DISTINCT FROM 'number'
          ) THEN ${revisionContractViolationSql('missing or non-numeric interaction maxScore')}
          WHEN EXISTS (
            SELECT 1
            FROM jsonb_array_elements(qr.definition -> 'blocks') AS blk
            WHERE blk ->> 'kind' = 'interaction'
              AND (
                (blk -> 'interaction' ->> 'maxScore')::numeric < 0
                OR (blk -> 'interaction' ->> 'maxScore')::numeric > 10000
              )
          ) THEN ${revisionContractViolationSql('interaction maxScore out of range')}
          WHEN EXISTS (
            SELECT 1
            FROM jsonb_array_elements(qr.definition -> 'blocks') AS blk
            WHERE blk ->> 'kind' = 'interaction'
              AND (blk -> 'interaction' ->> 'maxScore')::numeric
                <> round((blk -> 'interaction' ->> 'maxScore')::numeric, 2)
          ) THEN ${revisionContractViolationSql('interaction maxScore exceeds two decimal places')}
          ELSE (
            SELECT SUM((blk -> 'interaction' ->> 'maxScore')::numeric)
            FROM jsonb_array_elements(qr.definition -> 'blocks') AS blk
            WHERE blk ->> 'kind' = 'interaction'
          )
        END
        ELSE COALESCE(q.points, 0)::numeric
      END
    )
    FROM question_answer qa
    LEFT JOIN question_revision qr ON qr.id = qa.question_revision_id
    LEFT JOIN question q ON q.id = qa.question_id
    WHERE qa.submission_id = ${submissionId}
  )`;
}

/**
 * Batch historical denominators keyed by submission id (one query, no N+1).
 * See {@link submissionHistoricalMaxPointsSql} for the per-answer pinning rule.
 * Submissions without answer rows map to 0.
 */
export async function getHistoricalMaxPointsBySubmissionIds(submissionIds: string[]): Promise<Map<string, number>> {
  if (submissionIds.length === 0) {
    return new Map();
  }

  try {
    const rows = await db
      .select({
        id: schema.submission.id,
        maxPoints: sql<number>`COALESCE(${submissionHistoricalMaxPointsSql(schema.submission.id)}, 0)::float`
      })
      .from(schema.submission)
      .where(inArray(schema.submission.id, submissionIds));

    return new Map(rows.map((row) => [row.id, Number(row.maxPoints)]));
  } catch (error) {
    console.error('getHistoricalMaxPointsBySubmissionIds error:', error);
    // Surface the deepest cause: driver wrappers put the contract-violation detail
    // (guard message + revision id) on `cause`, not on their own message.
    let rootCause: unknown = error;
    while (rootCause instanceof Error) {
      const nestedCause = (rootCause as { cause?: unknown }).cause;
      if (!(nestedCause instanceof Error)) break;
      rootCause = nestedCause;
    }
    throw new Error(
      `Failed to get historical max points for submissions [${submissionIds.join(', ')}]: ${
        rootCause instanceof Error ? rootCause.message : 'Unknown error'
      }`
    );
  }
}
