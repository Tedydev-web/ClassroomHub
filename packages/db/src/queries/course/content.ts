import { sql } from 'drizzle-orm';

import { ContentType, ROLE } from '@cio/utils/constants';
import { shouldScopeExercisesToAssignments } from '@cio/utils/functions/course-enrollment';
import { and, db, eq, sql as drizzleSql, type DbOrTxClient } from '@db/drizzle';
import * as schema from '@db/schema';
import { getExerciseVisibilityCondition } from '@db/queries/exercise/assignment';
import { isExerciseCompletedSql } from './progression';

export type CourseContentItemRow = {
  id: string;
  type: ContentType;
  title: string | null;
  order: number | null;
  createdAt: string | null;
  sectionId: string | null;
  isUnlocked: boolean | null;
  isComplete: boolean | null;
  lessonAt: string | null;
  callUrl: string | null;
  sessionDurationMinutes: number | null;
  recordingUrl: string | null;
  hasNoteContent: boolean | null;
  hasSlideContent: boolean | null;
  videosCount: number | null;
  documentsCount: number | null;
  questionCount: number | null;
  dueBy: string | null;
};

/**
 * Fetches raw course content items (sections, lessons, exercises) for a course.
 * @param courseId Course ID
 * @param profileId Optional profile ID for completion state
 */
export async function getCourseContentItems(
  courseId: string,
  profileId?: string,
  dbClient: DbOrTxClient = db
): Promise<CourseContentItemRow[]> {
  try {
    const [viewerMember] = profileId
      ? await db
          .select({ id: schema.groupmember.id, roleId: schema.groupmember.roleId })
          .from(schema.groupmember)
          .innerJoin(schema.course, eq(schema.course.groupId, schema.groupmember.groupId))
          .where(and(eq(schema.course.id, courseId), eq(schema.groupmember.profileId, profileId)))
          .limit(1)
      : [];
    const lessonCompletionSql = profileId
      ? drizzleSql`COALESCE(
          (
            SELECT bool_or(is_complete)
            FROM lesson_completion
            WHERE lesson_id = lesson.id AND profile_id = ${profileId}
          ),
          false
        )`
      : drizzleSql`false`;

    const exerciseCompletionSql = profileId ? isExerciseCompletedSql('exercise', { profileId }) : drizzleSql`false`;
    // Narrowed to assignments only for a student; see `shouldScopeExercisesToAssignments`
    // for who that is and, more to the point, who it is not. Whoever reaches this function
    // has already been authorised for the course by the route, and the lessons selected in
    // the same query were never gated — so leaving the filter off here grants nothing the
    // same response did not already carry.
    const exerciseVisibilitySql =
      viewerMember && shouldScopeExercisesToAssignments(viewerMember, ROLE.STUDENT)
        ? drizzleSql`AND ${getExerciseVisibilityCondition(viewerMember.id, viewerMember.roleId)}`
        : drizzleSql``;

    const result = await dbClient.execute(drizzleSql`
      SELECT
        id,
        ${ContentType.Section}::text AS type,
        title,
        "order",
        created_at AS "createdAt",
        NULL::uuid AS "sectionId",
        NULL::boolean AS "isUnlocked",
        NULL::boolean AS "isComplete",
        NULL::timestamptz AS "lessonAt",
        NULL::text AS "callUrl",
        NULL::int AS "sessionDurationMinutes",
        NULL::text AS "recordingUrl",
        NULL::boolean AS "hasNoteContent",
        NULL::boolean AS "hasSlideContent",
        NULL::int AS "videosCount",
        NULL::int AS "documentsCount",
        NULL::int AS "questionCount",
        NULL::timestamp AS "dueBy"
      FROM course_section
      WHERE course_id = ${courseId}

      UNION ALL

      SELECT
        id,
        ${ContentType.Lesson}::text AS type,
        title,
        "order",
        created_at AS "createdAt",
        section_id AS "sectionId",
        is_unlocked AS "isUnlocked",
        ${lessonCompletionSql} AS "isComplete",
        lesson_at AS "lessonAt",
        call_url AS "callUrl",
        session_duration_minutes AS "sessionDurationMinutes",
        recording_url AS "recordingUrl",
        (
          (
            length(trim(COALESCE(note, ''))) > 0
          )
          OR EXISTS (
            SELECT 1
            FROM lesson_language
            WHERE lesson_language.lesson_id = lesson.id
              AND length(
                trim(
                  regexp_replace(
                    regexp_replace(COALESCE(lesson_language.content, ''), '<[^>]*>', '', 'g'),
                    '&nbsp;|&#160;',
                    ' ',
                    'g'
                  )
                )
              ) > 0
          )
        ) AS "hasNoteContent",
        (
          length(trim(COALESCE(slide_url, ''))) > 0
          OR COALESCE(jsonb_array_length(slides), 0) > 0
        ) AS "hasSlideContent",
        COALESCE(jsonb_array_length(videos), 0) AS "videosCount",
        COALESCE(jsonb_array_length(documents), 0) AS "documentsCount",
        NULL::int AS "questionCount",
        NULL::timestamp AS "dueBy"
      FROM lesson
      WHERE course_id = ${courseId}

      UNION ALL

      SELECT
        exercise.id,
        ${ContentType.Exercise}::text AS type,
        exercise.title,
        exercise."order",
        exercise.created_at AS "createdAt",
        COALESCE(exercise.section_id, lesson.section_id) AS "sectionId",
        exercise.is_unlocked AS "isUnlocked",
        ${exerciseCompletionSql} AS "isComplete",
        NULL::timestamptz AS "lessonAt",
        NULL::text AS "callUrl",
        NULL::int AS "sessionDurationMinutes",
        NULL::text AS "recordingUrl",
        NULL::boolean AS "hasNoteContent",
        NULL::boolean AS "hasSlideContent",
        NULL::int AS "videosCount",
        NULL::int AS "documentsCount",
        (
          -- Questions a candidate answers, not question rows. A composite item is one row
          -- carrying a passage plus its interactions, so counting rows reported 10 for a
          -- 40-question paper — and disagreed with the exercise editor, which counts the
          -- interactions. A row with no interaction blocks (or no revision at all) is one
          -- question, which is what every non-composite question is.
          SELECT COALESCE(SUM(
            GREATEST(1, (
              CASE WHEN jsonb_typeof(revision.definition -> 'blocks') = 'array' THEN (
                SELECT COUNT(*)
                FROM jsonb_array_elements(revision.definition -> 'blocks') AS block
                WHERE block ->> 'kind' = 'interaction'
              ) ELSE 0 END
            ))
          ), 0)
          FROM question
          LEFT JOIN question_revision AS revision
            ON revision.id = question.current_revision_id
           AND revision.question_id = question.id
          WHERE question.exercise_id = exercise.id
            AND question.archived_at IS NULL
        )::int AS "questionCount",
        exercise.due_by AS "dueBy"
      FROM exercise
      LEFT JOIN lesson ON lesson.id = exercise.lesson_id
      WHERE (exercise.course_id = ${courseId} OR lesson.course_id = ${courseId})
      ${exerciseVisibilitySql}
    `);

    const rows = result.map((row) => row as CourseContentItemRow);

    return rows.map((row) => ({
      ...row,
      type: row.type as ContentType,
      order: row.order === null ? null : Number(row.order),
      hasNoteContent: row.hasNoteContent === null ? null : Boolean(row.hasNoteContent),
      hasSlideContent: row.hasSlideContent === null ? null : Boolean(row.hasSlideContent),
      videosCount: row.videosCount === null ? null : Number(row.videosCount),
      documentsCount: row.documentsCount === null ? null : Number(row.documentsCount),
      questionCount: row.questionCount === null ? null : Number(row.questionCount)
    }));
  } catch (error) {
    console.error('getCourseContentItems error:', error);
    throw new Error(
      `Failed to get course content items for course "${courseId}": ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}
