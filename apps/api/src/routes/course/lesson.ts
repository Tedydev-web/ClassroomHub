import {
  ZLessonCommentCreate,
  ZLessonCommentGetParam,
  ZLessonCommentUpdate,
  ZLessonCommentsQuery,
  ZLessonCompletionUpdate,
  ZLessonCreate,
  ZLessonGetParam,
  ZLessonHistoryParam,
  ZLessonHistoryQuery,
  ZLessonListQuery,
  ZLessonReorder,
  ZLessonUpdate,
  ZUpdateLessonWatchProgress
} from '@cio/utils/validation/lesson';
import { ZScormRuntimeCommit, ZScormRuntimeParams, ZScormRuntimeTerminate } from '@cio/utils/validation/scorm';
import {
  createLesson,
  createLessonCommentService,
  deleteLessonCommentService,
  deleteLessonService,
  getLesson,
  getLessonCommentsPaginated,
  getLessonCompletionService,
  getLessonHistoryService,
  getLessonWatchProgressService,
  listLessons,
  reorderLessons,
  updateLessonCommentService,
  updateLessonService,
  updateLessonWatchProgressService,
  upsertLessonCompletionService
} from '@api/services/lesson';
import { assertEnrolledStudentContentAccess } from '@api/services/course/access';
import { evaluateCourseCertification } from '@api/services/course/completion';
import { ContentType } from '@cio/utils/constants';

import { Hono } from '@api/utils/hono';
import { ZLessonDownloadContent } from '@cio/utils/validation/course';
import { authMiddleware } from '@api/middlewares/auth';
import { courseMemberMiddleware } from '@api/middlewares/course-member';
import { courseTeamMemberMiddleware } from '@api/middlewares/course-team-member';
import { notifyCourseSessionUpdateService } from '@api/services/course/notify-session';
import { generateLessonPdf } from '@api/utils/lesson';
import { ensureCourseGroupMemberId } from '@cio/core/services/course/course';
import { AppError, ErrorCodes, handleError } from '@api/utils/errors';
import { getCourseWithOrgData } from '@cio/db/queries/course';
import { emitWebhookEvent } from '@api/services/webhook';
import { lessonLanguageRouter } from '@api/routes/course/lesson-language';
import { zValidator } from '@hono/zod-validator';
import {
  getScormLessonAsset,
  getScormLessonMetadata,
  getScormRuntimeState,
  launchScormRuntime,
  saveScormRuntime
} from '@api/services/scorm';

export const lessonRouter = new Hono()
  // Lesson CRUD routes
  .get('/', authMiddleware, courseMemberMiddleware, zValidator('query', ZLessonListQuery), async (c) => {
    try {
      const { courseId, sectionId } = c.req.valid('query');
      const lessons = await listLessons(courseId, sectionId);

      return c.json({ success: true, data: lessons }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to list lessons');
    }
  })
  .post('/reorder', authMiddleware, courseMemberMiddleware, zValidator('json', ZLessonReorder), async (c) => {
    try {
      const { lessons } = c.req.valid('json');

      const updated = await reorderLessons(lessons);

      return c.json({ success: true, data: updated }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to reorder lessons');
    }
  })
  .get('/:lessonId', authMiddleware, courseMemberMiddleware, zValidator('param', ZLessonGetParam), async (c) => {
    try {
      const user = c.get('user')!;
      const courseId = c.req.param('courseId')!;
      const { lessonId } = c.req.valid('param');

      await assertEnrolledStudentContentAccess({
        courseId,
        profileId: user.id,
        contentId: lessonId,
        type: ContentType.Lesson
      });

      const [lesson, watchProgress] = await Promise.all([
        getLesson(lessonId),
        getLessonWatchProgressService(lessonId, user.id)
      ]);

      return c.json({ success: true, data: { ...lesson, watchProgress } }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to fetch lesson');
    }
  })
  .post('/', authMiddleware, courseMemberMiddleware, zValidator('json', ZLessonCreate), async (c) => {
    try {
      const courseId = c.req.param('courseId')!;
      const data = c.req.valid('json');

      const lesson = await createLesson(courseId, { ...data, courseId });

      return c.json({ success: true, data: lesson }, 201);
    } catch (error) {
      return handleError(c, error, 'Failed to create lesson');
    }
  })
  .put(
    '/:lessonId',
    authMiddleware,
    courseMemberMiddleware,
    zValidator('param', ZLessonGetParam),
    zValidator('json', ZLessonUpdate),
    async (c) => {
      try {
        const { lessonId } = c.req.valid('param');
        const data = c.req.valid('json');

        const lesson = await updateLessonService(lessonId, data);

        return c.json({ success: true, data: lesson }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to update lesson');
      }
    }
  )
  .post(
    '/:lessonId/notify-session-update',
    authMiddleware,
    courseTeamMemberMiddleware,
    zValidator('param', ZLessonGetParam),
    async (c) => {
      try {
        const courseId = c.req.param('courseId')!;
        const { lessonId } = c.req.valid('param');

        const result = await notifyCourseSessionUpdateService(courseId, lessonId);
        return c.json({ success: true, data: result }, 202);
      } catch (error) {
        return handleError(c, error, 'Failed to notify session update');
      }
    }
  )
  .delete('/:lessonId', authMiddleware, courseMemberMiddleware, zValidator('param', ZLessonGetParam), async (c) => {
    try {
      const { lessonId } = c.req.valid('param');
      const lesson = await deleteLessonService(lessonId);

      return c.json({ success: true, data: lesson }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to delete lesson');
    }
  })
  // Lesson Comment routes
  .get(
    '/:lessonId/comment',
    authMiddleware,
    courseMemberMiddleware,
    zValidator('param', ZLessonGetParam),
    zValidator('query', ZLessonCommentsQuery),
    async (c) => {
      try {
        const { lessonId } = c.req.valid('param');
        const { cursor, limit = 10 } = c.req.valid('query');

        const result = await getLessonCommentsPaginated(lessonId, { cursor, limit });

        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to get lesson comments');
      }
    }
  )
  .post(
    '/:lessonId/comment',
    authMiddleware,
    courseMemberMiddleware,
    zValidator('param', ZLessonGetParam),
    zValidator('json', ZLessonCommentCreate),
    async (c) => {
      try {
        const user = c.get('user')!;
        const courseId = c.req.param('courseId')!;
        const { lessonId } = c.req.valid('param');
        const { comment } = c.req.valid('json');

        const groupMemberId = await ensureCourseGroupMemberId(courseId, user.id);
        if (!groupMemberId) {
          return c.json({ success: false, error: 'User is not a member of this course' }, 403);
        }

        const commentData = await createLessonCommentService(lessonId, groupMemberId, comment);

        return c.json({ success: true, data: commentData }, 201);
      } catch (error) {
        return handleError(c, error, 'Failed to create lesson comment');
      }
    }
  )
  .put(
    '/comment/:commentId',
    authMiddleware,
    courseMemberMiddleware,
    zValidator('param', ZLessonCommentGetParam),
    zValidator('json', ZLessonCommentUpdate),
    async (c) => {
      try {
        const { commentId } = c.req.valid('param');
        const { comment } = c.req.valid('json');
        const updated = await updateLessonCommentService(Number(commentId), comment);

        return c.json({ success: true, data: updated }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to update lesson comment');
      }
    }
  )
  .delete(
    '/comment/:commentId',
    authMiddleware,
    courseMemberMiddleware,
    zValidator('param', ZLessonCommentGetParam),
    async (c) => {
      try {
        const { commentId } = c.req.valid('param');
        const comment = await deleteLessonCommentService(Number(commentId));

        return c.json({ success: true, data: comment }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to delete lesson comment');
      }
    }
  )
  // Lesson Completion routes
  .get(
    '/:lessonId/completion',
    authMiddleware,
    courseMemberMiddleware,
    zValidator('param', ZLessonGetParam),
    async (c) => {
      try {
        const user = c.get('user')!;
        const { lessonId } = c.req.valid('param');

        const completion = await getLessonCompletionService(lessonId, user.id);

        return c.json({ success: true, data: completion }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to get lesson completion');
      }
    }
  )
  .put(
    '/:lessonId/completion',
    authMiddleware,
    courseMemberMiddleware,
    zValidator('param', ZLessonGetParam),
    zValidator('json', ZLessonCompletionUpdate),
    async (c) => {
      try {
        const user = c.get('user')!;
        const courseId = c.req.param('courseId')!;
        const { lessonId } = c.req.valid('param');
        const { isComplete } = c.req.valid('json');

        await assertEnrolledStudentContentAccess({
          courseId,
          profileId: user.id,
          contentId: lessonId,
          type: ContentType.Lesson
        });

        const completion = await upsertLessonCompletionService(lessonId, user.id, isComplete);

        void getCourseWithOrgData(courseId)
          .then((course) => {
            if (!course?.orgId) return;

            return emitWebhookEvent(course.orgId, 'lesson.completion.updated', {
              courseId,
              isComplete,
              lessonId,
              profileId: user.id
            });
          })
          .catch((error) => {
            console.error('Failed to emit lesson completion webhook:', error);
          });

        if (isComplete) {
          void evaluateCourseCertification(courseId, user.id).catch((certError) => {
            console.error('Failed to evaluate course certification after lesson completion:', certError);
          });
        }

        return c.json({ success: true, data: completion }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to update lesson completion');
      }
    }
  )
  .get(
    '/:lessonId/watch-progress',
    authMiddleware,
    courseMemberMiddleware,
    zValidator('param', ZLessonGetParam),
    async (c) => {
      try {
        const user = c.get('user')!;
        const courseId = c.req.param('courseId')!;
        const { lessonId } = c.req.valid('param');

        await assertEnrolledStudentContentAccess({
          courseId,
          profileId: user.id,
          contentId: lessonId,
          type: ContentType.Lesson
        });

        const watchProgress = await getLessonWatchProgressService(lessonId, user.id);

        return c.json({ success: true, data: watchProgress }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to get lesson watch progress');
      }
    }
  )
  .put(
    '/:lessonId/watch-progress',
    authMiddleware,
    courseMemberMiddleware,
    zValidator('param', ZLessonGetParam),
    zValidator('json', ZUpdateLessonWatchProgress),
    async (c) => {
      try {
        const user = c.get('user')!;
        const courseId = c.req.param('courseId')!;
        const { lessonId } = c.req.valid('param');
        const beat = c.req.valid('json');

        await assertEnrolledStudentContentAccess({
          courseId,
          profileId: user.id,
          contentId: lessonId,
          type: ContentType.Lesson
        });

        const watchProgress = await updateLessonWatchProgressService(lessonId, user.id, beat);

        if (watchProgress.didJustComplete) {
          void evaluateCourseCertification(courseId, user.id).catch((certError) => {
            console.error('Failed to evaluate course certification after video watch:', certError);
          });
        }

        return c.json({ success: true, data: watchProgress }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to update lesson watch progress');
      }
    }
  )
  .post(
    '/:lessonId/scorm/launch',
    authMiddleware,
    courseMemberMiddleware,
    zValidator('param', ZScormRuntimeParams),
    async (c) => {
      try {
        const user = c.get('user')!;
        const { courseId, lessonId } = c.req.valid('param');
        const result = await launchScormRuntime(courseId, lessonId, user.id);

        return c.json({ success: true, data: result }, 201);
      } catch (error) {
        return handleError(c, error, 'Failed to launch SCORM lesson');
      }
    }
  )
  .get(
    '/:lessonId/scorm/content',
    authMiddleware,
    courseMemberMiddleware,
    zValidator('param', ZScormRuntimeParams),
    async (c) => {
      try {
        const { courseId, lessonId } = c.req.valid('param');
        const result = await getScormLessonMetadata(courseId, lessonId);

        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to get SCORM lesson content');
      }
    }
  )
  .get(
    '/:lessonId/scorm/state',
    authMiddleware,
    courseMemberMiddleware,
    zValidator('param', ZScormRuntimeParams),
    async (c) => {
      try {
        const user = c.get('user')!;
        const { courseId, lessonId } = c.req.valid('param');
        const result = await getScormRuntimeState(courseId, lessonId, user.id);

        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to get SCORM state');
      }
    }
  )
  .post(
    '/:lessonId/scorm/commit',
    authMiddleware,
    courseMemberMiddleware,
    zValidator('param', ZScormRuntimeParams),
    zValidator('json', ZScormRuntimeCommit),
    async (c) => {
      try {
        const user = c.get('user')!;
        const { courseId, lessonId } = c.req.valid('param');
        const result = await saveScormRuntime(courseId, lessonId, user.id, c.req.valid('json'), false);

        if (result.registration.status === 'completed') {
          void evaluateCourseCertification(courseId, user.id).catch((certError) => {
            console.error('Failed to evaluate course certification after SCORM completion:', certError);
          });
        }

        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to commit SCORM state');
      }
    }
  )
  .post(
    '/:lessonId/scorm/terminate',
    authMiddleware,
    courseMemberMiddleware,
    zValidator('param', ZScormRuntimeParams),
    zValidator('json', ZScormRuntimeTerminate),
    async (c) => {
      try {
        const user = c.get('user')!;
        const { courseId, lessonId } = c.req.valid('param');
        const result = await saveScormRuntime(courseId, lessonId, user.id, c.req.valid('json'), true);

        if (result.registration.status === 'completed') {
          void evaluateCourseCertification(courseId, user.id).catch((certError) => {
            console.error('Failed to evaluate course certification after SCORM completion:', certError);
          });
        }

        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to terminate SCORM attempt');
      }
    }
  )
  .get('/:lessonId/scorm/assets/*', authMiddleware, courseMemberMiddleware, async (c) => {
    try {
      const courseId = c.req.param('courseId')!;
      const lessonId = c.req.param('lessonId')!;
      const marker = `/${lessonId}/scorm/assets/`;
      let assetPath: string;
      try {
        assetPath = decodeURIComponent(c.req.path.split(marker)[1] ?? '');
      } catch {
        throw new AppError(new Error('Invalid SCORM asset path encoding'), ErrorCodes.VALIDATION_ERROR, 400);
      }
      const asset = await getScormLessonAsset(courseId, lessonId, assetPath, c.req.header('range'));
      c.header('Content-Type', asset.contentType);
      c.header('Accept-Ranges', 'bytes');
      c.header('Cache-Control', 'private, max-age=3600');
      if (asset.contentLength !== undefined) c.header('Content-Length', String(asset.contentLength));
      if (asset.contentRange) c.header('Content-Range', asset.contentRange);

      return c.body(asset.body, asset.status);
    } catch (error) {
      return handleError(c, error, 'Failed to load SCORM asset');
    }
  })
  /**
   * GET /course/:courseId/lesson/:lessonId/history
   * Gets one keyset page of lesson version history, newest first.
   * Query params: locale (required), limit (optional, default 10), cursor (optional)
   * Requires authentication and course membership
   */
  .get(
    '/:lessonId/history',
    authMiddleware,
    courseMemberMiddleware,
    zValidator('param', ZLessonHistoryParam),
    zValidator('query', ZLessonHistoryQuery),
    async (c) => {
      try {
        const { lessonId } = c.req.valid('param');
        const { locale, limit, cursor } = c.req.valid('query');
        const history = await getLessonHistoryService(lessonId, locale, limit, cursor);

        return c.json(
          {
            success: true,
            data: history
          },
          200
        );
      } catch (error) {
        return handleError(c, error, 'Failed to fetch lesson history');
      }
    }
  )
  // PDF download route (existing)
  .post('/download/pdf', courseMemberMiddleware, zValidator('json', ZLessonDownloadContent), async (c) => {
    const validatedData = c.req.valid('json');

    const pdfBuffer = await generateLessonPdf(validatedData);

    c.header('Content-Type', 'application/pdf');
    return c.body(
      new ReadableStream({
        start(controller) {
          controller.enqueue(pdfBuffer);
          controller.close();
        }
      })
    );
  })
  .route('/:lessonId/language', lessonLanguageRouter);
