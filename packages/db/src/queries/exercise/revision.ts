import { createHash } from 'node:crypto';

import * as schema from '@db/schema';

import type { TQuestion, TQuestionRevision } from '@db/types';
import { and, db, eq, inArray, isNull, max, sql } from '@db/drizzle';
import type { DbOrTxClient } from '@db/drizzle';

/**
 * Deterministic SHA-256 hex digest of a canonical assessment definition serialization.
 * The caller must pass the canonical JSON produced by `@cio/question-types/assessment`
 * (stable key order), so the same definition content always yields the same hash.
 * Kept server-side on purpose: `node:crypto` must not enter browser-bundled packages.
 */
export function computeQuestionRevisionContentHash(canonicalDefinitionJson: string): string {
  return createHash('sha256').update(canonicalDefinitionJson).digest('hex');
}

export type QuestionRowForRevision = {
  id: number;
  exerciseId: string;
  title: string;
  order: number | null;
  exerciseSectionId: string | null;
  questionTypeId: number;
  points: number | null;
  settings: unknown;
  archivedAt: string | null;
  currentRevisionId: string | null;
  options: Array<{ id: number; label: string; value: string | null; isCorrect: boolean }>;
};

/**
 * Loads the exact question row (plus options and owning exercise) that the revision
 * gateway resolves or materializes. Archived questions are included on purpose:
 * historical resolution must be able to materialize a question after its removal.
 */
export async function getQuestionWithOptionsForRevision(
  questionId: number,
  dbClient: DbOrTxClient = db
): Promise<QuestionRowForRevision | null> {
  try {
    const [questionRow] = await dbClient
      .select({
        id: schema.question.id,
        exerciseId: schema.question.exerciseId,
        title: schema.question.title,
        order: schema.question.order,
        exerciseSectionId: schema.question.exerciseSectionId,
        questionTypeId: schema.question.questionTypeId,
        points: schema.question.points,
        settings: schema.question.settings,
        archivedAt: schema.question.archivedAt,
        currentRevisionId: schema.question.currentRevisionId
      })
      .from(schema.question)
      .where(eq(schema.question.id, questionId))
      .limit(1);
    if (!questionRow) return null;

    // Stable option order keeps the adapted definition (and its content hash) deterministic.
    const options = await dbClient
      .select({
        id: schema.option.id,
        label: schema.option.label,
        value: schema.option.value,
        isCorrect: schema.option.isCorrect
      })
      .from(schema.option)
      .where(eq(schema.option.questionId, questionId))
      .orderBy(schema.option.id);

    return { ...questionRow, options };
  } catch (error) {
    console.error('getQuestionWithOptionsForRevision error:', error);
    throw new Error(
      `Failed to get question "${questionId}" for revision: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

export type SubmissionAnswerRevisionLink = {
  questionId: number;
  questionRevisionId: string | null;
  archivedAt: string | null;
  currentRevisionId: string | null;
  exerciseId: string;
};

/**
 * One row per stored answer of a submission, joined with the question's archive
 * state and current-revision pointer. Archived and historical questions are
 * included so grading/review keeps working after a question is removed.
 */
export async function getSubmissionAnswerRevisionLinks(
  submissionId: string,
  dbClient: DbOrTxClient = db
): Promise<SubmissionAnswerRevisionLink[]> {
  try {
    return await dbClient
      .select({
        questionId: schema.questionAnswer.questionId,
        questionRevisionId: schema.questionAnswer.questionRevisionId,
        archivedAt: schema.question.archivedAt,
        currentRevisionId: schema.question.currentRevisionId,
        exerciseId: schema.question.exerciseId
      })
      .from(schema.questionAnswer)
      .innerJoin(schema.question, eq(schema.questionAnswer.questionId, schema.question.id))
      .where(eq(schema.questionAnswer.submissionId, submissionId))
      .orderBy(schema.questionAnswer.questionId);
  } catch (error) {
    console.error('getSubmissionAnswerRevisionLinks error:', error);
    throw new Error(
      `Failed to get answer revision links for submission "${submissionId}": ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Gets the current (pointer-referenced) revision of a question, or null when the
 * question has no canonical revision yet and resolves through the legacy path.
 */
export async function getCurrentQuestionRevision(
  questionId: number,
  dbClient: DbOrTxClient = db
): Promise<TQuestionRevision | null> {
  try {
    const [row] = await dbClient
      .select({ revision: schema.questionRevision })
      .from(schema.question)
      .innerJoin(schema.questionRevision, eq(schema.question.currentRevisionId, schema.questionRevision.id))
      .where(eq(schema.question.id, questionId))
      .limit(1);

    return row?.revision ?? null;
  } catch (error) {
    console.error('getCurrentQuestionRevision error:', error);
    throw new Error(
      `Failed to get current revision for question "${questionId}": ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Gets immutable revision rows by ID (historical review reads).
 */
export async function getQuestionRevisionsByIds(
  revisionIds: string[],
  dbClient: DbOrTxClient = db
): Promise<TQuestionRevision[]> {
  if (revisionIds.length === 0) return [];

  try {
    return await dbClient
      .select()
      .from(schema.questionRevision)
      .where(inArray(schema.questionRevision.id, revisionIds));
  } catch (error) {
    console.error('getQuestionRevisionsByIds error:', error);
    throw new Error(
      `Failed to get question revisions by IDs: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Inserts the next monotonic revision for a question (append-only; rows are immutable).
 *
 * The caller must already hold the owning exercise row lock (`lockExerciseAssignmentState`)
 * inside its transaction — that lock is what makes MAX+1 race-free. A concurrent publisher
 * that bypasses the lock fails explicitly on `question_revision_question_id_revision_unique`
 * instead of silently diverging.
 */
export async function insertNextQuestionRevision(
  data: { questionId: number; definition: unknown; contentHash: string },
  dbClient: DbOrTxClient = db
): Promise<TQuestionRevision> {
  try {
    const [current] = await dbClient
      .select({ maxRevision: max(schema.questionRevision.revision) })
      .from(schema.questionRevision)
      .where(eq(schema.questionRevision.questionId, data.questionId));

    const nextRevision = (current?.maxRevision ?? 0) + 1;
    const [inserted] = await dbClient
      .insert(schema.questionRevision)
      .values({
        questionId: data.questionId,
        revision: nextRevision,
        definition: data.definition,
        contentHash: data.contentHash
      })
      .returning();
    if (!inserted) {
      throw new Error('Insert returned no row');
    }

    return inserted;
  } catch (error) {
    console.error('insertNextQuestionRevision error:', error);
    throw new Error(
      `Failed to insert next revision for question "${data.questionId}": ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Promotes a revision to current and writes the `question.points` compatibility projection
 * in the same UPDATE, so the pointer and the projection can never diverge. The composite
 * `question_current_revision_fkey` rejects a revision that belongs to another question.
 */
export async function promoteQuestionCurrentRevision(
  questionId: number,
  revisionId: string,
  points: number,
  dbClient: DbOrTxClient = db
): Promise<TQuestion | null> {
  try {
    const [updated] = await dbClient
      .update(schema.question)
      .set({ currentRevisionId: revisionId, points, updatedAt: new Date().toISOString() })
      .where(eq(schema.question.id, questionId))
      .returning();

    return updated ?? null;
  } catch (error) {
    console.error('promoteQuestionCurrentRevision error:', error);
    throw new Error(
      `Failed to promote revision "${revisionId}" for question "${questionId}": ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Returns the subset of the given question IDs that have at least one answer.
 * Attempted questions must be archived instead of deleted.
 */
export async function getAttemptedQuestionIds(questionIds: number[], dbClient: DbOrTxClient = db): Promise<number[]> {
  if (questionIds.length === 0) return [];

  try {
    const rows = await dbClient
      .selectDistinct({ questionId: schema.questionAnswer.questionId })
      .from(schema.questionAnswer)
      .where(inArray(schema.questionAnswer.questionId, questionIds));

    return rows.map((row) => row.questionId);
  } catch (error) {
    console.error('getAttemptedQuestionIds error:', error);
    throw new Error(
      `Failed to get attempted question IDs: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Archives questions (hides them from active delivery while keeping answers and revisions
 * reviewable). Already-archived rows are left untouched so the original archive time survives.
 */
export async function archiveQuestionsByIds(questionIds: number[], dbClient: DbOrTxClient = db): Promise<TQuestion[]> {
  if (questionIds.length === 0) return [];

  try {
    return await dbClient
      .update(schema.question)
      .set({ archivedAt: sql`now()`, updatedAt: new Date().toISOString() })
      .where(and(inArray(schema.question.id, questionIds), isNull(schema.question.archivedAt)))
      .returning();
  } catch (error) {
    console.error('archiveQuestionsByIds error:', error);
    throw new Error(`Failed to archive questions: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
