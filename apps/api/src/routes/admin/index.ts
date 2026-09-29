import { Hono } from '@api/utils/hono';
import { adminHealthRouter } from './health';
import { adminOrgsRouter } from './orgs';
import { adminUsersRouter } from './users';
import { superAdminMiddleware } from '@api/middlewares/super-admin';

/**
 * Aggregate super-admin router for user and org management and platform health. The password gate is
 * applied once here, so the child routers assume an authorized caller.
 *
 * The AI-gateway operator API mounts separately under `/admin/ai`; keeping these
 * apart lets each ship and evolve on its own.
 */
export const adminRouter = new Hono()
  .use('/*', superAdminMiddleware)
  .route('/', adminUsersRouter)
  .route('/', adminOrgsRouter)
  .route('/health', adminHealthRouter);
