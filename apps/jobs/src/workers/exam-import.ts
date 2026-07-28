import './../bootstrap';

import { UnrecoverableError, Worker } from 'bullmq';

import { JOB_NAMES, QUEUE_NAMES, createRedisConnection } from '@cio/jobs';

import { handleExamImportFinalFailure, processExamImport } from '../processors/exam-import';
import { closeExamImportAiLeaseConnection } from '../processors/exam-import/ai-lease';
import { processExamImportAiSuggestion } from '../processors/exam-import/ai-suggestion';
import { errorMessage } from '../utils/cancel';
import { log } from '../utils/logger';

const concurrency = 1;
const connection = createRedisConnection();
const finalFailureTasks = new Set<Promise<void>>();

const worker = new Worker(
  QUEUE_NAMES.courseImports,
  async (job) => {
    log.info('exam-import-job-start', {
      jobName: job.name,
      bullmqJobId: job.id,
      attempt: job.attemptsMade + 1
    });

    switch (job.name) {
      case JOB_NAMES.courseImports.runExamImport:
        return processExamImport(job.data);
      case JOB_NAMES.courseImports.suggestExamImportRegion:
        return processExamImportAiSuggestion(job.data);
      default:
        throw new UnrecoverableError(`Unknown exam import job: ${job.name}`);
    }
  },
  { connection, concurrency }
);

worker.on('failed', (job, error) => {
  if (!job) return;

  log.error('exam-import-job-failed', {
    jobName: job.name,
    bullmqJobId: job.id,
    attempt: job.attemptsMade,
    error: errorMessage(error)
  });

  const isFinalAttempt =
    error instanceof UnrecoverableError ||
    error.name === 'UnrecoverableError' ||
    job.attemptsMade >= (job.opts.attempts ?? 1);
  if (!isFinalAttempt) return;
  if (job.name !== JOB_NAMES.courseImports.runExamImport) return;

  const finalFailureTask = handleExamImportFinalFailure({
    rawPayload: job.data,
    error,
    jobName: job.name,
    bullmqJobId: job.id ?? null,
    attempts: job.attemptsMade
  }).catch((handlerError: unknown) => {
    log.error('exam-import-final-failure-handler-crashed', {
      bullmqJobId: job.id,
      error: errorMessage(handlerError)
    });
  });
  finalFailureTasks.add(finalFailureTask);
  void finalFailureTask.finally(() => finalFailureTasks.delete(finalFailureTask));
});

worker.on('ready', () => log.info('exam-import-worker-ready', { concurrency, queue: QUEUE_NAMES.courseImports }));
worker.on('error', (error) => log.error('exam-import-worker-error', { error: errorMessage(error) }));

const shutdown = async (signal: string) => {
  log.info('exam-import-worker-shutdown', { signal });
  await worker.close();
  await Promise.allSettled([...finalFailureTasks]);
  await closeExamImportAiLeaseConnection();
  await connection.quit();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
