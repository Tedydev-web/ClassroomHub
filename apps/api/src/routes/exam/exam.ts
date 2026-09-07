import { AppError, ErrorCodes, handleError } from '@api/utils/errors';
import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { courseTeamMemberMiddleware } from '@api/middlewares/course-team-member';
import { examAttemptTeamMemberMiddleware, examTeamMemberMiddleware } from '@api/middlewares/exam-team-member';
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
  duplicateExamService,
  previewExamPaperService,
  summariseExamPaperService,
  updateExamSettingsService
} from '@api/services/exam/exam';
import {
  buildExamAnswerDistributionService,
  buildExamAnswerMatrixService,
  buildExamAnswerSheetPdfService,
  buildExamAnswerWorkbookService,
  listExamAnswerKeysService
} from '@api/services/exam/exam-answer-keys';
import { listCourseAttemptsService } from '@api/services/exam/exam-course-attempts';
import { getExamPrintContextService } from '@api/services/exam/exam-print-context';
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
  revealThreshold: z.string().nullable().default(null),
  // The password itself, never its hash: hashing is the server's job, and a client that
  // could send a hash could send somebody else's.
  password: z.string().min(1).max(200).nullable().default(null),
  // `null` is off, and off is the default. See the column's own note for why.
  autoSubmitAfterLeaves: z.number().int().positive().max(50).nullable().default(null),
  supportContact: z.string().max(300).nullable().default(null)
});

/**
 * The settings a patch may carry. Written out rather than derived from the create schema:
 * `.partial()` over a field that carries `.default()` still materialises the default when
 * the key is absent, so a patch naming only the title would arrive holding every other
 * field at its default and quietly reset the exam's mode, attempt limit and visibility.
 *
 * `exerciseId` is absent on purpose. It names which questions the exam delivers, and
 * changing that is a different exam rather than an edit of this one.
 */
/**
 * Every caller but the "show deleted" toggle omits this entirely, so it has to parse an
 * absent query rather than require an explicit one.
 */
export const listExamsQuerySchema = z.object({ includeDeleted: z.enum(['0', '1']).optional() });

export const updateExamSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  mode: z.enum(['public', 'private']).optional(),
  workingSeconds: z.number().int().positive().nullable().optional(),
  opensAt: z.string().datetime().nullable().optional(),
  closesAt: z.string().datetime().nullable().optional(),
  maxAttempts: z.number().int().positive().nullable().optional(),
  requiresName: z.boolean().optional(),
  requiresClass: z.boolean().optional(),
  requiresCandidateNumber: z.boolean().optional(),
  scoreVisibility: revealValue.optional(),
  answerVisibility: revealValue.optional(),
  commentVisibility: revealValue.optional(),
  revealThreshold: z.string().nullable().optional(),
  // Three states, and the difference matters: a string sets a new password, `null` removes
  // the one there is, and leaving the key out keeps it. Without the third state, editing an
  // exam's title would clear its password.
  password: z.string().min(1).max(200).nullable().optional(),
  autoSubmitAfterLeaves: z.number().int().positive().max(50).nullable().optional(),
  supportContact: z.string().max(300).nullable().optional()
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
  // `includeDeleted` is what makes a soft-deleted exam findable again. Without it the
  // delete was one-way in practice: the row survived, but nothing could ever list it, so
  // the restore endpoint had no reachable caller.
  .get(
    '/course/:courseId',
    authMiddleware,
    courseTeamMemberMiddleware,
    zValidator('query', listExamsQuerySchema),
    async (c) => {
      try {
        const exams = await listExamsService(c.req.param('courseId'), c.req.valid('query').includeDeleted === '1');

        return c.json({ success: true as const, data: exams });
      } catch (error) {
        return handleError(c, error);
      }
    }
  )
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
  // Every sitting handed in across the course, for the Submissions page's exam tab. A pure
  // read — see the service for why finalisation must not be added here.
  .get('/course/:courseId/attempts', authMiddleware, courseTeamMemberMiddleware, async (c) => {
    try {
      const attempts = await listCourseAttemptsService(c.req.param('courseId'));

      return c.json({ success: true as const, data: attempts });
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
  .get('/:examId', authMiddleware, examTeamMemberMiddleware, async (c) => {
    try {
      const exam = await getExamService(c.req.param('examId'));

      return c.json({ success: true as const, data: exam });
    } catch (error) {
      return handleError(c, error);
    }
  })
  // The paper is frozen here, so this is the last moment its questions can change.
  // Editing an exam after it exists. Timing and entry settings are read once when a
  // sitting starts, so changing them leaves anybody mid-paper alone; the visibility
  // settings are read when results are viewed, so those do reach sittings already
  // finished. Both are stated on the form rather than forbidden here.
  .patch('/:examId', authMiddleware, examTeamMemberMiddleware, zValidator('json', updateExamSchema), async (c) => {
    try {
      const exam = await updateExamSettingsService(c.req.param('examId'), c.req.valid('json'));

      return c.json({ success: true as const, data: exam });
    } catch (error) {
      return handleError(c, error);
    }
  })
  .post('/:examId/open', authMiddleware, examTeamMemberMiddleware, async (c) => {
    try {
      const exam = await openExamService(c.req.param('examId'));

      return c.json({ success: true as const, data: exam });
    } catch (error) {
      return handleError(c, error);
    }
  })
  .post('/:examId/close', authMiddleware, examTeamMemberMiddleware, async (c) => {
    try {
      const exam = await closeExamService(c.req.param('examId'));

      return c.json({ success: true as const, data: exam });
    } catch (error) {
      return handleError(c, error);
    }
  })
  .post('/:examId/restore', authMiddleware, examTeamMemberMiddleware, async (c) => {
    try {
      const exam = await restoreExamService(c.req.param('examId'));

      return c.json({ success: true as const, data: exam });
    } catch (error) {
      return handleError(c, error);
    }
  })
  .get('/:examId/summary', authMiddleware, examTeamMemberMiddleware, async (c) => {
    try {
      const summary = await summariseExamPaperService(c.req.param('examId'));

      return c.json({ success: true as const, data: summary });
    } catch (error) {
      return handleError(c, error);
    }
  })
  // Reading the list finalises expired attempts. A GET that writes is deliberate: it is
  // what makes a closed tab harmless. Do not "fix" it into a pure read.
  // The paper as a candidate is served it. Read before the link goes out, which is why it
  // works on a draft too: freezing to look and freezing to open are the same function, so
  // what a teacher checks here is the paper rather than a rehearsal of it.
  .get('/:examId/preview', authMiddleware, examTeamMemberMiddleware, async (c) => {
    try {
      const preview = await previewExamPaperService(c.req.param('examId'));

      return c.json({ success: true as const, data: preview });
    } catch (error) {
      return handleError(c, error);
    }
  })
  // Copying an exam for a second sitting. The title comes from the caller because it is
  // the one part of a copy that is written in the teacher's language, not the server's.
  .post(
    '/:examId/duplicate',
    authMiddleware,
    examTeamMemberMiddleware,
    zValidator('json', z.object({ title: z.string().min(1).max(300).optional() })),
    async (c) => {
      try {
        const copy = await duplicateExamService(c.req.param('examId'), c.req.valid('json').title);

        return c.json({ success: true as const, data: copy });
      } catch (error) {
        return handleError(c, error);
      }
    }
  )
  // The answer key of the paper that was actually sat, with every correction already
  // applied. Behind the same guard as the results: it is the answer key, and only the
  // people who may read a candidate's marks may read it.
  /**
   * The class's answers as one table, for going through the paper with them.
   *
   * A `GET` with a list of candidates would put names in a URL that gets logged, so the
   * selection is sent in a body. Behind the same guard as the results and the key: this is
   * every answer every candidate gave.
   */
  .post('/:examId/answer-workbook', authMiddleware, examTeamMemberMiddleware, async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const attemptIds = Array.isArray(body?.attemptIds)
        ? body.attemptIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];

      // The request says which language to write the file in; the wording itself is the
      // server's, so a screen cannot half-translate a workbook by forgetting a label.
      const { file, fileName } = await buildExamAnswerWorkbookService(c.req.param('examId'), attemptIds, body?.locale);

      return new Response(new Uint8Array(file), {
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          // Both spellings: the plain one for what every client understands, and the encoded
          // one so a Vietnamese title survives the header intact where it is understood.
          'content-disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
        }
      });
    } catch (error) {
      return handleError(c, error);
    }
  })
  /**
   * The printed answer sheets as a PDF the browser saves, rather than a print dialog.
   *
   * The markup arrives from the dashboard's own sheet page. That page is the only
   * description of the layout — a teacher approved it line by line — so rendering it here
   * from a second copy would be two designs pretending to be one. The dashboard renders the
   * page it already has and hands the result over; this turns it into a file.
   */
  .post('/:examId/answer-sheets', authMiddleware, examTeamMemberMiddleware, async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const attemptIds = Array.isArray(body?.attemptIds)
        ? body.attemptIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];

      const { file, fileName } = await buildExamAnswerSheetPdfService(
        c.req.param('examId'),
        attemptIds,
        typeof body?.html === 'string' ? body.html : '',
        typeof body?.styles === 'string' ? body.styles : undefined
      );

      return new Response(new Uint8Array(file), {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
        }
      });
    } catch (error) {
      return handleError(c, error);
    }
  })
  /**
   * The same table the workbook is built from, as JSON, for the printable answer sheets.
   *
   * A `POST` for the same reason the workbook is one: the selection is a list of candidates,
   * and a list of candidates in a URL is a list of candidates in every access log.
   */
  .post('/:examId/answer-matrix', authMiddleware, examTeamMemberMiddleware, async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const attemptIds = Array.isArray(body?.attemptIds)
        ? body.attemptIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];

      const matrix = await buildExamAnswerMatrixService(c.req.param('examId'), attemptIds);

      return c.json({ success: true as const, data: matrix });
    } catch (error) {
      return handleError(c, error);
    }
  })
  // The masthead and foot of a printed answer sheet: who issued it, and what it records.
  .get('/:examId/print-context', authMiddleware, examTeamMemberMiddleware, async (c) => {
    try {
      const context = await getExamPrintContextService(c.req.param('examId'), c.req.query('lang'));

      return c.json({ success: true as const, data: context });
    } catch (error) {
      return handleError(c, error);
    }
  })
  .get('/:examId/answer-keys', authMiddleware, examTeamMemberMiddleware, async (c) => {
    try {
      const questions = await listExamAnswerKeysService(c.req.param('examId'));

      return c.json({ success: true as const, data: questions });
    } catch (error) {
      return handleError(c, error);
    }
  })
  // What the class chose, per question. Read on the exam's own page, beside the marks.
  .get('/:examId/answer-distribution', authMiddleware, examTeamMemberMiddleware, async (c) => {
    try {
      const distribution = await buildExamAnswerDistributionService(c.req.param('examId'));

      return c.json({ success: true as const, data: distribution });
    } catch (error) {
      return handleError(c, error);
    }
  })
  .get('/:examId/results', authMiddleware, examTeamMemberMiddleware, async (c) => {
    try {
      const rows = await listExamResultsService(c.req.param('examId'));

      return c.json({ success: true as const, data: rows });
    } catch (error) {
      return handleError(c, error);
    }
  })
  .get('/attempt/:attemptId', authMiddleware, examAttemptTeamMemberMiddleware, async (c) => {
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
    examAttemptTeamMemberMiddleware,
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
    examAttemptTeamMemberMiddleware,
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
    examTeamMemberMiddleware,
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
  .delete('/attempt/:attemptId', authMiddleware, examAttemptTeamMemberMiddleware, async (c) => {
    try {
      const deleted = await deleteAttemptService(c.req.param('attemptId'));

      return c.json({ success: true as const, data: deleted });
    } catch (error) {
      return handleError(c, error);
    }
  })
  .delete('/:examId', authMiddleware, examTeamMemberMiddleware, async (c) => {
    try {
      const deleted = await deleteExamService(c.req.param('examId'));

      return c.json({ success: true as const, data: deleted });
    } catch (error) {
      return handleError(c, error);
    }
  });
