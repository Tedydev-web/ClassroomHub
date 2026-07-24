import { zValidator } from '@hono/zod-validator';

import { Hono } from '@api/utils/hono';
import { ZListUsersQuery } from '@cio/utils/validation/admin/admin';
import { handleError } from '@api/utils/errors';
import {
  getAdminUserChat,
  getAdminUserStats,
  impersonateUser,
  listAdminUserChats,
  listAdminUsers
} from '@api/services/admin/users';

/**
 * Super-admin user surface. Mounted behind `superAdminMiddleware` by the admin
 * aggregate router, so these handlers assume the caller is already authorized.
 */
export const adminUsersRouter = new Hono()
  .get('/users', zValidator('query', ZListUsersQuery), async (c) => {
    try {
      const result = await listAdminUsers(c.req.valid('query'));
      return c.json({ success: true as const, data: result });
    } catch (error) {
      return handleError(c, error, 'Failed to list users');
    }
  })

  .get('/users/:userId', async (c) => {
    try {
      const stats = await getAdminUserStats(c.req.param('userId'));
      return c.json({ success: true as const, data: stats });
    } catch (error) {
      return handleError(c, error, 'Failed to load user');
    }
  })

  .post('/users/:userId/impersonate', async (c) => {
    try {
      const result = await impersonateUser(c.req.param('userId'));
      return c.json({ success: true as const, data: result });
    } catch (error) {
      return handleError(c, error, 'Failed to create impersonation link');
    }
  })

  .get('/users/:userId/chats', async (c) => {
    try {
      const chats = await listAdminUserChats(c.req.param('userId'));
      return c.json({ success: true as const, data: chats });
    } catch (error) {
      return handleError(c, error, 'Failed to list conversations');
    }
  })

  .get('/users/:userId/chats/:chatId', async (c) => {
    try {
      const chat = await getAdminUserChat(c.req.param('chatId'), c.req.param('userId'));
      return c.json({ success: true as const, data: chat });
    } catch (error) {
      return handleError(c, error, 'Failed to load conversation');
    }
  });
