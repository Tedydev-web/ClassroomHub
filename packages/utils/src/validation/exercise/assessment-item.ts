import * as z from 'zod';

import { assessmentItemDefinitionSchema, assessmentResponseEnvelopeSchema } from '@cio/question-types';

export const ZAssessmentItemQuestionParam = z.object({
  exerciseId: z.string().uuid(),
  questionId: z.coerce.number().int().positive()
});
export type TAssessmentItemQuestionParam = z.infer<typeof ZAssessmentItemQuestionParam>;

export const ZAssessmentItemCreate = z.object({
  title: z.string().min(1).max(10_000),
  definition: assessmentItemDefinitionSchema
});
export type TAssessmentItemCreate = z.infer<typeof ZAssessmentItemCreate>;

export const ZAssessmentItemPublish = z.object({
  expectedRevision: z.number().int().min(0),
  definition: assessmentItemDefinitionSchema
});
export type TAssessmentItemPublish = z.infer<typeof ZAssessmentItemPublish>;

/** Dedicated canonical submission payload; never pass it through legacy answer codecs. */
export const ZAssessmentItemSubmission = z.object({
  questionId: z.number().int().positive(),
  idempotencyKey: z.uuid().optional(),
  response: assessmentResponseEnvelopeSchema
});
export type TAssessmentItemSubmission = z.infer<typeof ZAssessmentItemSubmission>;
