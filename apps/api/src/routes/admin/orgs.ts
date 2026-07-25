import {
  ZAddCredits,
  ZAdminOrgParam,
  ZCreateAdminOrg,
  ZUpdateOrgAiTutor,
  ZUpdateOrgFeatures
} from '@cio/utils/validation/admin/admin';

import { Hono } from '@api/utils/hono';
import {
  addOrgCredits,
  createOrgForUser,
  listOrgFeatures,
  setOrgAiTutorEnabled,
  setOrgFeatures
} from '@api/services/admin/orgs';
import { handleError } from '@api/utils/errors';
import { zValidator } from '@hono/zod-validator';

/**
 * Super-admin org surface: create an org for a chosen owner, top up an org's AI
 * credits, and toggle its AI tutor. Behind `superAdminMiddleware` via the
 * aggregate router.
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
  })

  .patch(
    '/orgs/:orgId/ai-tutor',
    zValidator('param', ZAdminOrgParam),
    zValidator('json', ZUpdateOrgAiTutor),
    async (c) => {
      try {
        const { orgId } = c.req.valid('param');
        const { enabled } = c.req.valid('json');
        const result = await setOrgAiTutorEnabled(orgId, enabled);

        return c.json({ success: true as const, data: result });
      } catch (error) {
        return handleError(c, error, 'Failed to update organization AI tutor');
      }
    }
  )

  .get('/orgs/features', async (c) => {
    try {
      const data = await listOrgFeatures();
      return c.json({ success: true as const, data });
    } catch (error) {
      return handleError(c, error, 'Failed to list organization features');
    }
  })

  .patch(
    '/orgs/:orgId/features',
    zValidator('param', ZAdminOrgParam),
    zValidator('json', ZUpdateOrgFeatures),
    async (c) => {
      try {
        const { orgId } = c.req.valid('param');
        const { features } = c.req.valid('json');
        const result = await setOrgFeatures(orgId, features);

        return c.json({ success: true as const, data: result });
      } catch (error) {
        return handleError(c, error, 'Failed to update organization features');
      }
    }
  );
