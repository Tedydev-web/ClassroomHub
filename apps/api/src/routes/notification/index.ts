import { ZNotificationList, ZNotificationParam } from '@cio/utils/validation/notification';
import { listNotifications, readAllNotifications, readNotification } from '@api/services/notification';

import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { handleError } from '@api/utils/errors';
import { orgMemberMiddleware } from '@api/middlewares/org-member';
import { zValidator } from '@hono/zod-validator';

export const notificationRouter = new Hono()
  .get('/', authMiddleware, orgMemberMiddleware, zValidator('query', ZNotificationList), async (c) => {
    try {
      const user = c.get('user')!;
      const organizationId = c.get('orgId')!;
      const { page, limit } = c.req.valid('query');
      const result = await listNotifications(user.id, organizationId, page, limit);

      return c.json({ success: true, data: result }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to fetch notifications');
    }
  })
  .put('/read-all', authMiddleware, orgMemberMiddleware, async (c) => {
    try {
      const user = c.get('user')!;
      const organizationId = c.get('orgId')!;
      const result = await readAllNotifications(user.id, organizationId);

      return c.json({ success: true, data: result }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to mark notifications as read');
    }
  })
  .put(
    '/:notificationId/read',
    authMiddleware,
    orgMemberMiddleware,
    zValidator('param', ZNotificationParam),
    async (c) => {
      try {
        const user = c.get('user')!;
        const organizationId = c.get('orgId')!;
        const { notificationId } = c.req.valid('param');
        const notification = await readNotification(user.id, organizationId, notificationId);

        return c.json({ success: true, data: notification }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to mark notification as read');
      }
    }
  );
