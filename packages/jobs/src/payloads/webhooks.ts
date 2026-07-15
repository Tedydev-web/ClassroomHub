import * as z from 'zod';

export const ZWebhookDeliveryPayload = z.object({
  deliveryId: z.uuid()
});

export type WebhookDeliveryPayload = z.infer<typeof ZWebhookDeliveryPayload>;
