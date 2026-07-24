import { ZWebhookDeliveryPayload } from '@cio/jobs';
import { getWebhookDelivery, recordWebhookDeliveryResult, recordWebhookEndpointOutcome } from '@cio/db/queries/webhook';
import { assertWebhookUrl, decryptWebhookSecret, signWebhookPayload } from '@cio/core/utils/webhook-security';

import { env } from '../../config/env';

const RESPONSE_BODY_LIMIT = 4096;

export async function processWebhookDelivery(rawPayload: unknown, attempt: number, maxAttempts: number) {
  const payload = ZWebhookDeliveryPayload.parse(rawPayload);
  const deliveryData = await getWebhookDelivery(payload.deliveryId);
  if (!deliveryData) {
    throw new Error('Webhook delivery not found');
  }

  const { delivery, endpoint, event } = deliveryData;
  if (!endpoint.isActive) {
    await recordWebhookDeliveryResult({
      attempt,
      deliveryId: delivery.id,
      durationMs: 0,
      errorMessage: 'Webhook endpoint is inactive',
      status: 'GAVE_UP'
    });

    return { skipped: true };
  }

  const startedAt = Date.now();

  try {
    await assertWebhookUrl(endpoint.payloadUrl, env.PUBLIC_IS_SELFHOSTED === 'true');
    const body = JSON.stringify({ ...event.payload, id: event.id });
    const timestamp = Math.floor(Date.now() / 1000);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'ClassroomHub-Webhooks/1.0',
      'X-ClassroomHub-Delivery': delivery.id,
      'X-ClassroomHub-Event': event.eventType,
      'X-ClassroomHub-Timestamp': `${timestamp}`,
      'X-ClassroomHub-Webhook': endpoint.id
    };
    if (endpoint.secretCiphertext) {
      const secret = decryptWebhookSecret(endpoint.secretCiphertext, env.WEBHOOK_ENCRYPTION_KEY ?? '');
      headers['X-ClassroomHub-Signature-256'] = signWebhookPayload(timestamp, body, secret);
    }

    const response = await fetch(endpoint.payloadUrl, {
      body,
      headers,
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000)
    });
    const responseBody = (await response.text()).slice(0, RESPONSE_BODY_LIMIT);
    const durationMs = Date.now() - startedAt;
    if (!response.ok) {
      throw new WebhookHttpError(response.status, responseBody);
    }

    await recordWebhookDeliveryResult({
      attempt,
      deliveryId: delivery.id,
      durationMs,
      responseBody,
      responseStatus: response.status,
      status: 'SUCCESS'
    });
    await recordWebhookEndpointOutcome(endpoint.id, true);

    return { responseStatus: response.status };
  } catch (error) {
    const isFinalAttempt = attempt >= maxAttempts;
    const durationMs = Date.now() - startedAt;
    const responseStatus = error instanceof WebhookHttpError ? error.status : undefined;
    const responseBody = error instanceof WebhookHttpError ? error.body : undefined;
    const errorMessage = error instanceof Error ? error.message : String(error);
    await recordWebhookDeliveryResult({
      attempt,
      deliveryId: delivery.id,
      durationMs,
      errorMessage,
      responseBody,
      responseStatus,
      status: isFinalAttempt ? 'GAVE_UP' : 'RETRYING'
    });
    await recordWebhookEndpointOutcome(endpoint.id, false);

    throw error;
  }
}

class WebhookHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string
  ) {
    super(`Webhook target returned HTTP ${status}`);
  }
}
