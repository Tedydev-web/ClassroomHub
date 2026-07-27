import * as schema from '@db/schema';

import { and, eq, ne } from '@db/drizzle';
import { db, type DbOrTxClient } from '@db/drizzle';
import type { TJobStatus, TJobStep, TNewJobStep } from '@db/types';

/**
 * Generic checkpoint ledger. Workers look up `(domain, runId, stepKey)` first
 * and short-circuit when the step has a result, making BullMQ retries safe
 * even after partial completion.
 */

export interface UpsertJobStepInput {
  domain: string;
  runId: string;
  stepKey: string;
  status: TJobStatus;
  inputHash?: string | null;
  providerId?: string | null;
  result?: Record<string, unknown> | null;
  error?: { code: string; message: string; details?: unknown } | null;
  attempt?: number;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export async function getJobStep(
  domain: string,
  runId: string,
  stepKey: string,
  dbClient: DbOrTxClient = db
): Promise<TJobStep | null> {
  try {
    const [row] = await dbClient
      .select()
      .from(schema.jobStep)
      .where(
        and(eq(schema.jobStep.domain, domain), eq(schema.jobStep.runId, runId), eq(schema.jobStep.stepKey, stepKey))
      )
      .limit(1);

    return row ?? null;
  } catch (error) {
    console.error('getJobStep error:', error);
    throw new Error('Failed to get job step');
  }
}

export async function listJobStepsByRun(
  domain: string,
  runId: string,
  dbClient: DbOrTxClient = db
): Promise<TJobStep[]> {
  try {
    return await dbClient
      .select()
      .from(schema.jobStep)
      .where(and(eq(schema.jobStep.domain, domain), eq(schema.jobStep.runId, runId)));
  } catch (error) {
    console.error('listJobStepsByRun error:', error);
    throw new Error('Failed to list job steps');
  }
}

export async function deleteJobStep(
  domain: string,
  runId: string,
  stepKey: string,
  dbClient: DbOrTxClient = db
): Promise<boolean> {
  try {
    const deleted = await dbClient
      .delete(schema.jobStep)
      .where(
        and(eq(schema.jobStep.domain, domain), eq(schema.jobStep.runId, runId), eq(schema.jobStep.stepKey, stepKey))
      )
      .returning({ id: schema.jobStep.id });

    return deleted.length > 0;
  } catch (error) {
    console.error('deleteJobStep error:', error);
    throw new Error('Failed to delete job step');
  }
}

export async function upsertJobStep(input: UpsertJobStepInput, dbClient: DbOrTxClient = db): Promise<TJobStep> {
  try {
    const values: TNewJobStep = {
      domain: input.domain,
      runId: input.runId,
      stepKey: input.stepKey,
      status: input.status,
      inputHash: input.inputHash ?? null,
      providerId: input.providerId ?? null,
      result: input.result ?? null,
      error: input.error ?? null,
      attempt: input.attempt ?? 0,
      startedAt: input.startedAt ?? null,
      finishedAt: input.finishedAt ?? null
    };

    const [row] = await dbClient
      .insert(schema.jobStep)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.jobStep.domain, schema.jobStep.runId, schema.jobStep.stepKey],
        setWhere: ne(schema.jobStep.status, 'completed'),
        set: {
          status: input.status,
          inputHash: input.inputHash ?? null,
          providerId: input.providerId ?? null,
          result: input.result ?? null,
          error: input.error ?? null,
          attempt: input.attempt ?? 0,
          startedAt: input.startedAt ?? null,
          finishedAt: input.finishedAt ?? null,
          updatedAt: new Date().toISOString()
        }
      })
      .returning();

    if (!row) {
      const completed = await getJobStep(input.domain, input.runId, input.stepKey, dbClient);
      if (completed?.status === 'completed') {
        return completed;
      }

      throw new Error('Upsert returned no row');
    }

    return row;
  } catch (error) {
    console.error('upsertJobStep error:', error);
    throw new Error('Failed to upsert job step');
  }
}
