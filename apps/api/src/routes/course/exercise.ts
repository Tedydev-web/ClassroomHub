import { AppError, ErrorCodes, handleError } from '@api/utils/errors';
import {
  ZExerciseCreate,
  ZExerciseAssignmentUpdate,
  ZExerciseFileUploadComplete,
  ZExerciseFileUploadInit,
  ZExerciseFileUploadParam,
  ZExerciseFromTemplate,
  ZExerciseGetParam,
  ZExerciseListQuery,
  ZExerciseSubmissionCreate,
  ZExerciseUpdate,
  ZExerciseVideoRecordingParam,
  ZExerciseVideoRecordingPlaybackParam,
  ZExerciseVideoRecordingUploadComplete,
  ZExerciseVideoRecordingUploadInit,
  ZAssessmentItemCreate,
  ZAssessmentItemPublish,
  ZAssessmentItemQuestionParam
} from '@cio/utils/validation/exercise';
import { ZTemplateById, ZTemplateByTag } from '@cio/utils/validation/mocks';
import { completeExerciseFileUpload, initExerciseFileUpload } from '@api/services/exercise/file-upload';
import {
  createExerciseForCourseService,
  createExerciseFromTemplate,
  deleteExerciseForCourseService,
  getExerciseForCourseService,
  listExercises,
  updateExerciseForCourseService
} from '@cio/core/services/exercise/exercise';
import {
  createAssessmentItemForCourseService,
  getAssessmentItemForAuthorService,
  getAssessmentItemForLearnerService,
  publishAssessmentItemForCourseService
} from '@cio/core/services/exercise/assessment-item';
import { fetchAllTemplatesMetadata, fetchTemplateById, fetchTemplatesByTag } from '@api/services/exercise/template';
import {
  canAccessCourseSubmissions,
  getGroupMemberIdByCourseAndProfile,
  isCourseTeamMemberOrOrgAdmin
} from '@cio/db/queries/group';
import {
  completeVideoRecordingUpload,
  getVideoRecordingPlaybackUrl,
  initVideoRecordingUpload
} from '@api/services/exercise/video-recording';

import {
  getNotifyCourseExerciseStatusService,
  notifyCourseExerciseService
} from '@api/services/course/notify-exercise';

import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { courseTeamMemberMiddleware } from '@api/middlewares/course-team-member';
import { authOrAutomationKeyMiddleware } from '@api/middlewares/auth-or-automation-key';
import {
  courseMemberGraderOrAutomationKeyMiddleware,
  courseMemberOrGraderMiddleware
} from '@api/middlewares/course-grader';
import { courseMemberMiddleware } from '@api/middlewares/course-member';
import { courseMemberOrAutomationKeyMiddleware } from '@api/middlewares/course-member-or-automation-key';
import { courseTeamMemberOrAutomationKeyMiddleware } from '@api/middlewares/course-team-member-or-automation-key';
import { assertMcpAutomationUsageAllowed, recordMcpAutomationUsage } from '@api/services/organization/automation-usage';
import { createSubmissionService, listExerciseSubmissionsOverview } from '@api/services/submission';
import { assertEnrolledStudentContentAccess, assertEnrolledStudentCourseAccess } from '@api/services/course/access';
import { ContentType } from '@cio/utils/constants';
import { zValidator } from '@hono/zod-validator';
import { getExerciseAssignmentsService, updateExerciseAssignmentsService } from '@api/services/exercise/assignment';

// Published @classroomio/mcp clients up to 0.0.10 call these routes with a cio_mcp_ key. Key support stays for one
// release so they can move to /public-api/v1/courses/:courseId/exercises, then goes with the middlewares it uses.
export const exerciseRouter = new Hono()
  // Exercise CRUD routes
  .get(
    '/',
    authOrAutomationKeyMiddleware,
    courseMemberOrAutomationKeyMiddleware(['course:exercise:read']),
    zValidator('query', ZExerciseListQuery),
    async (c) => {
      try {
        const courseId = c.req.param('courseId')!;
        const user = c.get('user');
        const automationKey = c.get('automationKey');
        const { lessonId, sectionId } = c.req.valid('query');

        if (automationKey?.type === 'mcp') {
          await assertMcpAutomationUsageAllowed(automationKey, 'list_course_exercises');
        }

        if (user?.id) {
          await assertEnrolledStudentCourseAccess({ courseId, profileId: user.id });
        }

        const exercises = await listExercises(courseId, { lessonId, sectionId }, user?.id);

        if (automationKey?.type === 'mcp') {
          await recordMcpAutomationUsage(automationKey, 'list_course_exercises', { courseId, lessonId, sectionId });
        }

        return c.json({ success: true, data: exercises }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to list exercises');
      }
    }
  )
  .get(
    '/:exerciseId/submissions',
    authMiddleware,
    courseMemberOrGraderMiddleware,
    zValidator('param', ZExerciseGetParam),
    async (c) => {
      try {
        const courseId = c.req.param('courseId')!;
        const { exerciseId } = c.req.valid('param');
        const user = c.get('user')!;

        if (!(await canAccessCourseSubmissions(courseId, user.id))) {
          await assertEnrolledStudentContentAccess({
            courseId,
            profileId: user.id,
            contentId: exerciseId,
            type: ContentType.Exercise
          });
        }

        const data = await listExerciseSubmissionsOverview(courseId, exerciseId, user.id);
        return c.json({ success: true, data }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to fetch exercise submissions overview');
      }
    }
  )
  .get(
    '/:exerciseId/assignment',
    authMiddleware,
    courseTeamMemberMiddleware,
    zValidator('param', ZExerciseGetParam),
    async (c) => {
      try {
        const courseId = c.req.param('courseId')!;
        const { exerciseId } = c.req.valid('param');
        const data = await getExerciseAssignmentsService(courseId, exerciseId);

        return c.json({ success: true, data }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to fetch exercise assignments');
      }
    }
  )
  .put(
    '/:exerciseId/assignment',
    authMiddleware,
    courseTeamMemberMiddleware,
    zValidator('param', ZExerciseGetParam),
    zValidator('json', ZExerciseAssignmentUpdate),
    async (c) => {
      try {
        const courseId = c.req.param('courseId')!;
        const { exerciseId } = c.req.valid('param');
        const user = c.get('user')!;
        const data = c.req.valid('json');
        const assignments = await updateExerciseAssignmentsService(courseId, exerciseId, user.id, data);

        return c.json({ success: true, data: assignments }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to update exercise assignments');
      }
    }
  )
  .post('/:exerciseId/notify', authMiddleware, courseTeamMemberMiddleware, async (c) => {
    try {
      const courseId = c.req.param('courseId')!;
      const exerciseId = c.req.param('exerciseId')!;

      const result = await notifyCourseExerciseService(courseId, exerciseId);
      return c.json({ success: true, data: result }, 202);
    } catch (error) {
      return handleError(c, error, 'Failed to notify students');
    }
  })
  .get('/:exerciseId/notify/:jobId', authMiddleware, courseTeamMemberMiddleware, async (c) => {
    try {
      const jobId = c.req.param('jobId')!;
      const pollCount = Number.parseInt(c.req.query('pollCount') ?? '0', 10) || 0;

      const envelope = await getNotifyCourseExerciseStatusService(jobId, pollCount);
      return c.json({ success: true, data: envelope }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to fetch notification status');
    }
  })
  .post(
    '/:exerciseId/assessment-item',
    authMiddleware,
    courseTeamMemberMiddleware,
    zValidator('param', ZExerciseGetParam),
    zValidator('json', ZAssessmentItemCreate),
    async (c) => {
      try {
        const courseId = c.req.param('courseId')!;
        const { exerciseId } = c.req.valid('param');
        const { title, exerciseSectionId, definition } = c.req.valid('json');
        const item = await createAssessmentItemForCourseService(
          courseId,
          exerciseId,
          title,
          definition,
          exerciseSectionId
        );

        return c.json({ success: true, data: item }, 201);
      } catch (error) {
        return handleError(c, error, 'Failed to create assessment question');
      }
    }
  )
  .put(
    '/:exerciseId/question/:questionId/assessment-item',
    authMiddleware,
    courseTeamMemberMiddleware,
    zValidator('param', ZAssessmentItemQuestionParam),
    zValidator('json', ZAssessmentItemPublish),
    async (c) => {
      try {
        const courseId = c.req.param('courseId')!;
        const { exerciseId, questionId } = c.req.valid('param');
        const { title, expectedRevision, definition } = c.req.valid('json');
        const item = await publishAssessmentItemForCourseService(
          courseId,
          exerciseId,
          questionId,
          title,
          expectedRevision,
          definition
        );

        return c.json({ success: true, data: item }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to publish assessment question');
      }
    }
  )
  .get(
    '/:exerciseId/question/:questionId/assessment-item',
    authMiddleware,
    courseMemberMiddleware,
    zValidator('param', ZAssessmentItemQuestionParam),
    async (c) => {
      try {
        const user = c.get('user')!;
        const courseId = c.req.param('courseId')!;
        const { exerciseId, questionId } = c.req.valid('param');
        const isTeamMember = await isCourseTeamMemberOrOrgAdmin(courseId, user.id);
        if (!isTeamMember) {
          await assertEnrolledStudentContentAccess({
            courseId,
            profileId: user.id,
            contentId: exerciseId,
            type: ContentType.Exercise
          });
        }

        const item = isTeamMember
          ? await getAssessmentItemForAuthorService(courseId, exerciseId, questionId)
          : await getAssessmentItemForLearnerService(courseId, exerciseId, questionId);

        return c.json({ success: true, data: item }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to fetch assessment question');
      }
    }
  )
  .get(
    '/:exerciseId',
    authOrAutomationKeyMiddleware,
    courseMemberGraderOrAutomationKeyMiddleware(['course:exercise:read']),
    zValidator('param', ZExerciseGetParam),
    async (c) => {
      try {
        const courseId = c.req.param('courseId')!;
        const { exerciseId } = c.req.valid('param');
        const user = c.get('user');
        const automationKey = c.get('automationKey');

        if (automationKey?.type === 'mcp') {
          await assertMcpAutomationUsageAllowed(automationKey, 'get_course_exercise');
        }

        if (user?.id && !automationKey) {
          await assertEnrolledStudentContentAccess({
            courseId,
            profileId: user.id,
            contentId: exerciseId,
            type: ContentType.Exercise
          });
        }

        const viewerProfileId = user?.id ?? automationKey?.createdByProfileId;
        if (!viewerProfileId) {
          throw new AppError('Exercise viewer identity is missing', ErrorCodes.UNAUTHORIZED, 401);
        }

        const exercise = await getExerciseForCourseService(courseId, exerciseId, viewerProfileId);

        if (automationKey?.type === 'mcp') {
          await recordMcpAutomationUsage(automationKey, 'get_course_exercise', {
            courseId,
            exerciseId
          });
        }

        return c.json({ success: true, data: exercise }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to fetch exercise');
      }
    }
  )
  .post(
    '/:exerciseId/question/:questionId/file-upload/init',
    authMiddleware,
    courseMemberMiddleware,
    zValidator('param', ZExerciseFileUploadParam),
    zValidator('json', ZExerciseFileUploadInit),
    async (c) => {
      try {
        const user = c.get('user')!;
        const courseId = c.req.param('courseId')!;
        const { exerciseId, questionId } = c.req.valid('param');
        const data = c.req.valid('json');

        await assertEnrolledStudentContentAccess({
          courseId,
          profileId: user.id,
          contentId: exerciseId,
          type: ContentType.Exercise
        });

        const upload = await initExerciseFileUpload(courseId, exerciseId, questionId, user.id, data);
        return c.json({ success: true, data: upload }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to initialize exercise file upload');
      }
    }
  )
  .post(
    '/:exerciseId/question/:questionId/file-upload/complete',
    authMiddleware,
    courseMemberMiddleware,
    zValidator('param', ZExerciseFileUploadParam),
    zValidator('json', ZExerciseFileUploadComplete),
    async (c) => {
      try {
        const user = c.get('user')!;
        const courseId = c.req.param('courseId')!;
        const { exerciseId, questionId } = c.req.valid('param');
        const data = c.req.valid('json');

        await assertEnrolledStudentContentAccess({
          courseId,
          profileId: user.id,
          contentId: exerciseId,
          type: ContentType.Exercise
        });

        const answer = await completeExerciseFileUpload(courseId, exerciseId, questionId, user.id, data);
        return c.json({ success: true, data: answer }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to complete exercise file upload');
      }
    }
  )
  .post(
    '/',
    authOrAutomationKeyMiddleware,
    courseTeamMemberOrAutomationKeyMiddleware(['course:exercise:write']),
    zValidator('json', ZExerciseCreate),
    async (c) => {
      try {
        const data = c.req.valid('json');
        const courseId = c.req.param('courseId')!;
        const automationKey = c.get('automationKey');

        if (data.courseId !== courseId) {
          throw new AppError('Course ID does not match the route', ErrorCodes.VALIDATION_ERROR, 400);
        }

        if (automationKey?.type === 'mcp') {
          await assertMcpAutomationUsageAllowed(automationKey, 'create_course_exercise');
        }

        const exercise = await createExerciseForCourseService(courseId, data);

        if (automationKey?.type === 'mcp') {
          await recordMcpAutomationUsage(automationKey, 'create_course_exercise', {
            courseId,
            exerciseId: exercise.id
          });
        }

        return c.json({ success: true, data: exercise }, 201);
      } catch (error) {
        return handleError(c, error, 'Failed to create exercise');
      }
    }
  )
  /**
   * POST /course/:courseId/exercise/from-template
   * Creates an exercise from a template
   * Requires authentication and course membership (admin/tutor role)
   */
  .post(
    '/from-template',
    authOrAutomationKeyMiddleware,
    courseTeamMemberOrAutomationKeyMiddleware(['course:exercise:write']),
    zValidator('json', ZExerciseFromTemplate),
    async (c) => {
      try {
        const courseId = c.req.param('courseId')!;
        const automationKey = c.get('automationKey');
        const { lessonId, sectionId, order, templateId } = c.req.valid('json');

        if (automationKey?.type === 'mcp') {
          await assertMcpAutomationUsageAllowed(automationKey, 'create_course_exercise_from_template');
        }

        // Fetch template from database
        const template = await fetchTemplateById(templateId);
        if (!template) {
          return c.json({ success: false, error: 'Template not found' }, 404);
        }

        if (!template.questionnaire) {
          return c.json({ success: false, error: 'Template is missing questionnaire data' }, 400);
        }

        const exercise = await createExerciseFromTemplate(courseId, lessonId, sectionId, order, template);

        if (automationKey?.type === 'mcp') {
          await recordMcpAutomationUsage(automationKey, 'create_course_exercise_from_template', {
            courseId,
            exerciseId: exercise.id,
            templateId
          });
        }

        return c.json({ success: true, data: exercise }, 201);
      } catch (error) {
        return handleError(c, error, 'Failed to create exercise from template');
      }
    }
  )
  .put(
    '/:exerciseId',
    authOrAutomationKeyMiddleware,
    courseTeamMemberOrAutomationKeyMiddleware(['course:exercise:write']),
    zValidator('param', ZExerciseGetParam),
    zValidator('json', ZExerciseUpdate),
    async (c) => {
      try {
        const { exerciseId } = c.req.valid('param');
        const data = c.req.valid('json');
        const courseId = c.req.param('courseId')!;
        const user = c.get('user');
        const automationKey = c.get('automationKey');

        if (automationKey?.type === 'mcp') {
          await assertMcpAutomationUsageAllowed(automationKey, 'update_course_exercise');
        }

        if (!automationKey && user && data.isUnlocked !== undefined) {
          const isAuthorized = await isCourseTeamMemberOrOrgAdmin(courseId, user.id);

          if (!isAuthorized) {
            return c.json(
              {
                success: false,
                error: 'Unauthorized',
                code: ErrorCodes.UNAUTHORIZED
              },
              403
            );
          }
        }

        const viewerProfileId = automationKey ? undefined : user?.id;
        const exercise = await updateExerciseForCourseService(courseId, exerciseId, data, viewerProfileId);

        if (automationKey?.type === 'mcp') {
          await recordMcpAutomationUsage(automationKey, 'update_course_exercise', { courseId, exerciseId });
        }

        return c.json({ success: true, data: exercise }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to update exercise');
      }
    }
  )
  .delete(
    '/:exerciseId',
    authMiddleware,
    courseTeamMemberMiddleware,
    zValidator('param', ZExerciseGetParam),
    async (c) => {
      try {
        const courseId = c.req.param('courseId')!;
        const { exerciseId } = c.req.valid('param');
        const exercise = await deleteExerciseForCourseService(courseId, exerciseId);

        return c.json({ success: true, data: exercise }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to delete exercise');
      }
    }
  )
  // Exercise Submission routes
  .post(
    '/:exerciseId/submission',
    authMiddleware,
    courseMemberMiddleware,
    zValidator('param', ZExerciseGetParam),
    zValidator('json', ZExerciseSubmissionCreate),
    async (c) => {
      try {
        const user = c.get('user')!;
        const courseId = c.req.param('courseId')!;
        const { exerciseId } = c.req.valid('param');
        const submissionPayload = c.req.valid('json');
        if (submissionPayload.exerciseId !== exerciseId) {
          throw new AppError('Exercise ID does not match the route', ErrorCodes.VALIDATION_ERROR, 400);
        }

        const { answers, idempotencyKey } = submissionPayload;

        const groupMemberId = await getGroupMemberIdByCourseAndProfile(courseId, user.id);
        if (!groupMemberId) {
          return c.json({ success: false, error: 'User is not a member of this course' }, 403);
        }

        await assertEnrolledStudentContentAccess({
          courseId,
          profileId: user.id,
          contentId: exerciseId,
          type: ContentType.Exercise
        });

        const submission = await createSubmissionService(courseId, exerciseId, groupMemberId, answers, {
          idempotencyKey
        });

        return c.json({ success: true, data: submission }, 201);
      } catch (error) {
        return handleError(c, error, 'Failed to submit exercise');
      }
    }
  )
  .post(
    '/:exerciseId/question/:questionId/video-recording/upload/init',
    authMiddleware,
    courseMemberMiddleware,
    zValidator('param', ZExerciseVideoRecordingParam),
    zValidator('json', ZExerciseVideoRecordingUploadInit),
    async (c) => {
      try {
        const user = c.get('user')!;
        const courseId = c.req.param('courseId')!;
        const { exerciseId, questionId } = c.req.valid('param');
        const data = c.req.valid('json');

        await assertEnrolledStudentContentAccess({
          courseId,
          profileId: user.id,
          contentId: exerciseId,
          type: ContentType.Exercise
        });

        const upload = await initVideoRecordingUpload(courseId, exerciseId, questionId, user.id, data);

        return c.json({ success: true, data: upload }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to initialize video recording upload');
      }
    }
  )
  .post(
    '/:exerciseId/question/:questionId/video-recording/upload/complete',
    authMiddleware,
    courseMemberMiddleware,
    zValidator('param', ZExerciseVideoRecordingParam),
    zValidator('json', ZExerciseVideoRecordingUploadComplete),
    async (c) => {
      try {
        const user = c.get('user')!;
        const courseId = c.req.param('courseId')!;
        const { exerciseId, questionId } = c.req.valid('param');
        const data = c.req.valid('json');

        await assertEnrolledStudentContentAccess({
          courseId,
          profileId: user.id,
          contentId: exerciseId,
          type: ContentType.Exercise
        });

        const answer = await completeVideoRecordingUpload(courseId, exerciseId, questionId, user.id, data);

        return c.json({ success: true, data: answer }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to complete video recording upload');
      }
    }
  )
  .get(
    '/:exerciseId/submission/:submissionId/question/:questionId/video-recording/playback',
    authMiddleware,
    courseMemberOrGraderMiddleware,
    zValidator('param', ZExerciseVideoRecordingPlaybackParam),
    async (c) => {
      try {
        const user = c.get('user')!;
        const courseId = c.req.param('courseId')!;
        const { exerciseId, submissionId, questionId } = c.req.valid('param');

        const playback = await getVideoRecordingPlaybackUrl(courseId, exerciseId, submissionId, questionId, user.id);

        return c.json({ success: true, data: playback }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to get video recording playback URL');
      }
    }
  )
  // Template routes
  .get('/template', authMiddleware, courseMemberMiddleware, async (c) => {
    try {
      const result = await fetchAllTemplatesMetadata();

      return c.json({ success: true, data: result }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load template metadata');
    }
  })
  .get('/template/:id', authMiddleware, courseMemberMiddleware, zValidator('param', ZTemplateById), async (c) => {
    try {
      const { id } = c.req.valid('param');

      const result = await fetchTemplateById(id);
      return c.json({ success: true, data: result }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load template');
    }
  })
  .get('/template/tag/:tag', authMiddleware, courseMemberMiddleware, zValidator('param', ZTemplateByTag), async (c) => {
    try {
      const { tag } = c.req.valid('param');

      const result = await fetchTemplatesByTag(tag);
      return c.json({ success: true, data: result }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to load template');
    }
  });
