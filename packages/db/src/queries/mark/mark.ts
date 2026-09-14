import * as schema from '@db/schema';

import { and, db, eq, or, sql } from '@db/drizzle';
import { submissionHistoricalMaxPointsSql } from '@db/queries/course/certification-exercise';

/**
 * Mark record with fields in camelCase matching database schema convention.
 * Slim shape for gradebook: no lesson or profile data (students come from members API).
 *
 * `exercisePoints` is a fractional denominator: for submission rows it is that
 * submission's historical attempted maximum (answer-linked revision maxima with
 * legacy question-points fallback); for exercises without a submission it is the
 * live active maximum (archived questions excluded).
 *
 * `activeExercisePoints` is the live active maximum of the exercise (archived
 * questions excluded) and is identical on every row of the same exercise. Use it
 * for exercise-level headers; `exercisePoints` stays per-row historical.
 */
export interface Mark {
  courseId: string;
  exerciseId: string;
  exerciseTitle: string;
  exercisePoints: number;
  activeExercisePoints: number;
  submissionId: string | null;
  submissionCreatedAt: string | null;
  gradingState: string | null;
  statusId: number | null;
  totalPointsGotten: number | null;
  groupmemberId: string | null;
}

/**
 * Gets marks for a course
 * Converts the get_marks() PostgreSQL function to a Drizzle query
 * @param courseId Course ID
 * @returns Array of mark records
 */
export async function getMarksByCourseId(courseId: string, submittedBy?: string): Promise<Mark[]> {
  try {
    // Scope the submission join to one learner when asked, so the marks page shows a
    // student only their own scores rather than the whole class's (upstream #1102). When
    // omitted the join is by exercise alone, which is the gradebook's whole-class view.
    const submissionJoin = submittedBy
      ? and(eq(schema.exercise.id, schema.submission.exerciseId), eq(schema.submission.submittedBy, submittedBy))
      : eq(schema.exercise.id, schema.submission.exerciseId);

    // Submission rows keep the denominator they were attempted against; only
    // submission-less rows show the live active maximum. Decimals are preserved
    // end to end (no ::int truncation of fractional question points).
    const activeExercisePointsSql = sql<number>`(
      SELECT COALESCE(SUM(q.points), 0)::numeric
      FROM question q
      WHERE q.exercise_id = ${schema.exercise.id} AND q.archived_at IS NULL
    )`;
    const result = await db
      .select({
        courseId: schema.course.id,
        exerciseId: schema.exercise.id,
        exerciseTitle: schema.exercise.title,
        exercisePoints: sql<number>`(
          CASE
            WHEN ${schema.submission.id} IS NULL THEN ${activeExercisePointsSql}
            ELSE COALESCE(${submissionHistoricalMaxPointsSql(schema.submission.id)}, 0)
          END
        )::float`.as('exercisePoints'),
        activeExercisePoints: sql<number>`${activeExercisePointsSql}::float`.as('activeExercisePoints'),
        submissionId: schema.submission.id,
        submissionCreatedAt: schema.submission.createdAt,
        gradingState: schema.submission.gradingState,
        statusId: schema.submission.statusId,
        totalPointsGotten:
          sql<number>`COALESCE(${schema.submission.score}, ${schema.submission.total}::numeric, 0)::float`.as(
            'totalPointsGotten'
          ),
        groupmemberId: schema.submission.submittedBy
      })
      .from(schema.exercise)
      .leftJoin(schema.lesson, eq(schema.exercise.lessonId, schema.lesson.id))
      .innerJoin(
        schema.course,
        or(eq(schema.exercise.courseId, schema.course.id), eq(schema.lesson.courseId, schema.course.id))
      )
      .leftJoin(schema.submission, submissionJoin)
      .where(
        and(
          eq(schema.course.id, courseId),
          // Preserves the old INNER JOIN question semantics: exercises with no
          // question rows at all stay out of the gradebook. Archived questions
          // still count as "has questions" so attempted history stays visible.
          sql`EXISTS (SELECT 1 FROM question WHERE question.exercise_id = ${schema.exercise.id})`
        )
      )
      .orderBy(schema.exercise.createdAt);

    return result.map((row) => ({
      courseId: row.courseId,
      exerciseId: row.exerciseId,
      exerciseTitle: row.exerciseTitle,
      exercisePoints: row.exercisePoints ?? 0,
      activeExercisePoints: row.activeExercisePoints ?? 0,
      submissionId: row.submissionId ?? null,
      submissionCreatedAt: row.submissionCreatedAt ?? null,
      gradingState: row.gradingState ?? null,
      statusId: row.statusId ?? null,
      totalPointsGotten: row.totalPointsGotten ?? null,
      groupmemberId: row.groupmemberId ?? null
    }));
  } catch (error) {
    console.error('getMarksByCourseId error:', error);
    throw new Error(
      `Failed to get marks for course ID "${courseId}": ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
