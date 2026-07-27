import type { JobsOptions } from 'bullmq';
import { createHash } from 'node:crypto';

import {
  ZExamImportAiSuggestionPayload,
  ZExamImportPayload,
  type TExamImportAiSuggestionPayload,
  type TExamImportPayload
} from '../payloads/exam-import';
import { QUEUE_DEFAULTS } from '../queues/defaults';
import { getQueue } from '../queues/factories';
import { JOB_NAMES, QUEUE_NAMES } from '../queues/names';

export function examImportJobId(importId: string, checkpoint?: string): string {
  return checkpoint ? `exam-import-${importId}-${checkpoint}` : `exam-import-${importId}`;
}

export async function enqueueExamImport(
  rawPayload: TExamImportPayload,
  options: Omit<JobsOptions, 'jobId'> = {},
  checkpoint?: string
): Promise<string | undefined> {
  const payload = ZExamImportPayload.parse(rawPayload);
  const job = await getQueue(QUEUE_NAMES.courseImports).add(JOB_NAMES.courseImports.runExamImport, payload, {
    ...QUEUE_DEFAULTS[QUEUE_NAMES.courseImports],
    ...options,
    jobId: examImportJobId(payload.importId, checkpoint)
  });

  return job.id;
}

export async function enqueueExamImportAiSuggestion(
  rawPayload: TExamImportAiSuggestionPayload
): Promise<string | undefined> {
  const payload = ZExamImportAiSuggestionPayload.parse(rawPayload);
  const questionIdsHash = createHash('sha256').update(payload.questionIds.join('\u0000')).digest('hex').slice(0, 16);
  const job = await getQueue(QUEUE_NAMES.courseImports).add(JOB_NAMES.courseImports.suggestExamImportRegion, payload, {
    ...QUEUE_DEFAULTS[QUEUE_NAMES.courseImports],
    jobId: `exam-import-ai-suggestion-${payload.importId}-${questionIdsHash}-${Date.parse(payload.expectedDraftUpdatedAt)}`,
    removeOnComplete: true,
    removeOnFail: true
  });

  return job.id;
}
