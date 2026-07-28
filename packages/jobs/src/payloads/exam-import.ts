import * as z from 'zod';

export const ZExamImportPayload = z.strictObject({
  importId: z.string().uuid(),
  organizationId: z.string().uuid(),
  courseId: z.string().uuid()
});

export type TExamImportPayload = z.infer<typeof ZExamImportPayload>;

export const ZExamImportAiSuggestionPayload = ZExamImportPayload.extend({
  actorProfileId: z.string().uuid(),
  questionIds: z
    .array(z.string().min(1).max(200))
    .min(1)
    .max(25)
    .refine((questionIds) => new Set(questionIds).size === questionIds.length, {
      message: 'Question IDs must be unique'
    }),
  expectedDraftUpdatedAt: z.string().datetime()
});

export type TExamImportAiSuggestionPayload = z.infer<typeof ZExamImportAiSuggestionPayload>;
