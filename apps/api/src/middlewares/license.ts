import type { Context, Next } from 'hono';

import type { LicenseFeatureId } from '@cio/utils/license';
import { isFeatureLicensed } from '@api/services/license';

/**
 * Middleware that returns 403 when this deployment does not own the requested capability.
 */
export function requireLicense(feature: LicenseFeatureId | string) {
  return async (c: Context, next: Next) => {
    const licensed = await isFeatureLicensed(feature);
    if (!licensed) {
      return c.json(
        {
          success: false,
          error: 'FEATURE_REQUIRES_LICENSE',
          message: `This deployment does not enable the requested feature.`
        },
        403
      );
    }
    await next();
  };
}
