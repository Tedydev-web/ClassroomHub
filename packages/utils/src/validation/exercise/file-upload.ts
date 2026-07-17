import * as z from 'zod';
import { FILE_UPLOAD_MIME_TYPES } from '@cio/question-types';

const MAX_FILE_NAME_LENGTH = 512;
const MAX_STORAGE_KEY_LENGTH = 2_048;

export const ZExerciseFileUploadParam = z.object({
  exerciseId: z.string().min(1),
  questionId: z.string().regex(/^\d+$/).transform(Number)
});

export const ZExerciseFileUploadInit = z.object({
  fileName: z.string().trim().min(1).max(MAX_FILE_NAME_LENGTH),
  mimeType: z.enum(FILE_UPLOAD_MIME_TYPES),
  size: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
});

export const ZExerciseFileUploadComplete = z.object({
  assetId: z.string().uuid(),
  storageKey: z.string().min(1).max(MAX_STORAGE_KEY_LENGTH)
});

export type TExerciseFileUploadInit = z.infer<typeof ZExerciseFileUploadInit>;
export type TExerciseFileUploadComplete = z.infer<typeof ZExerciseFileUploadComplete>;
