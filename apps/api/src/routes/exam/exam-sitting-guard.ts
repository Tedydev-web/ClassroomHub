import { AppError, ErrorCodes } from '@api/utils/errors';
import { resolveTrustedBrowserOriginForCors } from '@api/utils/origins';

export const REQUIRED_HEADER = 'x-exam-sitting';

/**
 * The forgery guard on the unauthenticated sitting writes.
 *
 * Either proof is enough, and both rest on the same fact: a cross-site page can make the
 * browser send our `SameSite=None` cookie, but it cannot set a custom header without a
 * CORS preflight we would refuse, and it cannot forge an `Origin`.
 *
 * The header alone was the original check, and it is fragile for reasons that have
 * nothing to do with security: it must survive a same-origin proxy hop, a tunnel, and
 * whatever the sitter has installed in their browser. When it goes missing the request
 * reads as forgery and the paper refuses to open — a bad way to lose a candidate.
 * Accepting a trusted origin costs nothing, because an attacker's origin is not on the
 * list.
 */
export function requireSittingRequest(c: { req: { header: (name: string) => string | undefined } }): void {
  if (c.req.header(REQUIRED_HEADER) === '1') return;

  const origin = c.req.header('origin');
  if (origin && resolveTrustedBrowserOriginForCors(origin)) return;

  throw new AppError('Missing sitting header', ErrorCodes.FORBIDDEN, 403);
}
