import * as z from 'zod';

export const SCORM_VERSIONS = ['1.2', '2004', 'unknown'] as const;

export const ZScormVersion = z.enum(SCORM_VERSIONS);

export const ZScormPackageUpload = z.object({
  assetId: z.uuid(),
  title: z.string().trim().min(1).max(255)
});

export const ZScormSourceUpload = z.object({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((name) => name.toLowerCase().endsWith('.zip'), 'File must be a ZIP'),
  fileType: z.enum(['application/zip', 'application/x-zip-compressed', 'application/octet-stream']),
  fileSize: z
    .number()
    .int()
    .min(1)
    .max(100 * 1024 * 1024)
});

export const ZScormPackageParams = z.object({ packageId: z.uuid() });

export const ZScormPackageAttachment = z.object({
  courseId: z.uuid(),
  lessonId: z.uuid(),
  packageItemId: z.uuid()
});

export type TScormVersion = z.infer<typeof ZScormVersion>;
export type TScormPackageUpload = z.infer<typeof ZScormPackageUpload>;
export type TScormSourceUpload = z.infer<typeof ZScormSourceUpload>;
export type TScormPackageAttachment = z.infer<typeof ZScormPackageAttachment>;
