import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';

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

/**
 * Attempts belonging to the exam row a query is selecting.
 *
 * Built through the query builder rather than as a hand-written fragment. Interpolating
 * columns into `sql` renders them bare — `where "exam_id" = "id"` — and inside the subquery
 * both names resolve against `exam_attempt`, so the correlation compared the attempt to
 * itself and every exam reported that nobody had sat it. A teacher was told "no one yet"
 * under a paper thirteen people had handed in, and the delete dialog never warned that it
 * was about to destroy their work. The builder qualifies both sides.
 */
export function examAttemptCountForRow(dbClient: DbOrTxClient, condition?: SQL): SQL<number> {
  const belongsToRow = eq(schema.examAttempt.examId, schema.exam.id);

  return sql<number>`${dbClient
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.examAttempt)
    .where(condition ? and(belongsToRow, condition) : belongsToRow)}`;
}

/**
 * The exams of a course, each carrying how many people have sat it.
 *
 * The counts come with the list because they are what a teacher opens the page to find
 * out: whether anyone has taken the exam yet, and whether any of it is waiting to be
 * marked by hand. Fetching them per row afterwards would be one request per exam to
 * answer a question the list is supposed to answer at a glance.
 *
 * Counted per exam rather than by aggregating the whole table and joining. Grouping
 * `exam_attempt` in full would sort every attempt in the database on every load of one
 * course's list, and the planner puts that aggregate inside a nested loop; a predicate on
 * `exam_id` uses `idx_exam_attempt_exam_id` instead, which is the shape that keeps working
 * as the table grows.
 */
export async function listExamsByCourseId(
  courseId: string,
  options: { includeDeleted?: boolean } = {},
  dbClient: DbOrTxClient = db
) {
  const countWhere = (condition?: SQL) => examAttemptCountForRow(dbClient, condition);

  return dbClient
    .select({
      // Named columns, not the whole row. `select()` also carried `paperSnapshot` — the
      // frozen paper with its answer keys — plus `corrections` and `passwordHash`, and this
      // list is server-rendered, so all of it was being written into the HTML of a page a
      // teacher opens. Forty kilobytes of answer key per exam, to draw a row that needs a
      // title and a status.
      id: schema.exam.id,
      title: schema.exam.title,
      slug: schema.exam.slug,
      status: schema.exam.status,
      mode: schema.exam.mode,
      workingSeconds: schema.exam.workingSeconds,
      opensAt: schema.exam.opensAt,
      closesAt: schema.exam.closesAt,
      maxAttempts: schema.exam.maxAttempts,
      requiresName: schema.exam.requiresName,
      requiresClass: schema.exam.requiresClass,
      requiresCandidateNumber: schema.exam.requiresCandidateNumber,
      createdAt: schema.exam.createdAt,
      // Carried so the list can tell a deleted exam from a live one. It is only ever
      // non-null when the caller asked for deleted exams.
      deletedAt: schema.exam.deletedAt,
      sat: countWhere(),
      inProgress: countWhere(sql`${schema.examAttempt.status} = 'in_progress'`),
      awaitingManual: countWhere(sql`${schema.examAttempt.gradingState} = 'awaiting_manual'`)
    })
    .from(schema.exam)
    .where(
      options.includeDeleted
        ? eq(schema.exam.courseId, courseId)
        : and(eq(schema.exam.courseId, courseId), isNull(schema.exam.deletedAt))
    )
    .orderBy(desc(schema.exam.createdAt));
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

/**
 * Writes a subset of the exam's settings. The caller decides which keys reach this
 * function: it applies whatever it is handed, so `status`, `paperSnapshot`, `slug`, and
 * `exerciseId` must never be included by the caller — those are not settings, they are
 * the identity of the paper and the state machine around it.
 */
export async function updateExam(
  id: string,
  values: Partial<typeof schema.exam.$inferInsert>,
  dbClient: DbOrTxClient = db
) {
  const [exam] = await dbClient
    .update(schema.exam)
    .set({ ...values, updatedAt: new Date().toISOString() })
    .where(and(eq(schema.exam.id, id), isNull(schema.exam.deletedAt)))
    .returning();

  return exam ?? null;
}
