import * as schema from '@db/schema';

import { and, asc, db, eq, isNull, sql } from '@db/drizzle';
import type { DbOrTxClient } from '@db/drizzle';

/**
 * The one place that knows what order an exercise's questions are in.
 *
 * `question.order` is unique only *within* a section — the editor numbers each section
 * from zero, so a paper with six sections carries the value `0` six times. Any read that
 * sorts on `question.order` alone therefore has ties it resolves by whatever order the
 * database happened to return, which is no order at all.
 *
 * Three delivery reads each rediscovered that the hard way, so the rule lives here now
 * and callers ask for the order rather than deriving it. The `id` tiebreaker is
 * deliberate: it keeps the result deterministic even for data that already contains the
 * ambiguity this function exists to prevent.
 *
 * Questions with no section sort before every section. A mixed exercise is a data
 * anomaly rather than an authored shape — a container has no sections at all, and an
 * authored exercise places every question — but the ordering has to be total regardless.
 */
export type ExerciseQuestionInDeliveryOrder = {
  id: number;
  exerciseSectionId: string | null;
  title: string;
  questionTypeId: number;
  points: number | null;
  order: number | null;
  settings: unknown;
  currentRevisionId: string | null;
};

export async function listExerciseQuestionsInDeliveryOrder(
  exerciseId: string,
  dbClient: DbOrTxClient = db
): Promise<ExerciseQuestionInDeliveryOrder[]> {
  return dbClient
    .select({
      id: schema.question.id,
      exerciseSectionId: schema.question.exerciseSectionId,
      title: schema.question.title,
      questionTypeId: schema.question.questionTypeId,
      points: schema.question.points,
      order: schema.question.order,
      settings: schema.question.settings,
      currentRevisionId: schema.question.currentRevisionId
    })
    .from(schema.question)
    .leftJoin(schema.exerciseSection, eq(schema.exerciseSection.id, schema.question.exerciseSectionId))
    .where(and(eq(schema.question.exerciseId, exerciseId), isNull(schema.question.archivedAt)))
    .orderBy(
      asc(sql`coalesce(${schema.exerciseSection.order}, -1)`),
      asc(sql`coalesce(${schema.question.order}, 0)`),
      asc(schema.question.id)
    );
}
