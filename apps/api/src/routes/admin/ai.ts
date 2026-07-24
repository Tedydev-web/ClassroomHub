import { zValidator } from '@hono/zod-validator';

import { Hono } from '@api/utils/hono';
import { handleError } from '@api/utils/errors';
import { superAdminMiddleware } from '@api/middlewares/super-admin';
import {
  ZGatewayOrgParam,
  ZGatewayOrgPolicyPatch,
  ZGatewayPause,
  ZGatewayRunParam,
  ZGatewayRunsQuery,
  ZGatewaySettingsPatch
} from '@cio/utils/validation/admin/ai-gateway';
import {
  forceCancelGatewayRun,
  getGatewayHealth,
  getGatewayQuota,
  getRedactedGatewaySettings,
  listGatewayRuns,
  listOrgGatewayPolicies,
  pauseGateway,
  resetGatewayBreaker,
  resumeGateway,
  updateGatewaySettings,
  updateOrgGatewayPolicy
} from '@api/services/admin/ai-gateway';

/**
 * Operator API for the shared AI gateway.
 *
 * Platform-scoped by design: the gateway is a singleton backed by one
 * subscription, so its health and quota belong here rather than in any
 * organization's own admin UI, where the numbers would leak cross-tenant
 * consumption and could not be acted on anyway.
 */
export const adminAiRouter = new Hono()
  .use('/*', superAdminMiddleware)

  /** Reachability, auth, serve-probe, and breaker state. */
  .get('/health', async (c) => {
    try {
      const skipServeProbe = c.req.query('skipProbe') === 'true';
      const health = await getGatewayHealth({ skipServeProbe });

      return c.json({ success: true as const, data: health });
    } catch (error) {
      return handleError(c, error, 'Failed to read gateway health');
    }
  })

  /** Window consumption plus the heaviest consuming organizations. */
  .get('/quota', async (c) => {
    try {
      const quota = await getGatewayQuota();

      return c.json({ success: true as const, data: quota });
    } catch (error) {
      return handleError(c, error, 'Failed to read gateway quota');
    }
  })

  .get('/settings', async (c) => {
    try {
      const settings = await getRedactedGatewaySettings();

      return c.json({ success: true as const, data: settings });
    } catch (error) {
      return handleError(c, error, 'Failed to read gateway settings');
    }
  })

  .patch('/settings', zValidator('json', ZGatewaySettingsPatch), async (c) => {
    try {
      const settings = await updateGatewaySettings(c.req.valid('json'));

      return c.json({ success: true as const, data: settings });
    } catch (error) {
      return handleError(c, error, 'Failed to update gateway settings');
    }
  })

  /** Kill switch. Takes effect at the next slice boundary, without a redeploy. */
  .post('/pause', zValidator('json', ZGatewayPause), async (c) => {
    try {
      const { reason, pausedBy } = c.req.valid('json');
      const settings = await pauseGateway(reason, pausedBy ?? null);

      return c.json({ success: true as const, data: settings });
    } catch (error) {
      return handleError(c, error, 'Failed to pause gateway');
    }
  })

  .post('/resume', async (c) => {
    try {
      const settings = await resumeGateway();

      return c.json({ success: true as const, data: settings });
    } catch (error) {
      return handleError(c, error, 'Failed to resume gateway');
    }
  })

  .post('/breaker/reset', async (c) => {
    try {
      const settings = await resetGatewayBreaker();

      return c.json({ success: true as const, data: settings });
    } catch (error) {
      return handleError(c, error, 'Failed to reset gateway breaker');
    }
  })

  .get('/orgs', async (c) => {
    try {
      const data = await listOrgGatewayPolicies();

      return c.json({ success: true as const, data });
    } catch (error) {
      return handleError(c, error, 'Failed to list organization gateway policies');
    }
  })

  .patch(
    '/orgs/:orgId',
    zValidator('param', ZGatewayOrgParam),
    zValidator('json', ZGatewayOrgPolicyPatch),
    async (c) => {
      try {
        const { orgId } = c.req.valid('param');
        const limits = await updateOrgGatewayPolicy(orgId, c.req.valid('json'));

        return c.json({ success: true as const, data: limits });
      } catch (error) {
        return handleError(c, error, 'Failed to update organization gateway policy');
      }
    }
  )

  /** Cross-org run list for triage; filter with `?status=running,queued`. */
  .get('/runs', zValidator('query', ZGatewayRunsQuery), async (c) => {
    try {
      const { status, limit } = c.req.valid('query');
      const runs = await listGatewayRuns({ statuses: status, limit });

      return c.json({ success: true as const, data: runs });
    } catch (error) {
      return handleError(c, error, 'Failed to list gateway runs');
    }
  })

  /** Stops a run at its next safe boundary — never mid-tool-call. */
  .post('/runs/:runId/cancel', zValidator('param', ZGatewayRunParam), async (c) => {
    try {
      const { runId } = c.req.valid('param');
      const run = await forceCancelGatewayRun(runId);

      return c.json({ success: true as const, data: run });
    } catch (error) {
      return handleError(c, error, 'Failed to cancel gateway run');
    }
  });
