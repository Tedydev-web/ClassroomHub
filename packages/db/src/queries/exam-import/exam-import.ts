import * as schema from '@db/schema';

import { and, asc, eq, inArray, isNull, lt, or, sql } from '@db/drizzle';
import { db, type DbOrTxClient, type TxClient } from '@db/drizzle';
import type { TExamImport, TExamImportDraft, TExamImportExtractor, TExamImportFailure, TJobStatus } from '@db/types';

export type ExamImportScope = {
  organizationId: string;
  courseId: string;
  importId: string;
};

export type CreateExamImportInput = {
  organizationId: string;
  courseId: string;
  actorProfileId: string;
  sourceAssetId: string;
  extractor: TExamImportExtractor;
};

export type MarkExamImportRunningInput = {
  startedAt: string;
};

export type MarkExamImportDraftReadyInput = {
  sectionCount: number;
  questionCount: number;
  reviewRequiredCount: number;
  blockingIssueCount: number;
  warningCount: number;
  draftReadyAt: string;
};

export type MarkExamImportFailedInput = {
  failure: TExamImportFailure;
  failedAt: string;
};

export type RecordExamImportAiRegionInput = {
  expectedCursor: number;
  questionId: string;
  reasons: string[];
  requestHash: string;
  sentAt: string;
  model: string;
};

export type MarkExamImportPublishedInput = {
  publishedExerciseId: string;
  publishedAt: string;
};

export type ReplaceExamImportDraftInput = {
  draft: Record<string, unknown>;
  embeddedAssets: Array<{ storageKey: string }>;
  schemaVersion: number;
  expiresAt: string;
};

export type UpdateExamImportDraftSummaryInput = {
  sectionCount: number;
  questionCount: number;
  reviewRequiredCount: number;
  blockingIssueCount: number;
  warningCount: number;
};

export type ExpiredExamImportDraft = {
  scope: ExamImportScope;
  status: TExamImport['status'];
  embeddedAssets: Array<{ storageKey: string }>;
};

export type TerminalExamImportSourceCheckpoint = ExamImportScope & {
  sourceStepStatus: TJobStatus;
};

function examImportScopeConditions(scope: ExamImportScope) {
  return and(
    eq(schema.examImport.id, scope.importId),
    eq(schema.examImport.organizationId, scope.organizationId),
    eq(schema.examImport.courseId, scope.courseId)
  );
}

export async function createExamImport(
  input: CreateExamImportInput,
  dbClient: DbOrTxClient = db
): Promise<TExamImport> {
  try {
    const [created] = await dbClient.insert(schema.examImport).values(input).returning();

    if (!created) {
      throw new Error('Insert returned no row');
    }

    return created;
  } catch (error) {
    console.error('createExamImport error:', error);
    throw new Error('Failed to create exam import');
  }
}

export async function getExamImportById(
  scope: ExamImportScope,
  dbClient: DbOrTxClient = db
): Promise<TExamImport | null> {
  try {
    const [examImport] = await dbClient
      .select()
      .from(schema.examImport)
      .where(examImportScopeConditions(scope))
      .limit(1);

    return examImport ?? null;
  } catch (error) {
    console.error('getExamImportById error:', error);
    throw new Error('Failed to get exam import');
  }
}

export async function listQueuedExamImports(limit: number, dbClient: DbOrTxClient = db): Promise<TExamImport[]> {
  try {
    return await dbClient
      .select()
      .from(schema.examImport)
      .where(inArray(schema.examImport.status, ['queued', 'waiting_for_ai']))
      .orderBy(asc(schema.examImport.createdAt))
      .limit(limit);
  } catch (error) {
    console.error('listQueuedExamImports error:', error);
    throw new Error('Failed to list queued exam imports');
  }
}

export async function reapStuckExamImports(
  staleBeforeIso: string,
  dbClient: DbOrTxClient = db
): Promise<TExamImport[]> {
  try {
    const updatedAt = new Date().toISOString();

    return await dbClient
      .update(schema.examImport)
      .set({
        status: 'failed',
        failure: {
          code: 'EXAM_IMPORT_STALE',
          message: 'Exam import exceeded the processing time limit'
        },
        draftReadyAt: null,
        publishedExerciseId: null,
        publishedAt: null,
        updatedAt
      })
      .where(and(eq(schema.examImport.status, 'running'), lt(schema.examImport.updatedAt, staleBeforeIso)))
      .returning();
  } catch (error) {
    console.error('reapStuckExamImports error:', error);
    throw new Error('Failed to reap stuck exam imports');
  }
}

export async function listExpiredExamImportDrafts(
  expiredBeforeIso: string,
  limit: number,
  dbClient: DbOrTxClient = db
): Promise<ExpiredExamImportDraft[]> {
  try {
    const rows = await dbClient
      .select({
        importId: schema.examImport.id,
        organizationId: schema.examImport.organizationId,
        courseId: schema.examImport.courseId,
        status: schema.examImport.status,
        embeddedAssets: schema.examImportDraft.embeddedAssets
      })
      .from(schema.examImportDraft)
      .innerJoin(schema.examImport, eq(schema.examImport.id, schema.examImportDraft.importId))
      .where(
        and(
          lt(schema.examImportDraft.expiresAt, expiredBeforeIso),
          isNull(schema.examImportDraft.cleanupCompletedAt),
          or(eq(schema.examImport.status, 'draft_ready'), eq(schema.examImport.status, 'failed'))
        )
      )
      .orderBy(asc(schema.examImportDraft.expiresAt))
      .limit(limit);

    return rows.map((row) => ({
      scope: {
        importId: row.importId,
        organizationId: row.organizationId,
        courseId: row.courseId
      },
      status: row.status,
      embeddedAssets: row.embeddedAssets
    }));
  } catch (error) {
    console.error('listExpiredExamImportDrafts error:', error);
    throw new Error('Failed to list expired exam import drafts');
  }
}

export async function listTerminalExamImportSourceCheckpoints(
  limit: number,
  dbClient: DbOrTxClient = db
): Promise<TerminalExamImportSourceCheckpoint[]> {
  try {
    return await dbClient
      .select({
        importId: schema.examImport.id,
        organizationId: schema.examImport.organizationId,
        courseId: schema.examImport.courseId,
        sourceStepStatus: schema.jobStep.status
      })
      .from(schema.examImport)
      .innerJoin(
        schema.jobStep,
        and(
          eq(schema.jobStep.domain, 'exam-import'),
          eq(schema.jobStep.runId, schema.examImport.id),
          eq(schema.jobStep.stepKey, 'source')
        )
      )
      .where(inArray(schema.examImport.status, ['failed', 'canceled']))
      .orderBy(asc(schema.examImport.updatedAt))
      .limit(limit);
  } catch (error) {
    console.error('listTerminalExamImportSourceCheckpoints error:', error);
    throw new Error('Failed to list terminal exam import source checkpoints');
  }
}

export async function markExamImportDraftExpired(
  scope: ExamImportScope,
  expiredBeforeIso: string,
  dbClient: DbOrTxClient = db
): Promise<TExamImport | null> {
  try {
    const [updated] = await dbClient
      .update(schema.examImport)
      .set({
        status: 'failed',
        failure: {
          code: 'EXAM_IMPORT_DRAFT_EXPIRED',
          message: 'Exam import draft expired before publication'
        },
        draftReadyAt: null,
        updatedAt: new Date().toISOString()
      })
      .where(
        and(
          examImportScopeConditions(scope),
          eq(schema.examImport.status, 'draft_ready'),
          sql`exists (
            select 1
            from ${schema.examImportDraft}
            where ${schema.examImportDraft.importId} = ${schema.examImport.id}
              and ${schema.examImportDraft.expiresAt} < ${expiredBeforeIso}
              and ${schema.examImportDraft.cleanupCompletedAt} is null
          )`
        )
      )
      .returning();

    return updated ?? null;
  } catch (error) {
    console.error('markExamImportDraftExpired error:', error);
    throw new Error('Failed to mark exam import draft expired');
  }
}

export async function markExamImportDraftCleanupCompleted(
  importId: string,
  dbClient: DbOrTxClient = db
): Promise<TExamImportDraft | null> {
  try {
    const [updated] = await dbClient
      .update(schema.examImportDraft)
      .set({
        cleanupCompletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
      .where(and(eq(schema.examImportDraft.importId, importId), isNull(schema.examImportDraft.cleanupCompletedAt)))
      .returning();

    return updated ?? null;
  } catch (error) {
    console.error('markExamImportDraftCleanupCompleted error:', error);
    throw new Error('Failed to mark exam import draft cleanup completed');
  }
}

export async function lockExamImportById(scope: ExamImportScope, tx: TxClient): Promise<TExamImport | null> {
  try {
    const [examImport] = await tx
      .select()
      .from(schema.examImport)
      .where(examImportScopeConditions(scope))
      .limit(1)
      .for('update');

    return examImport ?? null;
  } catch (error) {
    console.error('lockExamImportById error:', error);
    throw new Error('Failed to lock exam import');
  }
}

export async function markExamImportRunning(
  scope: ExamImportScope,
  input: MarkExamImportRunningInput,
  dbClient: DbOrTxClient = db
): Promise<TExamImport | null> {
  try {
    const updatedAt = new Date().toISOString();
    const [updated] = await dbClient
      .update(schema.examImport)
      .set({
        status: 'running',
        startedAt: sql`coalesce(${schema.examImport.startedAt}, ${input.startedAt})`,
        draftReadyAt: null,
        publishedAt: null,
        failure: null,
        publishedExerciseId: null,
        updatedAt
      })
      .where(and(examImportScopeConditions(scope), inArray(schema.examImport.status, ['queued', 'waiting_for_ai'])))
      .returning();

    return updated ?? null;
  } catch (error) {
    console.error('markExamImportRunning error:', error);
    throw new Error('Failed to mark exam import running');
  }
}

export async function markExamImportWaitingForAi(
  scope: ExamImportScope,
  dbClient: DbOrTxClient = db
): Promise<TExamImport | null> {
  try {
    const [updated] = await dbClient
      .update(schema.examImport)
      .set({
        status: 'waiting_for_ai',
        updatedAt: new Date().toISOString()
      })
      .where(and(examImportScopeConditions(scope), eq(schema.examImport.status, 'running')))
      .returning();

    return updated ?? null;
  } catch (error) {
    console.error('markExamImportWaitingForAi error:', error);
    throw new Error('Failed to mark exam import waiting for AI');
  }
}

export async function recordExamImportAiRegion(
  scope: ExamImportScope,
  input: RecordExamImportAiRegionInput,
  dbClient: DbOrTxClient = db
): Promise<TExamImport | null> {
  try {
    const auditEntry = {
      questionId: input.questionId,
      reasons: input.reasons,
      requestHash: input.requestHash,
      sentAt: input.sentAt
    };
    const [updated] = await dbClient
      .update(schema.examImport)
      .set({
        aiRegionAudit: sql`${schema.examImport.aiRegionAudit} || ${JSON.stringify([auditEntry])}::jsonb`,
        aiCursor: input.expectedCursor + 1,
        aiAttempt: sql`${schema.examImport.aiAttempt} + 1`,
        aiModel: input.model,
        updatedAt: new Date().toISOString()
      })
      .where(
        and(
          examImportScopeConditions(scope),
          inArray(schema.examImport.status, ['running', 'draft_ready']),
          eq(schema.examImport.aiCursor, input.expectedCursor)
        )
      )
      .returning();

    return updated ?? null;
  } catch (error) {
    console.error('recordExamImportAiRegion error:', error);
    throw new Error('Failed to record exam import AI region');
  }
}

export async function touchExamImportRunning(scope: ExamImportScope, dbClient: DbOrTxClient = db): Promise<boolean> {
  try {
    const updated = await dbClient
      .update(schema.examImport)
      .set({ updatedAt: new Date().toISOString() })
      .where(and(examImportScopeConditions(scope), eq(schema.examImport.status, 'running')))
      .returning({ id: schema.examImport.id });

    return updated.length > 0;
  } catch (error) {
    console.error('touchExamImportRunning error:', error);
    throw new Error('Failed to touch running exam import');
  }
}

export async function markExamImportDraftReady(
  scope: ExamImportScope,
  input: MarkExamImportDraftReadyInput,
  tx: TxClient
): Promise<TExamImport | null> {
  try {
    const updatedAt = new Date().toISOString();
    const [updated] = await tx
      .update(schema.examImport)
      .set({
        status: 'draft_ready',
        sectionCount: input.sectionCount,
        questionCount: input.questionCount,
        reviewRequiredCount: input.reviewRequiredCount,
        blockingIssueCount: input.blockingIssueCount,
        warningCount: input.warningCount,
        draftReadyAt: input.draftReadyAt,
        failure: null,
        publishedExerciseId: null,
        publishedAt: null,
        updatedAt
      })
      .where(and(examImportScopeConditions(scope), eq(schema.examImport.status, 'running')))
      .returning();

    return updated ?? null;
  } catch (error) {
    console.error('markExamImportDraftReady error:', error);
    throw new Error('Failed to mark exam import draft ready');
  }
}

export async function markExamImportFailed(
  scope: ExamImportScope,
  input: MarkExamImportFailedInput,
  dbClient: DbOrTxClient = db
): Promise<TExamImport | null> {
  try {
    const updatedAt = new Date().toISOString();
    const [updated] = await dbClient
      .update(schema.examImport)
      .set({
        status: 'failed',
        startedAt: sql`coalesce(${schema.examImport.startedAt}, ${input.failedAt})`,
        failure: input.failure,
        draftReadyAt: null,
        publishedExerciseId: null,
        publishedAt: null,
        updatedAt
      })
      .where(
        and(
          examImportScopeConditions(scope),
          inArray(schema.examImport.status, ['queued', 'running', 'waiting_for_ai'])
        )
      )
      .returning();

    return updated ?? null;
  } catch (error) {
    console.error('markExamImportFailed error:', error);
    throw new Error('Failed to mark exam import failed');
  }
}

export async function markExamImportPublished(
  scope: ExamImportScope,
  input: MarkExamImportPublishedInput,
  tx: TxClient
): Promise<TExamImport | null> {
  try {
    const updatedAt = new Date().toISOString();
    const [updated] = await tx
      .update(schema.examImport)
      .set({
        status: 'published',
        publishedExerciseId: input.publishedExerciseId,
        publishedAt: input.publishedAt,
        failure: null,
        updatedAt
      })
      .where(and(examImportScopeConditions(scope), eq(schema.examImport.status, 'draft_ready')))
      .returning();

    return updated ?? null;
  } catch (error) {
    console.error('markExamImportPublished error:', error);
    throw new Error('Failed to mark exam import published');
  }
}

export async function markExamImportCanceled(
  scope: ExamImportScope,
  dbClient: DbOrTxClient = db
): Promise<TExamImport | null> {
  try {
    const updatedAt = new Date().toISOString();
    const [updated] = await dbClient
      .update(schema.examImport)
      .set({
        status: 'canceled',
        failure: null,
        draftReadyAt: null,
        publishedExerciseId: null,
        publishedAt: null,
        updatedAt
      })
      .where(
        and(
          examImportScopeConditions(scope),
          inArray(schema.examImport.status, ['queued', 'running', 'waiting_for_ai'])
        )
      )
      .returning();

    return updated ?? null;
  } catch (error) {
    console.error('markExamImportCanceled error:', error);
    throw new Error('Failed to mark exam import canceled');
  }
}

export async function getExamImportDraft(
  scope: ExamImportScope,
  dbClient: DbOrTxClient = db
): Promise<TExamImportDraft | null> {
  try {
    const [result] = await dbClient
      .select({ draft: schema.examImportDraft })
      .from(schema.examImportDraft)
      .innerJoin(schema.examImport, eq(schema.examImport.id, schema.examImportDraft.importId))
      .where(examImportScopeConditions(scope))
      .limit(1);

    return result?.draft ?? null;
  } catch (error) {
    console.error('getExamImportDraft error:', error);
    throw new Error('Failed to get exam import draft');
  }
}

export async function updateExamImportDraftSummary(
  scope: ExamImportScope,
  input: UpdateExamImportDraftSummaryInput,
  tx: TxClient
): Promise<TExamImport | null> {
  try {
    const updatedAt = new Date().toISOString();
    const [updated] = await tx
      .update(schema.examImport)
      .set({
        sectionCount: input.sectionCount,
        questionCount: input.questionCount,
        reviewRequiredCount: input.reviewRequiredCount,
        blockingIssueCount: input.blockingIssueCount,
        warningCount: input.warningCount,
        updatedAt
      })
      .where(and(examImportScopeConditions(scope), eq(schema.examImport.status, 'draft_ready')))
      .returning();

    return updated ?? null;
  } catch (error) {
    console.error('updateExamImportDraftSummary error:', error);
    throw new Error('Failed to update exam import draft summary');
  }
}

export async function replaceExamImportDraft(
  scope: ExamImportScope,
  input: ReplaceExamImportDraftInput,
  tx: TxClient
): Promise<TExamImportDraft | null> {
  try {
    const lockedImport = await lockExamImportById(scope, tx);

    if (!lockedImport) {
      return null;
    }

    const updatedAt = new Date().toISOString();
    const [draft] = await tx
      .insert(schema.examImportDraft)
      .values({
        importId: scope.importId,
        ...input
      })
      .onConflictDoUpdate({
        target: schema.examImportDraft.importId,
        set: {
          ...input,
          updatedAt
        }
      })
      .returning();

    return draft ?? null;
  } catch (error) {
    console.error('replaceExamImportDraft error:', error);
    throw new Error('Failed to replace exam import draft');
  }
}
