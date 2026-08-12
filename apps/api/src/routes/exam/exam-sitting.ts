import { createHash } from 'node:crypto';

import { AppError, ErrorCodes, handleError } from '@api/utils/errors';
import { Hono } from '@api/utils/hono';
import { env } from '@cio/core/config/env';
import { zValidator } from '@hono/zod-validator';
import { getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';

import { getPublicExamService, requireExamsEnabled } from '@api/services/exam/exam';
import {
  countAttemptsForToken,
  hashResumeToken,
  resumeCookieName,
  saveAnswersService,
  startAttemptService,
  submitAttemptService
} from '@api/services/exam/exam-attempt';

/**
 * Sitting an exam, without an account.
 *
 * **The resume cookie must be `SameSite=None`, and this is not a preference.** In
 * production the dashboard and the API are different hosts, and the API client already
 * sets `credentials: 'include'` for that reason. A `Lax` cookie is withheld on cross-site
 * subresource requests, so every autosave and every submit would arrive with no cookie:
 * no resume, no saved work, on exam day — while passing every test, because development
 * runs on one host and an integration test carries its own cookie jar.
 *
 * This project has met this bug before. `routes/org-site/public-course.ts` sets the HLS
 * cookie to `None` with the comment that `Lax` "is withheld on cross-site subresource
 * requests, which would 403 every segment when the public site and api/stream live on
 * different hosts".
 *
 * `SameSite=None` on an unauthenticated write invites cross-site request forgery, so
 * every write also requires a custom header. A cross-site `fetch` cannot set one unless
 * our CORS policy allows that origin, which makes the header a capability check rather
 * than a secret.
 */

const REQUIRED_HEADER = 'x-exam-sitting';

const startSchema = z.object({
  displayName: z.string().max(120).optional(),
  className: z.string().max(120).optional(),
  candidateNumber: z.string().max(120).optional(),
  password: z.string().max(200).optional()
});

const saveSchema = z.object({
  answers: z.array(z.object({ questionId: z.number().int().positive(), answerData: z.unknown() })).max(500)
});

function requireSittingHeader(header: string | undefined): void {
  if (header !== '1') {
    throw new AppError('Missing sitting header', ErrorCodes.FORBIDDEN, 403);
  }
}

/** Salted, so it can spot a duplicate without identifying anybody. */
function hashAddress(address: string | undefined): string | null {
  if (!address) return null;

  const salt = env.PRIVATE_SERVER_KEY ?? '';
  return createHash('sha256').update(`${salt}:${address}`).digest('hex');
}

export const examSittingRouter = new Hono()
  .use('*', async (c, next) => {
    requireExamsEnabled();
    return next();
  })
  .post('/:slug/start', zValidator('json', startSchema), async (c) => {
    try {
      requireSittingHeader(c.req.header(REQUIRED_HEADER));

      const exam = await getPublicExamService(c.req.param('slug'));
      const body = c.req.valid('json');
      const now = new Date();

      const existingToken = getCookie(c, resumeCookieName(exam.id));
      if (existingToken && exam.maxAttempts !== null) {
        const taken = await countAttemptsForToken(exam.id, hashResumeToken(existingToken));
        if (taken >= exam.maxAttempts) {
          throw new AppError('You have used all your attempts at this paper', ErrorCodes.FORBIDDEN, 403);
        }
      }

      const started = await startAttemptService({
        exam,
        identity: body,
        profileId: null,
        password: body.password ?? null,
        ipHash: hashAddress(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')),
        userAgent: c.req.header('user-agent') ?? null,
        now
      });

      setCookie(c, resumeCookieName(exam.id), started.resumeToken, {
        path: '/',
        httpOnly: true,
        secure: true,
        // `None`, never `Lax` — see the note at the top of this file.
        sameSite: 'None',
        maxAge: 60 * 60 * 12
      });

      return c.json({
        success: true as const,
        data: {
          attemptId: started.attempt.id,
          paper: started.paper,
          secondsRemaining: started.secondsRemaining
        }
      });
    } catch (error) {
      return handleError(c, error);
    }
  })
  .put('/attempt/:attemptId/answers', zValidator('json', saveSchema), async (c) => {
    try {
      requireSittingHeader(c.req.header(REQUIRED_HEADER));

      const saved = await saveAnswersService(c.req.param('attemptId'), c.req.valid('json').answers, new Date());

      return c.json({ success: true as const, data: saved });
    } catch (error) {
      return handleError(c, error);
    }
  })
  .post('/attempt/:attemptId/submit', async (c) => {
    try {
      requireSittingHeader(c.req.header(REQUIRED_HEADER));

      const attempt = await submitAttemptService(c.req.param('attemptId'), new Date());

      return c.json({ success: true as const, data: { attemptId: attempt.id, submittedAt: attempt.submittedAt } });
    } catch (error) {
      return handleError(c, error);
    }
  });
