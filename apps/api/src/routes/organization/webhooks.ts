import {
  ZCreateWebhook,
  ZUpdateWebhook,
  ZWebhookDeliveryListQuery,
  ZWebhookDeliveryParams,
  ZWebhookParams
} from '@cio/utils/validation/webhook';
import {
  createOrganizationWebhook,
  getOrganizationWebhook,
  getOrganizationWebhookDeliveries,
  listOrganizationWebhooks,
  redeliverOrganizationWebhook,
  removeOrganizationWebhook,
  sendOrganizationWebhookTest,
  updateOrganizationWebhook
} from '@api/services/webhook';

import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { handleError } from '@api/utils/errors';
import { orgAdminMiddleware } from '@api/middlewares/org-admin';
import { zValidator } from '@hono/zod-validator';

export const webhooksRouter = new Hono()
  .get('/', authMiddleware, orgAdminMiddleware, async (c) => {
    try {
      const organizationId = c.get('orgId')!;
      const endpoints = await listOrganizationWebhooks(organizationId);

      return c.json({ success: true, data: endpoints }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to list webhooks');
    }
  })
  .post('/', authMiddleware, orgAdminMiddleware, zValidator('json', ZCreateWebhook), async (c) => {
    try {
      const organizationId = c.get('orgId')!;
      const user = c.get('user')!;
      const endpoint = await createOrganizationWebhook(organizationId, user.id, c.req.valid('json'));

      return c.json({ success: true, data: endpoint }, 201);
    } catch (error) {
      return handleError(c, error, 'Failed to create webhook');
    }
  })
  .get('/:webhookId', authMiddleware, orgAdminMiddleware, zValidator('param', ZWebhookParams), async (c) => {
    try {
      const organizationId = c.get('orgId')!;
      const endpoint = await getOrganizationWebhook(organizationId, c.req.valid('param').webhookId);

      return c.json({ success: true, data: endpoint }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to get webhook');
    }
  })
  .put(
    '/:webhookId',
    authMiddleware,
    orgAdminMiddleware,
    zValidator('param', ZWebhookParams),
    zValidator('json', ZUpdateWebhook),
    async (c) => {
      try {
        const organizationId = c.get('orgId')!;
        const user = c.get('user')!;
        const endpoint = await updateOrganizationWebhook(
          organizationId,
          user.id,
          c.req.valid('param').webhookId,
          c.req.valid('json')
        );

        return c.json({ success: true, data: endpoint }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to update webhook');
      }
    }
  )
  .delete('/:webhookId', authMiddleware, orgAdminMiddleware, zValidator('param', ZWebhookParams), async (c) => {
    try {
      const organizationId = c.get('orgId')!;
      const result = await removeOrganizationWebhook(organizationId, c.req.valid('param').webhookId);

      return c.json({ success: true, data: result }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to delete webhook');
    }
  })
  .post('/:webhookId/test', authMiddleware, orgAdminMiddleware, zValidator('param', ZWebhookParams), async (c) => {
    try {
      const organizationId = c.get('orgId')!;
      const delivery = await sendOrganizationWebhookTest(organizationId, c.req.valid('param').webhookId);

      return c.json({ success: true, data: delivery }, 202);
    } catch (error) {
      return handleError(c, error, 'Failed to send webhook test');
    }
  })
  .get(
    '/:webhookId/deliveries',
    authMiddleware,
    orgAdminMiddleware,
    zValidator('param', ZWebhookParams),
    zValidator('query', ZWebhookDeliveryListQuery),
    async (c) => {
      try {
        const organizationId = c.get('orgId')!;
        const { webhookId } = c.req.valid('param');
        const { page, limit } = c.req.valid('query');
        const deliveries = await getOrganizationWebhookDeliveries(organizationId, webhookId, page, limit);

        return c.json({ success: true, data: deliveries }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to list webhook deliveries');
      }
    }
  )
  .post(
    '/:webhookId/deliveries/:deliveryId/redeliver',
    authMiddleware,
    orgAdminMiddleware,
    zValidator('param', ZWebhookDeliveryParams),
    async (c) => {
      try {
        const organizationId = c.get('orgId')!;
        const { webhookId, deliveryId } = c.req.valid('param');
        const delivery = await redeliverOrganizationWebhook(organizationId, webhookId, deliveryId);

        return c.json({ success: true, data: delivery }, 202);
      } catch (error) {
        return handleError(c, error, 'Failed to redeliver webhook');
      }
    }
  );
