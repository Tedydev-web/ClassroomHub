import {
  MAX_EXAM_IMPORT_COMPACT_ANSWER_KEY_LENGTH,
  MAX_EXAM_IMPORT_DRAFT_PATCH_OPERATIONS,
  examImportDraftPatchOperationSchema
} from '@cio/exam-import/draft';
import * as z from 'zod';

export const ZExamImportCourseParam = z.strictObject({
  courseId: z.string().uuid()
});
export type TExamImportCourseParam = z.infer<typeof ZExamImportCourseParam>;

export const ZExamImportParam = z.strictObject({
  courseId: z.string().uuid(),
  importId: z.string().uuid()
});
export type TExamImportParam = z.infer<typeof ZExamImportParam>;

export const ZExamImportCreate = z.strictObject({
  assetId: z.string().uuid()
});
export type TExamImportCreate = z.infer<typeof ZExamImportCreate>;

export const ZExamImportDraftPatch = z.strictObject({
  operations: z.array(examImportDraftPatchOperationSchema).min(1).max(MAX_EXAM_IMPORT_DRAFT_PATCH_OPERATIONS)
});
export type TExamImportDraftPatch = z.infer<typeof ZExamImportDraftPatch>;

export const ZExamImportAnswerKey = z.strictObject({
  key: z.string().trim().min(1).max(MAX_EXAM_IMPORT_COMPACT_ANSWER_KEY_LENGTH)
});
export type TExamImportAnswerKey = z.infer<typeof ZExamImportAnswerKey>;

export const MAX_EXAM_IMPORT_AI_SUGGESTION_QUESTIONS = 25;

export const ZExamImportAiSuggestion = z.strictObject({
  questionIds: z
    .array(z.string().trim().min(1).max(200))
    .min(1)
    .max(MAX_EXAM_IMPORT_AI_SUGGESTION_QUESTIONS)
    .refine((questionIds) => new Set(questionIds).size === questionIds.length, {
      message: 'Question IDs must be unique'
    })
});
export type TExamImportAiSuggestion = z.infer<typeof ZExamImportAiSuggestion>;
