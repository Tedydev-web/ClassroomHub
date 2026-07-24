import type { Context, Next } from 'hono';

/**
 * Gates the operator-only `/admin/*` API.
 *
 * Mirrors the queue-dashboard convention already in
 * `apps/api/src/routes/admin/queues.ts`: a single shared secret, compared in
 * constant time, and unusable in production until it is configured. Development
 * stays open so local operators are not blocked on setting a secret.
 *
 * Reads `process.env` directly rather than the parsed `env` snapshot. This is a
 * raw credential gate, not validated configuration, and reading at call time
 * keeps the check honest about the process's actual environment.
 */
export async function superAdminMiddleware(c: Context, next: Next): Promise<Response | void> {
  const expected = process.env.SUPER_ADMIN_PASSWORD;

  if (!expected) {
    if (process.env.NODE_ENV !== 'production') {
      return next();
    }

    return c.json({ success: false as const, error: 'Super admin API is not configured' }, 503);
  }

  const provided = c.req.header('X-Super-Admin-Key');

  if (!provided || !timingSafeEqual(provided, expected)) {
    return c.json({ success: false as const, error: 'Unauthorized' }, 401);
  }

  return next();
}

/**
 * Constant-time comparison.
 *
 * Returning early on the first differing byte would leak how much of the secret
 * a caller guessed correctly, so every byte is compared regardless.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let mismatch = 0;

  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return mismatch === 0;
}
