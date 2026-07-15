import { randomBytes } from 'node:crypto';

import type { TCreateWebhook, TUpdateWebhook } from '@cio/utils/validation/webhook';
import {
  createWebhookEndpoint,
  createWebhookTestDelivery,
  deleteWebhookEndpoint,
  getWebhookEndpoint,
  listWebhookDeliveries,
  listWebhookEndpoints,
  resetWebhookDelivery,
  updateWebhookEndpoint
} from '@cio/db/queries/webhook';

import { AppError, ErrorCodes } from '@api/utils/errors';
import { assertWebhookUrl, encryptWebhookSecret } from '@cio/core/utils/webhook-security';
import { enqueueWebhookDelivery } from '@cio/jobs';
import { env } from '@cio/core/config/env';

function encryptionSecret(): string {
  if (!env.WEBHOOK_ENCRYPTION_KEY) {
    throw new AppError('Webhook encryption is not configured', ErrorCodes.INTERNAL_ERROR, 503);
  }

  return env.WEBHOOK_ENCRYPTION_KEY;
}

function publicEndpoint<T extends { secretCiphertext: string | null }>(endpoint: T) {
  const { secretCiphertext: _secretCiphertext, ...result } = endpoint;

  return result;
}

export async function createOrganizationWebhook(organizationId: string, profileId: string, input: TCreateWebhook) {
  await assertWebhookUrl(input.payloadUrl, env.PUBLIC_IS_SELFHOSTED === 'true');
  if (!input.verifySsl) {
    throw new AppError('Disabling TLS verification is not supported', ErrorCodes.VALIDATION_ERROR, 400);
  }

  const secret = input.secret ?? randomBytes(32).toString('base64url');
  const secretCiphertext = encryptWebhookSecret(secret, encryptionSecret());
  const endpoint = await createWebhookEndpoint(
    {
      organizationId,
      name: input.name,
      payloadUrl: input.payloadUrl,
      secretCiphertext,
      secretLast4: secret.slice(-4),
      verifySsl: input.verifySsl,
      isActive: input.isActive,
      createdByProfileId: profileId,
      updatedByProfileId: profileId
    },
    input.events
  );

  return { ...publicEndpoint(endpoint), secret };
}

export async function listOrganizationWebhooks(organizationId: string) {
  const endpoints = await listWebhookEndpoints(organizationId);

  return endpoints.map(publicEndpoint);
}

export async function getOrganizationWebhook(organizationId: string, webhookId: string) {
  const endpoint = await getWebhookEndpoint(organizationId, webhookId);
  if (!endpoint) {
    throw new AppError('Webhook not found', ErrorCodes.NOT_FOUND, 404);
  }

  return publicEndpoint(endpoint);
}

export async function updateOrganizationWebhook(
  organizationId: string,
  profileId: string,
  webhookId: string,
  input: TUpdateWebhook
) {
  if (input.payloadUrl) {
    await assertWebhookUrl(input.payloadUrl, env.PUBLIC_IS_SELFHOSTED === 'true');
  }
  if (input.verifySsl === false) {
    throw new AppError('Disabling TLS verification is not supported', ErrorCodes.VALIDATION_ERROR, 400);
  }

  const secretCiphertext = input.secret ? encryptWebhookSecret(input.secret, encryptionSecret()) : undefined;
  const endpoint = await updateWebhookEndpoint(
    organizationId,
    webhookId,
    {
      name: input.name,
      payloadUrl: input.payloadUrl,
      secretCiphertext,
      secretLast4: input.secret?.slice(-4),
      verifySsl: input.verifySsl,
      isActive: input.isActive,
      updatedByProfileId: profileId,
      updatedAt: new Date().toISOString()
    },
    input.events
  );
  if (!endpoint) {
    throw new AppError('Webhook not found', ErrorCodes.NOT_FOUND, 404);
  }

  return publicEndpoint(endpoint);
}

export async function removeOrganizationWebhook(organizationId: string, webhookId: string) {
  const deleted = await deleteWebhookEndpoint(organizationId, webhookId);
  if (!deleted) {
    throw new AppError('Webhook not found', ErrorCodes.NOT_FOUND, 404);
  }

  return deleted;
}

export async function sendOrganizationWebhookTest(organizationId: string, webhookId: string) {
  const delivery = await createWebhookTestDelivery(organizationId, webhookId);
  if (!delivery) {
    throw new AppError('Webhook not found', ErrorCodes.NOT_FOUND, 404);
  }

  await enqueueWebhookDelivery({ deliveryId: delivery.id });

  return delivery;
}

export function getOrganizationWebhookDeliveries(
  organizationId: string,
  webhookId: string,
  page: number,
  limit: number
) {
  return listWebhookDeliveries(organizationId, webhookId, page, limit);
}

export async function redeliverOrganizationWebhook(organizationId: string, webhookId: string, deliveryId: string) {
  const delivery = await resetWebhookDelivery(organizationId, webhookId, deliveryId);
  if (!delivery) {
    throw new AppError('Webhook delivery not found', ErrorCodes.NOT_FOUND, 404);
  }

  await enqueueWebhookDelivery({ deliveryId }, { jobId: `webhook-redelivery-${deliveryId}-${Date.now()}` });

  return delivery;
}
