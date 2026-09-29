import { Hono } from '@api/utils/hono';
import { handleError } from '@api/utils/errors';
import {
  readScheduledHealthReport,
  runSystemHealthChecks,
  sendHealthTestEmail
} from '@cio/core/services/system-health/index';

/**
 * Platform health for the operator console.
 *
 * `live` is measured now, in the API process; `scheduled` is the jobs worker's last scan.
 * Both are returned because the two processes carry different environments — a key set on
 * the API but missing from jobs breaks background work while every live check passes.
 */
export const adminHealthRouter = new Hono()
  .get('/', async (c) => {
    try {
      const [live, scheduled] = await Promise.all([runSystemHealthChecks('api'), readScheduledHealthReport()]);

      return c.json({ success: true as const, data: { live, scheduled } });
    } catch (error) {
      return handleError(c, error, 'Failed to run health checks');
    }
  })

  /** Sends a real message to the operator inbox through the production send path. */
  .post('/test-email', async (c) => {
    try {
      const result = await sendHealthTestEmail();

      return c.json({ success: true as const, data: result });
    } catch (error) {
      return handleError(c, error, 'Failed to send test email');
    }
  });
