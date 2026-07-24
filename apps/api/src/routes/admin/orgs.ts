import { ZAddCredits, ZCreateAdminOrg } from '@cio/utils/validation/admin/admin';

import { Hono } from '@api/utils/hono';
import { addOrgCredits, createOrgForUser } from '@api/services/admin/orgs';
import { handleError } from '@api/utils/errors';
import { zValidator } from '@hono/zod-validator';

/**
 * Super-admin org surface: create an org for a chosen owner, and top up an
 * org's AI credits. Behind `superAdminMiddleware` via the aggregate router.
 */
export const adminOrgsRouter = new Hono()
  .post('/orgs', zValidator('json', ZCreateAdminOrg), async (c) => {
    try {
      const result = await createOrgForUser(c.req.valid('json'));
      return c.json({ success: true as const, data: result }, 201);
    } catch (error) {
      return handleError(c, error, 'Failed to create organization');
    }
  })

  .post('/orgs/:orgId/credits', zValidator('json', ZAddCredits), async (c) => {
    try {
      const { amount } = c.req.valid('json');
      const result = await addOrgCredits(c.req.param('orgId'), amount);
      return c.json({ success: true as const, data: result });
    } catch (error) {
      return handleError(c, error, 'Failed to add credits');
    }
  });
