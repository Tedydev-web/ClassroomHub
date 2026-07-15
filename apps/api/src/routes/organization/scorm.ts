import {
  ZScormPackageAttachment,
  ZScormPackageParams,
  ZScormPackageUpload,
  ZScormRegistrationReportParams,
  ZScormReportQuery,
  ZScormSourceUpload
} from '@cio/utils/validation/scorm';
import {
  attachOrganizationScormPackageItem,
  getOrganizationScormPackage,
  importScormPackage,
  listOrganizationScormPackages,
  removeOrganizationScormPackage
} from '@api/services/scorm';

import { Hono } from '@api/utils/hono';
import { authMiddleware } from '@api/middlewares/auth';
import { handleError } from '@api/utils/errors';
import { orgAdminMiddleware } from '@api/middlewares/org-admin';
import { zValidator } from '@hono/zod-validator';
import { getScormRegistrationReport, listScormRegistrations } from '@cio/db/queries/scorm';
import { generateDocumentUploadPresignedUrl } from '@cio/core/utils/s3';
import { generateFileKey } from '@cio/core/utils/upload';

export const scormRouter = new Hono()
  .get('/reports', authMiddleware, orgAdminMiddleware, zValidator('query', ZScormReportQuery), async (c) => {
    try {
      const organizationId = c.get('orgId')!;
      const { page, limit } = c.req.valid('query');
      const result = await listScormRegistrations(organizationId, page, limit);

      return c.json({ success: true, data: result }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to list SCORM reports');
    }
  })
  .get(
    '/reports/:registrationId',
    authMiddleware,
    orgAdminMiddleware,
    zValidator('param', ZScormRegistrationReportParams),
    async (c) => {
      try {
        const organizationId = c.get('orgId')!;
        const { registrationId } = c.req.valid('param');
        const result = await getScormRegistrationReport(organizationId, registrationId);

        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to get SCORM report');
      }
    }
  )
  .post(
    '/packages/source-upload',
    authMiddleware,
    orgAdminMiddleware,
    zValidator('json', ZScormSourceUpload),
    async (c) => {
      try {
        const { fileName, fileType } = c.req.valid('json');
        const fileKey = generateFileKey(fileName);
        const url = await generateDocumentUploadPresignedUrl(fileKey, fileType);

        return c.json({ success: true, data: { fileKey, url } }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to create SCORM upload URL');
      }
    }
  )
  .get('/packages', authMiddleware, orgAdminMiddleware, async (c) => {
    try {
      const organizationId = c.get('orgId')!;
      const packages = await listOrganizationScormPackages(organizationId);

      return c.json({ success: true, data: packages }, 200);
    } catch (error) {
      return handleError(c, error, 'Failed to list SCORM packages');
    }
  })
  .post('/packages', authMiddleware, orgAdminMiddleware, zValidator('json', ZScormPackageUpload), async (c) => {
    try {
      const organizationId = c.get('orgId')!;
      const user = c.get('user')!;
      const result = await importScormPackage(organizationId, user.id, c.req.valid('json'));

      return c.json({ success: true, data: result }, 201);
    } catch (error) {
      return handleError(c, error, 'Failed to import SCORM package');
    }
  })
  .post(
    '/packages/:packageId/attach',
    authMiddleware,
    orgAdminMiddleware,
    zValidator('param', ZScormPackageParams),
    zValidator('json', ZScormPackageAttachment),
    async (c) => {
      try {
        const organizationId = c.get('orgId')!;
        const user = c.get('user')!;
        const packageId = c.req.valid('param').packageId;
        const result = await attachOrganizationScormPackageItem(
          organizationId,
          user.id,
          packageId,
          c.req.valid('json')
        );

        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to attach SCORM package');
      }
    }
  )
  .get(
    '/packages/:packageId',
    authMiddleware,
    orgAdminMiddleware,
    zValidator('param', ZScormPackageParams),
    async (c) => {
      try {
        const organizationId = c.get('orgId')!;
        const result = await getOrganizationScormPackage(organizationId, c.req.valid('param').packageId);

        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to get SCORM package');
      }
    }
  )
  .delete(
    '/packages/:packageId',
    authMiddleware,
    orgAdminMiddleware,
    zValidator('param', ZScormPackageParams),
    async (c) => {
      try {
        const organizationId = c.get('orgId')!;
        const result = await removeOrganizationScormPackage(organizationId, c.req.valid('param').packageId);

        return c.json({ success: true, data: result }, 200);
      } catch (error) {
        return handleError(c, error, 'Failed to delete SCORM package');
      }
    }
  );
