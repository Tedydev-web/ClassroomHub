import * as z from 'zod';

export const WEBHOOK_EVENT_TYPES = [
  'organization.invite.created',
  'organization.invite.accepted',
  'organization.invite.revoked',
  'course.invite.created',
  'course.invite.accepted',
  'course.invite.revoked',
  'course.member.added',
  'course.submission.created',
  'course.submission.status_changed',
  'course.payment_request.created',
  'course.newsfeed.post.created',
  'course.newsfeed.comment.created',
  'community.question.created',
  'community.answer.created',
  'lesson.completion.updated'
] as const;

export const ZWebhookEventType = z.enum(WEBHOOK_EVENT_TYPES);

export const ZCreateWebhook = z.object({
  name: z.string().trim().min(1).max(100),
  payloadUrl: z.url(),
  secret: z.string().min(16).max(512).optional(),
  verifySsl: z.boolean().default(true),
  isActive: z.boolean().default(true),
  events: z.array(ZWebhookEventType).max(WEBHOOK_EVENT_TYPES.length).default([])
});

export const ZUpdateWebhook = ZCreateWebhook.partial().refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field is required'
});

export const ZWebhookParams = z.object({ webhookId: z.uuid() });

export const ZWebhookDeliveryParams = z.object({
  webhookId: z.uuid(),
  deliveryId: z.uuid()
});

export const ZWebhookDeliveryListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export type TCreateWebhook = z.infer<typeof ZCreateWebhook>;
export type TUpdateWebhook = z.infer<typeof ZUpdateWebhook>;
export type TWebhookEventType = z.infer<typeof ZWebhookEventType>;
