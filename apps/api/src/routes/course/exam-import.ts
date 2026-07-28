import {
  ZExamImportAnswerKey,
  ZExamImportAiSuggestion,
  ZExamImportCourseParam,
  ZExamImportCreate,
  ZExamImportDraftPatch,
  ZExamImportParam
} from '@cio/utils/validation/exam-import';
import { zValidator } from '@hono/zod-validator';

import { authMiddleware } from '@api/middlewares/auth';
import { courseTeamMemberMiddleware } from '@api/middlewares/course-team-member';
import { orgMemberMiddleware } from '@api/middlewares/org-member';
import {
  applyExamImportAnswerKeyService,
  cancelExamImportService,
  createExamImportService,
  estimateExamImportAiSuggestionService,
  getExamImportDraftService,
  getExamImportStatusService,
  patchExamImportDraftService,
  publishExamImportService,
  requestExamImportAiSuggestionService
} from '@api/services/exam-import';
import { handleError } from '@api/utils/errors';
import { Hono } from '@api/utils/hono';

export const examImportRouter = new Hono()
  .post(
    '/',
    authMiddleware,
    orgMemberMiddleware,
    courseTeamMemberMiddleware,
    zValidator('param', ZExamImportCourseParam),
    zValidator('json', ZExamImportCreate),
    async (c) => {
      try {
        const { courseId } = c.req.valid('param');
        const { assetId } = c.req.valid('json');
        const organizationId = c.get('orgId')!;
        const user = c.get('user')!;
        const examImport = await createExamImportService({ organizationId, courseId, userId: user.id }, assetId);

        return c.json({ success: true, data: examImport }, 201);
      } catch (error) {
        return handleError(c, error, 'Failed to create exam import');
      }
    }
  )
  .get(
    '/:importId',
    authMiddleware,
    orgMemberMiddleware,
    courseTeamMemberMiddleware,
    zValidator('param', ZExamImportParam),
    async (c) => {
      try {
        const { courseId, importId } = c.req.valid('param');
        const organizationId = c.get('orgId')!;
        const user = c.get('user')!;
        const examImport = await getExamImportStatusService({ organizationId, courseId, userId: user.id }, importId);

        return c.json({ success: true, data: examImport }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to get exam import');
      }
    }
  )
  .post(
    '/:importId/cancel',
    authMiddleware,
    orgMemberMiddleware,
    courseTeamMemberMiddleware,
    zValidator('param', ZExamImportParam),
    async (c) => {
      try {
        const { courseId, importId } = c.req.valid('param');
        const organizationId = c.get('orgId')!;
        const user = c.get('user')!;
        const canceled = await cancelExamImportService({ organizationId, courseId, userId: user.id }, importId);

        return c.json({ success: true, data: canceled }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to cancel exam import');
      }
    }
  )
  .get(
    '/:importId/draft',
    authMiddleware,
    orgMemberMiddleware,
    courseTeamMemberMiddleware,
    zValidator('param', ZExamImportParam),
    async (c) => {
      try {
        const { courseId, importId } = c.req.valid('param');
        const organizationId = c.get('orgId')!;
        const user = c.get('user')!;
        const draft = await getExamImportDraftService({ organizationId, courseId, userId: user.id }, importId);

        return c.json({ success: true, data: draft }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to get exam import draft');
      }
    }
  )
  .patch(
    '/:importId/draft',
    authMiddleware,
    orgMemberMiddleware,
    courseTeamMemberMiddleware,
    zValidator('param', ZExamImportParam),
    zValidator('json', ZExamImportDraftPatch),
    async (c) => {
      try {
        const { courseId, importId } = c.req.valid('param');
        const { operations } = c.req.valid('json');
        const organizationId = c.get('orgId')!;
        const user = c.get('user')!;
        const draft = await patchExamImportDraftService(
          { organizationId, courseId, userId: user.id },
          importId,
          operations
        );

        return c.json(
          {
            success: true,
            data: {
              kind: 'draft_updated' as const,
              updatedAt: draft.updatedAt,
              publishable: draft.publishable
            }
          },
          200
        );
      } catch (error) {
        return handleError(c, error, 'Failed to update exam import draft');
      }
    }
  )
  .post(
    '/:importId/ai-suggestion/estimate',
    authMiddleware,
    orgMemberMiddleware,
    courseTeamMemberMiddleware,
    zValidator('param', ZExamImportParam),
    zValidator('json', ZExamImportAiSuggestion),
    async (c) => {
      try {
        const { courseId, importId } = c.req.valid('param');
        const { questionIds } = c.req.valid('json');
        const organizationId = c.get('orgId')!;
        const user = c.get('user')!;
        const estimate = await estimateExamImportAiSuggestionService(
          { organizationId, courseId, userId: user.id },
          importId,
          questionIds
        );

        return c.json({ success: true, data: estimate }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to estimate exam import AI suggestion');
      }
    }
  )
  .post(
    '/:importId/ai-suggestion',
    authMiddleware,
    orgMemberMiddleware,
    courseTeamMemberMiddleware,
    zValidator('param', ZExamImportParam),
    zValidator('json', ZExamImportAiSuggestion),
    async (c) => {
      try {
        const { courseId, importId } = c.req.valid('param');
        const { questionIds } = c.req.valid('json');
        const organizationId = c.get('orgId')!;
        const user = c.get('user')!;
        const result = await requestExamImportAiSuggestionService(
          { organizationId, courseId, userId: user.id },
          importId,
          questionIds
        );

        return c.json({ success: true, data: result }, 202);
      } catch (error) {
        return handleError(c, error, 'Failed to queue exam import AI suggestion');
      }
    }
  )
  .post(
    '/:importId/answer-key',
    authMiddleware,
    orgMemberMiddleware,
    courseTeamMemberMiddleware,
    zValidator('param', ZExamImportParam),
    zValidator('json', ZExamImportAnswerKey),
    async (c) => {
      try {
        const { courseId, importId } = c.req.valid('param');
        const { key } = c.req.valid('json');
        const organizationId = c.get('orgId')!;
        const user = c.get('user')!;
        const draft = await applyExamImportAnswerKeyService(
          { organizationId, courseId, userId: user.id },
          importId,
          key
        );

        return c.json(
          {
            success: true,
            data: {
              appliedCount: draft.appliedCount,
              updatedAt: draft.updatedAt,
              publishable: draft.publishable
            }
          },
          200
        );
      } catch (error) {
        return handleError(c, error, 'Failed to apply exam import answer key');
      }
    }
  )
  .post(
    '/:importId/publish',
    authMiddleware,
    orgMemberMiddleware,
    courseTeamMemberMiddleware,
    zValidator('param', ZExamImportParam),
    async (c) => {
      try {
        const { courseId, importId } = c.req.valid('param');
        const organizationId = c.get('orgId')!;
        const user = c.get('user')!;
        const published = await publishExamImportService({ organizationId, courseId, userId: user.id }, importId);

        return c.json({ success: true, data: published }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to publish exam import');
      }
    }
  );
