import { AppError, ErrorCodes, handleError } from '@api/utils/errors';
import { Hono } from '@api/utils/hono';
import { db } from '@cio/db/drizzle';
import * as schema from '@cio/db/schema';
import { eq } from 'drizzle-orm';
import { zValidator } from '@hono/zod-validator';
import { getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';

import { getPublicExamService, requireExamsEnabled } from '@api/services/exam/exam';
import type { ExamPaperSnapshot } from '@api/services/exam/exam-paper-serializer';
import { startDeadline } from '@api/services/exam/exam-attempt-clock';
import { hashSittingSignal } from '@api/services/exam/exam-sitting-signals';
import { getAssessmentInteractionBlocks, type AssessmentItemDefinition } from '@cio/question-types';
import { examRateLimiter } from '@api/services/exam/exam-abuse-limits';
import { requireSittingRequest } from './exam-sitting-guard';
import { scoreSubmittedAttempt } from '@api/services/exam/exam-finalisation';
import { revealedScoreForSitterService } from '@api/services/exam/exam-results';
import {
  countAttemptsOnDevice,
  resumeAttemptService,
  sittingPaperFor,
  hashResumeToken,
  resumeCookieName,
  recordActivityService,
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
  // Optional on every paper: two candidates in one class may share a name, and a nickname
  // is the only thing that tells them apart where the school issues no candidate numbers.
  nickname: z.string().max(120).optional(),
  sameDeviceDifferentPerson: z.boolean().optional(),
  password: z.string().max(200).optional(),
  device: z.object({ id: z.string().max(100), fingerprint: z.string().max(500) }).optional()
});

const saveSchema = z.object({
  answers: z.array(z.object({ questionId: z.number().int().positive(), answerData: z.unknown() })).max(500)
});

/**
 * The number of answerable questions in a frozen paper.
 *
 * Counted over interactions rather than over items: an item is a passage and may hold ten
 * questions, so counting items would tell a candidate a forty-question paper has ten.
 */
function countExamQuestions(snapshot: ExamPaperSnapshot | null): number {
  if (!snapshot?.questions?.length) return 0;

  return snapshot.questions.reduce(
    (total, question) => total + getAssessmentInteractionBlocks(question.definition as AssessmentItemDefinition).length,
    0
  );
}

/**
 * The course an exam belongs to, by name, for the link preview.
 *
 * An exam need not belong to one — a container-only paper has no course — so this answers
 * `null` rather than failing, and the preview leaves the line out.
 */
async function courseNameFor(courseId: string | null): Promise<string | null> {
  if (!courseId) return null;

  const [row] = await db
    .select({ title: schema.course.title })
    .from(schema.course)
    .where(eq(schema.course.id, courseId))
    .limit(1);

  return row?.title ?? null;
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
          // Both ends of the window, so a link pasted into a chat can say when the paper
          // opens as well as when it shuts. Neither is a secret: anybody holding the link
          // can already read both on the page it opens.
          opensAt: exam.opensAt,
          closesAt: exam.closesAt,
          course: await courseNameFor(exam.courseId),
          maxAttempts: exam.maxAttempts,
          // Told before the clock starts so the warning a candidate meets later can say what
          // will actually happen, rather than a threat nobody configured.
          autoSubmitAfterLeaves: exam.autoSubmitAfterLeaves,
          supportContact: exam.supportContact,
          startsUntil:
            startDeadline({
              opensAt: exam.opensAt ? new Date(exam.opensAt) : null,
              closesAt: exam.closesAt ? new Date(exam.closesAt) : null,
              startWindowMinutes: exam.startWindowMinutes
            })?.toISOString() ?? null,
          watermark: exam.watermark,
          // How many questions, counted the way a candidate counts them: a passage holding
          // six is six, not one. Told before the clock starts, because "how long is this
          // paper" is the first thing anybody asks and the answer is not a secret.
          questionCount: countExamQuestions(exam.paperSnapshot as ExamPaperSnapshot | null)
        }
      });
    } catch (error) {
      return handleError(c, error);
    }
  })
  /**
   * Whether this browser has a paper open, and whose it is. Never the paper itself.
   *
   * A refresh mid-paper must continue the same attempt with the time already spent gone,
   * not open a second one on a fresh clock — so something has to answer "is there one".
   * What it must not do is answer with the answers.
   *
   * The cookie says a paper was started on this device. It cannot say who is holding the
   * device now: a phone shared by two candidates carries one cookie, and the second person
   * to pick it up was being handed the first person's work without being asked. Nobody but
   * the human in front of the screen can tell those two apart, so this route returns only
   * what a human needs to recognise their own paper, and the claim is a separate request.
   */
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

      return c.json({
        success: true as const,
        data: {
          // Exactly the fields that answer "is this mine", and no others. They are what the
          // holder typed on their way in, and a classmate sharing the device will see the
          // same name on the results board afterwards.
          displayName: resumed.attempt.displayName,
          nickname: resumed.attempt.nickname,
          className: resumed.attempt.className,
          candidateNumber: resumed.attempt.candidateNumber,
          startedAt: resumed.attempt.startedAt,
          secondsRemaining: resumed.secondsRemaining,
          serverNow: new Date().toISOString()
        }
      });
    } catch (error) {
      return handleError(c, error);
    }
  })
  /**
   * Claiming the paper this browser has open, once a human has said it is theirs.
   *
   * Same attempt, same clock, same answers as `resume` used to hand over unasked. Holding
   * the cookie is still all it takes — the server cannot see who tapped — so this is not a
   * lock against somebody determined to read another candidate's work. It is the narrower
   * and more useful thing: a candidate who answers the question honestly never receives
   * somebody else's answers at all.
   */
  .post('/:slug/resume', examRateLimiter('resume'), async (c) => {
    try {
      requireSittingRequest(c);

      const exam = await getPublicExamService(c.req.param('slug'));
      const rawToken = getCookie(c, resumeCookieName(exam.id));

      if (!rawToken) {
        return c.json({ success: true as const, data: null });
      }

      const resumed = await resumeAttemptService(exam.id, rawToken, new Date());
      if (!resumed) {
        return c.json({ success: true as const, data: null });
      }

      return c.json({
        success: true as const,
        data: {
          attemptId: resumed.attempt.id,
          paper: sittingPaperFor(exam, resumed.attempt.id),
          review: resumed.attempt.reviewStatus,
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
      const deviceHash = hashSittingSignal(body.device?.id);
      const priorAttemptsOnDevice = await countAttemptsOnDevice(exam.id, {
        tokenHash: existingToken ? hashResumeToken(existingToken) : null,
        deviceHash
      });

      if (exam.maxAttempts !== null && !body.sameDeviceDifferentPerson && priorAttemptsOnDevice >= exam.maxAttempts) {
        throw new AppError('You have used all your attempts at this paper', ErrorCodes.FORBIDDEN, 403);
      }

      const started = await startAttemptService({
        exam,
        identity: body,
        profileId: null,
        password: body.password ?? null,
        ipHash: hashSittingSignal(c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')),
        userAgent: c.req.header('user-agent') ?? null,
        deviceHash,
        fingerprintHash: hashSittingSignal(body.device?.fingerprint),
        priorAttemptsOnDevice,
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
          review: started.attempt.reviewStatus,
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
  // Reporting that the paper stopped being the visible document. Rate-limited like a save,
  // since it arrives from the same page under the same conditions.
  .post(
    '/attempt/:attemptId/activity',
    examRateLimiter('save'),
    zValidator(
      'json',
      z.object({
        events: z
          .array(z.object({ kind: z.enum(['left', 'returned']), at: z.string().datetime() }))
          .min(1)
          .max(50)
      })
    ),
    async (c) => {
      try {
        requireSittingRequest(c);

        const outcome = await recordActivityService(c.req.param('attemptId'), c.req.valid('json').events, new Date());

        return c.json({ success: true as const, data: outcome });
      } catch (error) {
        return handleError(c, error);
      }
    }
  )
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
        data: {
          attemptId: attempt.id,
          submittedAt: attempt.submittedAt,
          result: revealed,
          review: attempt.reviewStatus
        }
      });
    } catch (error) {
      return handleError(c, error);
    }
  });
