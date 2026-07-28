import { getExamImportById, markExamImportFailed } from '@cio/db/queries/exam-import';
import { recordDeadLetterJob } from '@cio/db/queries/jobs';
import { QUEUE_NAMES, ZExamImportPayload } from '@cio/jobs';

import { log } from '../../utils/logger';
import { cleanupExamImportSourceArtifact, toExamImportFailure } from './process';

export type ExamImportFinalFailureInput = {
  rawPayload: unknown;
  error: Error;
  jobName: string;
  bullmqJobId: string | null;
  attempts: number;
};

export async function handleExamImportFinalFailure(input: ExamImportFinalFailureInput): Promise<void> {
  const payloadResult = ZExamImportPayload.safeParse(input.rawPayload);
  const failure = toExamImportFailure(input.error);

  if (payloadResult.success) {
    try {
      const updated = await markExamImportFailed(
        {
          importId: payloadResult.data.importId,
          organizationId: payloadResult.data.organizationId,
          courseId: payloadResult.data.courseId
        },
        {
          failure,
          failedAt: new Date().toISOString()
        }
      );
      if (updated) {
        await cleanupExamImportSourceArtifact(payloadResult.data.importId, true);
      } else {
        log.warn('exam-import-final-state-not-updated', {
          importId: payloadResult.data.importId,
          reason: 'state-transition-rejected'
        });
        const current = await getExamImportById({
          importId: payloadResult.data.importId,
          organizationId: payloadResult.data.organizationId,
          courseId: payloadResult.data.courseId
        });
        await cleanupExamImportSourceArtifact(payloadResult.data.importId, current?.status === 'canceled');
      }
    } catch (error) {
      log.error('exam-import-final-state-update-failed', {
        importId: payloadResult.data.importId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  const payloadRecord: Record<string, unknown> =
    typeof input.rawPayload === 'object' && input.rawPayload !== null
      ? { ...input.rawPayload }
      : { payloadType: typeof input.rawPayload };

  try {
    await recordDeadLetterJob({
      organizationId: payloadResult.success ? payloadResult.data.organizationId : null,
      domain: 'exam-import',
      runId: payloadResult.success ? payloadResult.data.importId : null,
      queueName: QUEUE_NAMES.courseImports,
      jobName: input.jobName,
      bullmqJobId: input.bullmqJobId,
      payload: payloadRecord,
      error: {
        ...failure,
        stack: input.error.stack
      },
      attempts: input.attempts
    });
  } catch (error) {
    log.error('exam-import-dead-letter-write-failed', {
      bullmqJobId: input.bullmqJobId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
