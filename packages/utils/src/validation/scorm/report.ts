import * as z from 'zod';

export const ZScormReportParams = z.object({
  courseId: z.uuid(),
  lessonId: z.uuid()
});

export const ZScormLearnerReportParams = ZScormReportParams.extend({ profileId: z.uuid() });

export const ZScormRegistrationReportParams = z.object({ registrationId: z.uuid() });

export const ZScormReportQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});
