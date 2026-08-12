import { createRateLimiter } from '@api/middlewares/rate-limiter';
import type { MiddlewareHandler } from 'hono';

/**
 * Bounds on a public endpoint that writes to the database, sized against a real class
 * rather than against an imaginary attacker.
 *
 * **The school-network problem is what makes the obvious limit wrong.** Forty students in
 * one room share one public address. A naive per-address limit on starting locks out the
 * back of the class, and the failure is silent from our side and total from the teacher's,
 * in the middle of an exam. So the key combines the address with the exam, and the ceiling
 * is set against a class starting together — a burst of forty in a minute is normal, four
 * hundred is not.
 *
 * Limits differ per endpoint because their legitimate traffic differs by orders of
 * magnitude: starting happens once per sitter, saving happens every few seconds for the
 * length of the paper.
 *
 * **These do not run outside production.** `createRateLimiter` returns early when
 * `NODE_ENV !== 'production'`, so a test that goes through the middleware in development
 * passes while testing nothing. That is why the sizing lives in exported data, tested
 * directly, rather than only inside the middleware.
 */

export type ExamRateLimitedRoute = 'start' | 'save' | 'submit';

export const EXAM_RATE_LIMITS: Record<ExamRateLimitedRoute, { windowMs: number; maxRequests: number }> = {
  /** A class arrives together. Generous enough for forty, far short of a script. */
  start: { windowMs: 60_000, maxRequests: 120 },
  /** One sitter saves every few seconds; a class of forty for an hour is a lot of saves. */
  save: { windowMs: 60_000, maxRequests: 2_000 },
  /** Once per sitter, at the end — but a class finishes together too. */
  submit: { windowMs: 60_000, maxRequests: 120 }
};

/** Default ceiling on sittings per paper, well above a class and well below a script. */
export const DEFAULT_ATTEMPT_CEILING = 200;

/**
 * Keyed by address **and** exam, so one class cannot exhaust the budget of another class
 * sitting a different paper from the same building.
 */
export function examRateLimitKey(route: ExamRateLimitedRoute, addressHash: string, examId: string): string {
  return `exam:${route}:${examId}:${addressHash}`;
}

export function isWithinAttemptCeiling(existingAttempts: number, ceiling: number | null): boolean {
  if (ceiling === null) return true;

  return existingAttempts < ceiling;
}

/**
 * Builds the middleware for one sitting route. The address is read from the forwarding
 * headers the tunnel sets, falling back to the exam alone — which keeps the limit working
 * rather than disabling it when an address cannot be determined.
 */
export function examRateLimiter(route: ExamRateLimitedRoute): MiddlewareHandler {
  const { windowMs, maxRequests } = EXAM_RATE_LIMITS[route];

  return createRateLimiter({
    windowMs,
    maxRequests,
    keyGenerator: (c) => {
      const address = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
      const examId = c.req.param('slug') ?? c.req.param('attemptId') ?? 'exam';

      return examRateLimitKey(route, address, examId);
    },
    message: 'Too many requests for this paper. Wait a moment and try again.'
  });
}
