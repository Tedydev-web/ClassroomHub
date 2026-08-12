import { and, eq, isNull } from 'drizzle-orm';

import { db, type DbOrTxClient } from '../../drizzle';
import * as schema from '../../schema';

/**
 * Reads and writes for the exam row itself. Attempts live in `./exam-attempt`.
 *
 * Every read here excludes soft-deleted exams unless it says otherwise, because a
 * deleted exam must stop serving its link immediately while remaining restorable.
 */

export async function getExamById(id: string, dbClient: DbOrTxClient = db) {
  const [exam] = await dbClient
    .select()
    .from(schema.exam)
    .where(and(eq(schema.exam.id, id), isNull(schema.exam.deletedAt)))
    .limit(1);

  return exam ?? null;
}

/** The public entry point. A deleted exam is a 404, not a tombstone. */
export async function getExamBySlug(slug: string, dbClient: DbOrTxClient = db) {
  const [exam] = await dbClient
    .select()
    .from(schema.exam)
    .where(and(eq(schema.exam.slug, slug), isNull(schema.exam.deletedAt)))
    .limit(1);

  return exam ?? null;
}

export async function listExamsByCourseId(courseId: string, dbClient: DbOrTxClient = db) {
  return dbClient
    .select()
    .from(schema.exam)
    .where(and(eq(schema.exam.courseId, courseId), isNull(schema.exam.deletedAt)));
}

/**
 * Whether any exam still references a container. Used before reclaiming one, and it
 * deliberately counts soft-deleted exams: restoring an exam whose paper had been
 * collected would restore a broken thing.
 */
export async function containerHasExams(exerciseId: string, dbClient: DbOrTxClient = db) {
  const [row] = await dbClient
    .select({ id: schema.exam.id })
    .from(schema.exam)
    .where(eq(schema.exam.exerciseId, exerciseId))
    .limit(1);

  return Boolean(row);
}

export async function softDeleteExam(id: string, dbClient: DbOrTxClient = db) {
  const [exam] = await dbClient
    .update(schema.exam)
    .set({ deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .where(and(eq(schema.exam.id, id), isNull(schema.exam.deletedAt)))
    .returning({ id: schema.exam.id });

  return exam ?? null;
}

export async function restoreExam(id: string, dbClient: DbOrTxClient = db) {
  const [exam] = await dbClient
    .update(schema.exam)
    .set({ deletedAt: null, updatedAt: new Date().toISOString() })
    .where(eq(schema.exam.id, id))
    .returning({ id: schema.exam.id });

  return exam ?? null;
}
