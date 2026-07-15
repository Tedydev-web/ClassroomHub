import type { JobsOptions } from 'bullmq';

import { QUEUE_DEFAULTS } from '../queues/defaults';
import { JOB_NAMES, QUEUE_NAMES } from '../queues/names';
import { getQueue } from '../queues/factories';
import type { WebhookDeliveryPayload } from '../payloads/webhooks';

export async function enqueueWebhookDelivery(payload: WebhookDeliveryPayload, options: JobsOptions = {}) {
  const job = await getQueue(QUEUE_NAMES.webhooks).add(JOB_NAMES.webhooks.deliver, payload, {
    ...QUEUE_DEFAULTS[QUEUE_NAMES.webhooks],
    ...options,
    jobId: options.jobId ?? `webhook-delivery-${payload.deliveryId}`
  });

  return job.id;
}
