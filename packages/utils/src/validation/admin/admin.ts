import * as z from 'zod';

/**
 * Query for the paginated user table. `page`/`limit` arrive as strings and are
 * coerced with a bounded `limit` so a caller cannot ask for an unbounded page.
 */
export const ZListUsersQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional()
});

export const ZAddCredits = z.object({
  amount: z.number().int().positive()
});

const siteName = z
  .string()
  .trim()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9-]+$/, 'Site name may only contain lowercase letters, numbers and hyphens')
  .refine((val) => !/^-|-$/.test(val), 'Site name may not start or end with a hyphen');

/**
 * Creating an org for a chosen owner. `siteName` allows short names on purpose —
 * this is the operator surface, and a short subdomain like `msna` is valid; the
 * public onboarding form is the one that enforces a longer minimum.
 */
export const ZCreateAdminOrg = z.object({
  name: z.string().trim().min(2).max(120),
  siteName,
  ownerUserId: z.string().uuid()
});

export const ZAdminOrgParam = z.object({ orgId: z.string().uuid() });

/** Toggles an org's AI tutor without touching any of its other settings. */
export const ZUpdateOrgAiTutor = z.object({
  enabled: z.boolean()
});

export type TListUsersQuery = z.infer<typeof ZListUsersQuery>;
export type TAddCredits = z.infer<typeof ZAddCredits>;
export type TCreateAdminOrg = z.infer<typeof ZCreateAdminOrg>;
export type TUpdateOrgAiTutor = z.infer<typeof ZUpdateOrgAiTutor>;
