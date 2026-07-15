import './../bootstrap';

import { Worker } from 'bullmq';

import { recordDeadLetterJob } from '@cio/db/queries';
import { JOB_NAMES, QUEUE_NAMES, createRedisConnection } from '@cio/jobs';

import { errorMessage } from '../utils/cancel';
import { log } from '../utils/logger';
import { processWebhookDelivery } from '../processors/webhooks';

const connection = createRedisConnection();

// ponytail: global ordering is intentionally conservative; use per-endpoint BullMQ groups when measured throughput requires it.
const worker = new Worker(
  QUEUE_NAMES.webhooks,
  async (job) => {
    if (job.name !== JOB_NAMES.webhooks.deliver) {
      throw new Error(`Unknown webhooks job: ${job.name}`);
    }

    return processWebhookDelivery(job.data, job.attemptsMade + 1, job.opts.attempts ?? 1);
  },
  { connection, concurrency: 1 }
);

worker.on('failed', async (job, error) => {
  if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) {
    return;
  }

  log.error('webhook-delivery-exhausted', {
    bullmqJobId: job.id,
    deliveryId: job.data.deliveryId,
    error: errorMessage(error)
  });
  await recordDeadLetterJob({
    organizationId: null,
    domain: 'webhooks',
    runId: null,
    queueName: QUEUE_NAMES.webhooks,
    jobName: job.name,
    bullmqJobId: job.id ?? null,
    payload: job.data as Record<string, unknown>,
    error: { code: 'WORKER_EXHAUSTED_RETRIES', message: errorMessage(error), stack: error.stack },
    attempts: job.attemptsMade
  });
});

worker.on('ready', () => log.info('webhooks-worker-ready'));
worker.on('error', (error) => log.error('webhooks-worker-error', { error: errorMessage(error) }));

async function shutdown(signal: string) {
  log.info('webhooks-worker-shutdown', { signal });
  await worker.close();
  await connection.quit();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
