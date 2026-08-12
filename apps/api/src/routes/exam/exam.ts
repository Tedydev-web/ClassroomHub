import { AppError, ErrorCodes, handleError } from '@api/utils/errors';
import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { courseTeamMemberMiddleware } from '@api/middlewares/course-team-member';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import {
  createExamService,
  deleteExamService,
  getExamService,
  listExamsService,
  requireExamsEnabled
} from '@api/services/exam/exam';

/**
 * Creating and configuring exams. Sitting one is a separate, unauthenticated router,
 * added in phase 3.
 *
 * Every route here is gated on `EXAM_ENABLED`. A merge to main deploys, so these paths
 * exist the moment they are merged, while the rate limits and retention rules land
 * later — the flag is what actually holds the feature back, and it answers 404 rather
 * than 503 so a disabled feature is indistinguishable from one that was never built.
 */

const revealValue = z.enum(['never', 'on_submit', 'after_everyone', 'above_threshold']);

const createExamSchema = z.object({
  title: z.string().min(1).max(300),
  exerciseId: z.string().uuid(),
  mode: z.enum(['public', 'private']).default('private'),
  workingSeconds: z.number().int().positive().nullable().default(null),
  opensAt: z.string().datetime().nullable().default(null),
  closesAt: z.string().datetime().nullable().default(null),
  maxAttempts: z.number().int().positive().nullable().default(null),
  requiresName: z.boolean().default(true),
  requiresClass: z.boolean().default(false),
  requiresCandidateNumber: z.boolean().default(false),
  scoreVisibility: revealValue.default('never'),
  answerVisibility: revealValue.default('never'),
  commentVisibility: revealValue.default('never'),
  revealThreshold: z.string().nullable().default(null)
});

export const examRouter = new Hono()
  .use('*', async (c, next) => {
    requireExamsEnabled();
    return next();
  })
  // Creation hangs off the course so `courseTeamMemberMiddleware` can read the id it
  // authorises against, and so the owning organisation is resolved from the course on the
  // server rather than taken from a header the caller controls.
  .post(
    '/course/:courseId',
    authMiddleware,
    courseTeamMemberMiddleware,
    zValidator('json', createExamSchema),
    async (c) => {
      try {
        const input = c.req.valid('json');
        const user = c.get('user');

        if (!user) {
          throw new AppError('Sign in to create an exam', ErrorCodes.UNAUTHORIZED, 401);
        }

        const exam = await createExamService(input, c.req.param('courseId'), user.id);

        return c.json({ success: true as const, data: exam });
      } catch (error) {
        return handleError(c, error);
      }
    }
  )
  .get('/course/:courseId', authMiddleware, courseTeamMemberMiddleware, async (c) => {
    try {
      const exams = await listExamsService(c.req.param('courseId'));

      return c.json({ success: true as const, data: exams });
    } catch (error) {
      return handleError(c, error);
    }
  })
  .get('/:examId', authMiddleware, async (c) => {
    try {
      const exam = await getExamService(c.req.param('examId'));

      return c.json({ success: true as const, data: exam });
    } catch (error) {
      return handleError(c, error);
    }
  })
  .delete('/:examId', authMiddleware, async (c) => {
    try {
      const deleted = await deleteExamService(c.req.param('examId'));

      return c.json({ success: true as const, data: deleted });
    } catch (error) {
      return handleError(c, error);
    }
  });
