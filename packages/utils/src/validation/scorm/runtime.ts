import * as z from 'zod';

const ZRuntimeValue = z.string().max(65_536);

export const ZScormRuntimeParams = z.object({
  courseId: z.uuid(),
  lessonId: z.uuid()
});

export const ZScormRuntimeCommit = z.object({
  attemptId: z.uuid(),
  values: z
    .record(z.string().min(1).max(255), ZRuntimeValue)
    .refine((values) => Object.keys(values).length <= 500, 'A commit may contain at most 500 runtime values'),
  sessionTimeSeconds: z.number().int().min(0).max(31_536_000).optional()
});

export const ZScormRuntimeTerminate = ZScormRuntimeCommit.extend({
  exitMode: z.string().max(100).optional()
});

export type TScormRuntimeCommit = z.infer<typeof ZScormRuntimeCommit>;
export type TScormRuntimeTerminate = z.infer<typeof ZScormRuntimeTerminate>;
