import * as z from 'zod';

export const ZNotificationList = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

export const ZNotificationParam = z.object({
  notificationId: z.uuid()
});
