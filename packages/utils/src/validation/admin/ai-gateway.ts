import * as z from 'zod';

/**
 * Request schemas for the operator gateway API.
 *
 * This is the boundary where untrusted input enters, so validation lives here
 * rather than deeper in the stack. Stored config is additionally parsed
 * defensively at read time, since a row can predate a schema change.
 */

export const ZGatewayModelAllowlistEntry = z.object({
  modelId: z.string().min(1),
  label: z.string().min(1),
  /** Relative quota burn. Zero or negative would break priority arithmetic. */
  quotaWeight: z.number().positive(),
  role: z.enum(['default', 'light', 'optional']),
  /** Whether the chat model picker offers this model. Defaults to true when omitted. */
  visible: z.boolean().optional()
});

export const ZGatewayWindow = z.object({
  id: z.string().min(1),
  durationMinutes: z.number().int().min(1),
  capUnits: z.number().int().positive()
});

export const ZGatewayPause = z.object({
  /** Required: an unexplained pause is impossible to triage later. */
  reason: z.string().min(3).max(500),
  pausedBy: z.string().max(200).optional()
});

export const ZGatewaySettingsPatch = z
  .object({
    enabled: z.boolean().optional(),
    defaultModelId: z.string().min(1).nullable().optional(),
    lightModelId: z.string().min(1).nullable().optional(),
    modelAllowlist: z.array(ZGatewayModelAllowlistEntry).optional(),
    windows: z.array(ZGatewayWindow).optional(),
    globalConcurrency: z.number().int().min(1).max(8).optional(),
    sliceRounds: z.number().int().min(1).max(12).optional(),
    defaultOrgActiveLimit: z.number().int().min(1).max(10).optional(),
    defaultOrgQueuedLimit: z.number().int().min(1).max(50).optional(),
    defaultOrgWindowBudgetUnits: z.number().int().positive().nullable().optional(),
    fallbackEnabled: z.boolean().optional(),
    fallbackMonthlyCapUnits: z.number().int().positive().nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update' });

export const ZGatewayOrgPolicyPatch = z
  .object({
    priorityWeight: z.number().int().min(1).max(100).optional(),
    maxActiveRuns: z.number().int().min(1).max(10).nullable().optional(),
    maxQueuedRuns: z.number().int().min(1).max(50).nullable().optional(),
    windowBudgetUnits: z.number().int().positive().nullable().optional(),
    isBlocked: z.boolean().optional(),
    blockReason: z.string().max(500).nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update' });

export const ZGatewayOrgParam = z.object({ orgId: z.string().uuid() });

export const ZGatewayRunParam = z.object({ runId: z.string().uuid() });

const RUN_STATUSES = ['queued', 'running', 'paused', 'completed', 'failed', 'canceled'] as const;

export const ZGatewayRunsQuery = z.object({
  /** Comma-separated status filter, e.g. `?status=running,queued`. */
  status: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(',').map((part) => part.trim()) : undefined))
    .pipe(z.array(z.enum(RUN_STATUSES)).optional()),
  limit: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : undefined))
    .pipe(z.number().int().min(1).max(200).optional())
});

export type TGatewaySettingsPatch = z.infer<typeof ZGatewaySettingsPatch>;
export type TGatewayOrgPolicyPatch = z.infer<typeof ZGatewayOrgPolicyPatch>;
