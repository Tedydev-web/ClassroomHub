import * as z from 'zod';

import { assessmentItemDefinitionSchema, assessmentResponseEnvelopeSchema } from '@cio/question-types';

export const ZAssessmentItemQuestionParam = z.object({
  exerciseId: z.string().uuid(),
  questionId: z.coerce.number().int().positive()
});
export type TAssessmentItemQuestionParam = z.infer<typeof ZAssessmentItemQuestionParam>;

export const ZAssessmentItemCreate = z.object({
  title: z.string().min(1).max(10_000),
  exerciseSectionId: z.uuid().nullable().optional(),
  definition: assessmentItemDefinitionSchema
});
export type TAssessmentItemCreate = z.infer<typeof ZAssessmentItemCreate>;

export const ZAssessmentItemPublish = z.object({
  title: z.string().min(1).max(10_000),
  expectedRevision: z.number().int().min(0),
  definition: assessmentItemDefinitionSchema
});
export type TAssessmentItemPublish = z.infer<typeof ZAssessmentItemPublish>;

const ZAssessmentItemMutationBase = z.object({
  clientMutationId: z.string().min(1).max(200),
  title: z.string().min(1).max(10_000),
  definition: assessmentItemDefinitionSchema
});

export const ZAssessmentItemMutation = z.discriminatedUnion('action', [
  ZAssessmentItemMutationBase.extend({
    action: z.literal('create'),
    exerciseSectionId: z.uuid().nullable(),
    order: z.number().int().min(0)
  }),
  ZAssessmentItemMutationBase.extend({
    action: z.literal('publish'),
    questionId: z.number().int().positive(),
    expectedRevision: z.number().int().min(0)
  })
]);
export type TAssessmentItemMutation = z.infer<typeof ZAssessmentItemMutation>;

/** Dedicated canonical submission payload; never pass it through legacy answer codecs. */
export const ZAssessmentItemSubmission = z.object({
  questionId: z.number().int().positive(),
  idempotencyKey: z.uuid().optional(),
  response: assessmentResponseEnvelopeSchema
});
export type TAssessmentItemSubmission = z.infer<typeof ZAssessmentItemSubmission>;
