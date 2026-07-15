import * as schema from '@db/schema';

import type { TNewWebhookEndpoint } from '@db/types';
import { and, count, db, desc, eq, inArray } from '@db/drizzle';

export async function createWebhookEndpoint(data: TNewWebhookEndpoint, events: string[]) {
  try {
    return await db.transaction(async (tx) => {
      const [endpoint] = await tx.insert(schema.webhookEndpoint).values(data).returning();
      if (!endpoint) {
        throw new Error('Webhook endpoint was not created');
      }

      if (events.length > 0) {
        await tx
          .insert(schema.webhookSubscription)
          .values(events.map((eventType) => ({ webhookId: endpoint.id, eventType })));
      }

      return { ...endpoint, events };
    });
  } catch (error) {
    console.error('createWebhookEndpoint error:', error);
    throw new Error('Failed to create webhook endpoint');
  }
}

export async function getWebhookEndpoint(organizationId: string, webhookId: string) {
  try {
    const [endpoint] = await db
      .select()
      .from(schema.webhookEndpoint)
      .where(and(eq(schema.webhookEndpoint.id, webhookId), eq(schema.webhookEndpoint.organizationId, organizationId)))
      .limit(1);
    if (!endpoint) {
      return null;
    }

    const subscriptions = await db
      .select({ eventType: schema.webhookSubscription.eventType })
      .from(schema.webhookSubscription)
      .where(eq(schema.webhookSubscription.webhookId, webhookId));

    return { ...endpoint, events: subscriptions.map((subscription) => subscription.eventType) };
  } catch (error) {
    console.error('getWebhookEndpoint error:', error);
    throw new Error('Failed to get webhook endpoint');
  }
}

export async function listWebhookEndpoints(organizationId: string) {
  try {
    const endpoints = await db
      .select()
      .from(schema.webhookEndpoint)
      .where(eq(schema.webhookEndpoint.organizationId, organizationId))
      .orderBy(desc(schema.webhookEndpoint.createdAt));
    if (endpoints.length === 0) {
      return [];
    }

    const subscriptions = await db
      .select()
      .from(schema.webhookSubscription)
      .where(
        inArray(
          schema.webhookSubscription.webhookId,
          endpoints.map((endpoint) => endpoint.id)
        )
      );

    return endpoints.map((endpoint) => ({
      ...endpoint,
      events: subscriptions
        .filter((subscription) => subscription.webhookId === endpoint.id)
        .map((subscription) => subscription.eventType)
    }));
  } catch (error) {
    console.error('listWebhookEndpoints error:', error);
    throw new Error('Failed to list webhook endpoints');
  }
}

export async function updateWebhookEndpoint(
  organizationId: string,
  webhookId: string,
  data: Partial<Omit<TNewWebhookEndpoint, 'id' | 'organizationId' | 'createdAt'>>,
  events?: string[]
) {
  try {
    return await db.transaction(async (tx) => {
      const [endpoint] = await tx
        .update(schema.webhookEndpoint)
        .set(data)
        .where(and(eq(schema.webhookEndpoint.id, webhookId), eq(schema.webhookEndpoint.organizationId, organizationId)))
        .returning();
      if (!endpoint) {
        return null;
      }

      if (events) {
        await tx.delete(schema.webhookSubscription).where(eq(schema.webhookSubscription.webhookId, webhookId));
        if (events.length > 0) {
          await tx.insert(schema.webhookSubscription).values(events.map((eventType) => ({ webhookId, eventType })));
        }
      }

      const subscriptions = await tx
        .select({ eventType: schema.webhookSubscription.eventType })
        .from(schema.webhookSubscription)
        .where(eq(schema.webhookSubscription.webhookId, webhookId));

      return { ...endpoint, events: subscriptions.map((subscription) => subscription.eventType) };
    });
  } catch (error) {
    console.error('updateWebhookEndpoint error:', error);
    throw new Error('Failed to update webhook endpoint');
  }
}

export async function deleteWebhookEndpoint(organizationId: string, webhookId: string) {
  try {
    const [deleted] = await db
      .delete(schema.webhookEndpoint)
      .where(and(eq(schema.webhookEndpoint.id, webhookId), eq(schema.webhookEndpoint.organizationId, organizationId)))
      .returning({ id: schema.webhookEndpoint.id });

    return deleted ?? null;
  } catch (error) {
    console.error('deleteWebhookEndpoint error:', error);
    throw new Error('Failed to delete webhook endpoint');
  }
}

export async function createWebhookEventDeliveries(
  organizationId: string,
  eventType: string,
  payload: Record<string, unknown>
) {
  try {
    return await db.transaction(async (tx) => {
      const endpoints = await tx
        .select()
        .from(schema.webhookEndpoint)
        .where(
          and(eq(schema.webhookEndpoint.organizationId, organizationId), eq(schema.webhookEndpoint.isActive, true))
        );
      if (endpoints.length === 0) {
        return [];
      }

      const subscriptions = await tx
        .select()
        .from(schema.webhookSubscription)
        .where(
          inArray(
            schema.webhookSubscription.webhookId,
            endpoints.map((endpoint) => endpoint.id)
          )
        );
      const subscribedEndpoints = endpoints.filter((endpoint) => {
        const endpointEvents = subscriptions.filter((subscription) => subscription.webhookId === endpoint.id);

        return (
          endpointEvents.length === 0 || endpointEvents.some((subscription) => subscription.eventType === eventType)
        );
      });
      if (subscribedEndpoints.length === 0) {
        return [];
      }

      const [event] = await tx.insert(schema.webhookEvent).values({ organizationId, eventType, payload }).returning();
      if (!event) {
        throw new Error('Webhook event was not created');
      }

      return tx
        .insert(schema.webhookDelivery)
        .values(subscribedEndpoints.map((endpoint) => ({ eventId: event.id, webhookId: endpoint.id })))
        .returning();
    });
  } catch (error) {
    console.error('createWebhookEventDeliveries error:', error);
    throw new Error('Failed to create webhook event deliveries');
  }
}

export async function createWebhookTestDelivery(organizationId: string, webhookId: string) {
  try {
    return await db.transaction(async (tx) => {
      const [endpoint] = await tx
        .select({ id: schema.webhookEndpoint.id })
        .from(schema.webhookEndpoint)
        .where(and(eq(schema.webhookEndpoint.id, webhookId), eq(schema.webhookEndpoint.organizationId, organizationId)))
        .limit(1);
      if (!endpoint) {
        return null;
      }

      const [event] = await tx
        .insert(schema.webhookEvent)
        .values({ organizationId, eventType: 'webhook.test', payload: { test: true } })
        .returning();
      if (!event) {
        throw new Error('Webhook test event was not created');
      }

      const [delivery] = await tx.insert(schema.webhookDelivery).values({ eventId: event.id, webhookId }).returning();

      return delivery ?? null;
    });
  } catch (error) {
    console.error('createWebhookTestDelivery error:', error);
    throw new Error('Failed to create webhook test delivery');
  }
}

export async function getWebhookDelivery(deliveryId: string) {
  try {
    const [result] = await db
      .select({ delivery: schema.webhookDelivery, endpoint: schema.webhookEndpoint, event: schema.webhookEvent })
      .from(schema.webhookDelivery)
      .innerJoin(schema.webhookEndpoint, eq(schema.webhookDelivery.webhookId, schema.webhookEndpoint.id))
      .innerJoin(schema.webhookEvent, eq(schema.webhookDelivery.eventId, schema.webhookEvent.id))
      .where(eq(schema.webhookDelivery.id, deliveryId))
      .limit(1);

    return result ?? null;
  } catch (error) {
    console.error('getWebhookDelivery error:', error);
    throw new Error('Failed to get webhook delivery');
  }
}

export async function recordWebhookDeliveryResult(input: {
  deliveryId: string;
  attempt: number;
  status: 'RETRYING' | 'SUCCESS' | 'FAILED' | 'GAVE_UP';
  responseStatus?: number;
  responseBody?: string;
  errorMessage?: string;
  durationMs: number;
}) {
  try {
    const [delivery] = await db
      .update(schema.webhookDelivery)
      .set({
        attempt: input.attempt,
        status: input.status,
        responseStatus: input.responseStatus,
        responseBody: input.responseBody,
        errorMessage: input.errorMessage,
        durationMs: input.durationMs,
        deliveredAt: input.status === 'SUCCESS' ? new Date().toISOString() : undefined,
        updatedAt: new Date().toISOString()
      })
      .where(eq(schema.webhookDelivery.id, input.deliveryId))
      .returning();

    return delivery ?? null;
  } catch (error) {
    console.error('recordWebhookDeliveryResult error:', error);
    throw new Error('Failed to record webhook delivery result');
  }
}

export async function recordWebhookEndpointOutcome(webhookId: string, success: boolean) {
  try {
    const endpoint = await getWebhookDeliveryEndpoint(webhookId);
    if (!endpoint) {
      return null;
    }

    const consecutiveFailures = success ? 0 : endpoint.consecutiveFailures + 1;
    const [updated] = await db
      .update(schema.webhookEndpoint)
      .set({
        consecutiveFailures,
        isActive: consecutiveFailures >= 100 ? false : endpoint.isActive,
        updatedAt: new Date().toISOString()
      })
      .where(eq(schema.webhookEndpoint.id, webhookId))
      .returning();

    return updated ?? null;
  } catch (error) {
    console.error('recordWebhookEndpointOutcome error:', error);
    throw new Error('Failed to record webhook endpoint outcome');
  }
}

async function getWebhookDeliveryEndpoint(webhookId: string) {
  const [endpoint] = await db
    .select()
    .from(schema.webhookEndpoint)
    .where(eq(schema.webhookEndpoint.id, webhookId))
    .limit(1);

  return endpoint ?? null;
}

export async function listWebhookDeliveries(organizationId: string, webhookId: string, page: number, limit: number) {
  try {
    const filter = and(
      eq(schema.webhookDelivery.webhookId, webhookId),
      eq(schema.webhookEndpoint.organizationId, organizationId)
    );
    const offset = (page - 1) * limit;
    const rowsPromise = db
      .select({ delivery: schema.webhookDelivery, event: schema.webhookEvent })
      .from(schema.webhookDelivery)
      .innerJoin(schema.webhookEndpoint, eq(schema.webhookDelivery.webhookId, schema.webhookEndpoint.id))
      .innerJoin(schema.webhookEvent, eq(schema.webhookDelivery.eventId, schema.webhookEvent.id))
      .where(filter)
      .orderBy(desc(schema.webhookDelivery.createdAt))
      .limit(limit)
      .offset(offset);
    const totalPromise = db
      .select({ value: count() })
      .from(schema.webhookDelivery)
      .innerJoin(schema.webhookEndpoint, eq(schema.webhookDelivery.webhookId, schema.webhookEndpoint.id))
      .where(filter);
    const [rows, totalRows] = await Promise.all([rowsPromise, totalPromise]);
    const total = totalRows[0]?.value ?? 0;

    return { items: rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  } catch (error) {
    console.error('listWebhookDeliveries error:', error);
    throw new Error('Failed to list webhook deliveries');
  }
}

export async function resetWebhookDelivery(organizationId: string, webhookId: string, deliveryId: string) {
  try {
    const [delivery] = await db
      .update(schema.webhookDelivery)
      .set({
        attempt: 0,
        status: 'PENDING',
        responseStatus: null,
        responseBody: null,
        errorMessage: null,
        durationMs: null,
        deliveredAt: null,
        updatedAt: new Date().toISOString()
      })
      .from(schema.webhookEndpoint)
      .where(
        and(
          eq(schema.webhookDelivery.id, deliveryId),
          eq(schema.webhookDelivery.webhookId, webhookId),
          eq(schema.webhookEndpoint.id, schema.webhookDelivery.webhookId),
          eq(schema.webhookEndpoint.organizationId, organizationId)
        )
      )
      .returning();

    return delivery ?? null;
  } catch (error) {
    console.error('resetWebhookDelivery error:', error);
    throw new Error('Failed to reset webhook delivery');
  }
}
