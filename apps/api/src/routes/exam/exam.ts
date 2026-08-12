import { AppError, ErrorCodes, handleError } from '@api/utils/errors';
import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { courseTeamMemberMiddleware } from '@api/middlewares/course-team-member';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import {
  closeExamService,
  createExamService,
  deleteExamService,
  getExamService,
  listExamsService,
  openExamService,
  requireExamsEnabled,
  restoreExamService,
  summariseExamPaperService
} from '@api/services/exam/exam';
import {
  copyExerciseIntoContainer,
  listAvailableContainersService,
  listCopyableExercisesService
} from '@api/services/exam/exam-container';
import {
  addCorrectionService,
  deleteAttemptService,
  getExamAttemptDetailService,
  listExamResultsService,
  reopenAttemptService,
  saveManualMarkService
} from '@api/services/exam/exam-results';

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
  // Papers this course can deliver: detached containers only. A working exercise is not
  // offered, because an exam must never deliver something enrolled students can already
  // open without a clock.
  .get('/course/:courseId/containers', authMiddleware, courseTeamMemberMiddleware, async (c) => {
    try {
      const containers = await listAvailableContainersService(c.req.param('courseId'));

      return c.json({ success: true as const, data: containers });
    } catch (error) {
      return handleError(c, error);
    }
  })
  // The exercises this course already owns, offered as sources to copy a paper from.
  .get('/course/:courseId/copyable-exercises', authMiddleware, courseTeamMemberMiddleware, async (c) => {
    try {
      const exercises = await listCopyableExercisesService(c.req.param('courseId'));

      return c.json({ success: true as const, data: exercises });
    } catch (error) {
      return handleError(c, error);
    }
  })
  // Copying is how a container comes into existence: the teacher's questions already live
  // in a course exercise, and an exam may not deliver that row directly.
  .post(
    '/course/:courseId/paper-from-exercise',
    authMiddleware,
    courseTeamMemberMiddleware,
    zValidator('json', z.object({ exerciseId: z.string().uuid() })),
    async (c) => {
      try {
        const container = await copyExerciseIntoContainer(c.req.valid('json').exerciseId, c.req.param('courseId'));

        return c.json({ success: true as const, data: container }, 201);
      } catch (error) {
        return handleError(c, error);
      }
    }
  )
  .get('/:examId', authMiddleware, async (c) => {
    try {
      const exam = await getExamService(c.req.param('examId'));

      return c.json({ success: true as const, data: exam });
    } catch (error) {
      return handleError(c, error);
    }
  })
  // The paper is frozen here, so this is the last moment its questions can change.
  .post('/:examId/open', authMiddleware, async (c) => {
    try {
      const exam = await openExamService(c.req.param('examId'));

      return c.json({ success: true as const, data: exam });
    } catch (error) {
      return handleError(c, error);
    }
  })
  .post('/:examId/close', authMiddleware, async (c) => {
    try {
      const exam = await closeExamService(c.req.param('examId'));

      return c.json({ success: true as const, data: exam });
    } catch (error) {
      return handleError(c, error);
    }
  })
  .post('/:examId/restore', authMiddleware, async (c) => {
    try {
      const exam = await restoreExamService(c.req.param('examId'));

      return c.json({ success: true as const, data: exam });
    } catch (error) {
      return handleError(c, error);
    }
  })
  .get('/:examId/summary', authMiddleware, async (c) => {
    try {
      const summary = await summariseExamPaperService(c.req.param('examId'));

      return c.json({ success: true as const, data: summary });
    } catch (error) {
      return handleError(c, error);
    }
  })
  // Reading the list finalises expired attempts. A GET that writes is deliberate: it is
  // what makes a closed tab harmless. Do not "fix" it into a pure read.
  .get('/:examId/results', authMiddleware, async (c) => {
    try {
      const rows = await listExamResultsService(c.req.param('examId'));

      return c.json({ success: true as const, data: rows });
    } catch (error) {
      return handleError(c, error);
    }
  })
  .get('/attempt/:attemptId', authMiddleware, async (c) => {
    try {
      const detail = await getExamAttemptDetailService(c.req.param('attemptId'));

      return c.json({ success: true as const, data: detail });
    } catch (error) {
      return handleError(c, error);
    }
  })
  .put(
    '/attempt/:attemptId/mark',
    authMiddleware,
    zValidator(
      'json',
      z.object({ questionId: z.number().int().positive(), score: z.number(), comment: z.string().max(2000).optional() })
    ),
    async (c) => {
      try {
        const { questionId, score, comment } = c.req.valid('json');
        const updated = await saveManualMarkService(c.req.param('attemptId'), questionId, { score, comment });

        return c.json({ success: true as const, data: updated });
      } catch (error) {
        return handleError(c, error);
      }
    }
  )
  .post(
    '/attempt/:attemptId/reopen',
    authMiddleware,
    zValidator('json', z.object({ extraSeconds: z.number().int().positive().max(86_400) })),
    async (c) => {
      try {
        const reopened = await reopenAttemptService(c.req.param('attemptId'), c.req.valid('json').extraSeconds);

        return c.json({ success: true as const, data: reopened });
      } catch (error) {
        return handleError(c, error);
      }
    }
  )
  .post(
    '/:examId/corrections',
    authMiddleware,
    zValidator(
      'json',
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('award'), questionId: z.number().int().positive() }),
        z.object({
          kind: z.literal('keyFix'),
          questionId: z.number().int().positive(),
          previousKey: z.array(z.string()),
          correctedKey: z.array(z.string())
        })
      ])
    ),
    async (c) => {
      try {
        const user = c.get('user');
        if (!user) throw new AppError('Sign in first', ErrorCodes.UNAUTHORIZED, 401);

        const result = await addCorrectionService(c.req.param('examId'), {
          ...c.req.valid('json'),
          by: user.id,
          at: new Date().toISOString()
        });

        return c.json({ success: true as const, data: result });
      } catch (error) {
        return handleError(c, error);
      }
    }
  )
  // Throwing a sitting away, so the paper can be sat again from nothing. Reopening is the
  // other remedy and keeps the answers; this one is for a paper that should not exist.
  .delete('/attempt/:attemptId', authMiddleware, async (c) => {
    try {
      const deleted = await deleteAttemptService(c.req.param('attemptId'));

      return c.json({ success: true as const, data: deleted });
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
