import { createHash } from 'node:crypto';

import { AppError, ErrorCodes, handleError } from '@api/utils/errors';
import { Hono } from '@api/utils/hono';
import { env } from '@cio/core/config/env';
import { zValidator } from '@hono/zod-validator';
import { getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';

import { getPublicExamService, requireExamsEnabled } from '@api/services/exam/exam';
import { toExamSittingPaper } from '@api/services/exam/exam-paper-serializer';
import { examRateLimiter } from '@api/services/exam/exam-abuse-limits';
import { requireSittingRequest } from './exam-sitting-guard';
import { scoreSubmittedAttempt } from '@api/services/exam/exam-finalisation';
import { revealedScoreForSitterService } from '@api/services/exam/exam-results';
import {
  countAttemptsForToken,
  resumeAttemptService,
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
 * every write also has to prove it came from us — see `requireSittingRequest`.
 */

const startSchema = z.object({
  displayName: z.string().max(120).optional(),
  className: z.string().max(120).optional(),
  candidateNumber: z.string().max(120).optional(),
  password: z.string().max(200).optional()
});

const saveSchema = z.object({
  answers: z.array(z.object({ questionId: z.number().int().positive(), answerData: z.unknown() })).max(500)
});

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
  // What the entry screen needs, and nothing more. The questions arrive only from
  // `start`, once a sitter has identified themselves and an attempt with a clock exists —
  // otherwise the paper could be read without ever starting one.
  .get('/:slug', async (c) => {
    try {
      const exam = await getPublicExamService(c.req.param('slug'));

      return c.json({
        success: true as const,
        data: {
          title: exam.title,
          requiresName: exam.requiresName,
          requiresClass: exam.requiresClass,
          requiresCandidateNumber: exam.requiresCandidateNumber,
          requiresPassword: Boolean(exam.passwordHash),
          workingSeconds: exam.workingSeconds,
          closesAt: exam.closesAt
        }
      });
    } catch (error) {
      return handleError(c, error);
    }
  })
  // Called before the entry screen shows. A refresh mid-paper must continue the same
  // attempt with the time already spent gone, not open a second one on a fresh clock.
  .get('/:slug/resume', async (c) => {
    try {
      const exam = await getPublicExamService(c.req.param('slug'));
      const rawToken = getCookie(c, resumeCookieName(exam.id));

      if (!rawToken) {
        return c.json({ success: true as const, data: null });
      }

      const resumed = await resumeAttemptService(exam.id, rawToken, new Date());
      if (!resumed) {
        return c.json({ success: true as const, data: null });
      }

      const snapshot = exam.paperSnapshot as Parameters<typeof toExamSittingPaper>[0];

      return c.json({
        success: true as const,
        data: {
          attemptId: resumed.attempt.id,
          paper: toExamSittingPaper(snapshot),
          answers: resumed.attempt.answers,
          expiresAt: resumed.attempt.expiresAt,
          secondsRemaining: resumed.secondsRemaining,
          writable: resumed.writable,
          serverNow: new Date().toISOString()
        }
      });
    } catch (error) {
      return handleError(c, error);
    }
  })
  .post('/:slug/start', examRateLimiter('start'), zValidator('json', startSchema), async (c) => {
    try {
      requireSittingRequest(c);

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
          expiresAt: started.attempt.expiresAt,
          secondsRemaining: started.secondsRemaining,
          // The client measures its own drift against this, so a phone running minutes
          // out still counts down to the moment the server will actually end the paper.
          serverNow: now.toISOString()
        }
      });
    } catch (error) {
      return handleError(c, error);
    }
  })
  .put('/attempt/:attemptId/answers', examRateLimiter('save'), zValidator('json', saveSchema), async (c) => {
    try {
      requireSittingRequest(c);

      const saved = await saveAnswersService(c.req.param('attemptId'), c.req.valid('json').answers, new Date());

      return c.json({ success: true as const, data: saved });
    } catch (error) {
      return handleError(c, error);
    }
  })
  .post('/attempt/:attemptId/submit', examRateLimiter('submit'), async (c) => {
    try {
      requireSittingRequest(c);

      const now = new Date();
      const attempt = await submitAttemptService(c.req.param('attemptId'), now);

      // Scored here rather than left for the teacher's page to finalise. Only expired
      // attempts are picked up there, so without this a submitted paper keeps a null
      // score for ever — and the sitter's one chance to be shown it is this response.
      await scoreSubmittedAttempt(attempt.id, now);
      const revealed = await revealedScoreForSitterService(attempt.id, now);

      return c.json({
        success: true as const,
        data: { attemptId: attempt.id, submittedAt: attempt.submittedAt, result: revealed }
      });
    } catch (error) {
      return handleError(c, error);
    }
  });
