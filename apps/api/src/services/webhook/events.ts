import type { TWebhookEventType } from '@cio/utils/validation/webhook';
import { createWebhookEventDeliveries } from '@cio/db/queries/webhook';
import { enqueueWebhookDelivery } from '@cio/jobs';

export async function emitWebhookEvent(
  organizationId: string,
  eventType: TWebhookEventType,
  data: Record<string, unknown>
) {
  const createdAt = new Date().toISOString();
  const deliveries = await createWebhookEventDeliveries(organizationId, eventType, {
    apiVersion: '2026-07-15',
    createdAt,
    data,
    organization: { id: organizationId },
    type: eventType
  });

  await Promise.all(deliveries.map((delivery) => enqueueWebhookDelivery({ deliveryId: delivery.id })));

  return deliveries.length;
}
