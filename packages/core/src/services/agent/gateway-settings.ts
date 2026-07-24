/**
 * Runtime configuration for the shared AI gateway.
 *
 * Connection secrets live in env; everything here is operator-tunable at runtime
 * so the kill switch and model allowlist can change without a redeploy.
 *
 * All parsing is defensive: a missing or malformed row yields safe disabled
 * defaults rather than throwing, because a config read failure must never take
 * down the AI features that can still run on the official API path.
 */

export type GatewayCircuitState = 'closed' | 'open' | 'half_open';

/** Role a model plays in the allowlist. Never used to downgrade quality for quota. */
export type GatewayModelRole = 'default' | 'light' | 'optional';

export interface GatewayModelAllowlistEntry {
  modelId: string;
  label: string;
  /**
   * Relative quota burn vs the lightest model, calibrated by observation.
   *
   * NOTE: currently advisory. Recorded `cost_units` — which is what window
   * budgets actually sum — comes from `MODEL_COST_MULTIPLIER` in `usage.ts`.
   * Keep the two in step until they are unified, otherwise a model's configured
   * weight and its measured consumption will disagree.
   */
  quotaWeight: number;
  role: GatewayModelRole;
  /**
   * Whether the chat model picker should offer this model. Defaults to `true`
   * when absent, so existing rows written before this field existed keep
   * behaving exactly as before. Set to `false` to keep a model routable
   * (runtime/admission logic still honors it) while hiding it from the picker.
   */
  visible?: boolean;
}

/**
 * A trailing consumption window. Kept as a list because a subscription may
 * enforce several limits at once; every configured window must pass before work
 * is admitted. ChatGPT currently exposes only a weekly one — its 5-hour limit
 * was removed, so configuring a short window would reject work against a ceiling
 * that no longer exists.
 */
export interface GatewayWindow {
  id: string;
  durationMinutes: number;
  capUnits: number;
}

export interface GatewaySettings {
  enabled: boolean;
  pausedAt: string | null;
  pauseReason: string | null;
  pausedBy: string | null;
  modelAllowlist: GatewayModelAllowlistEntry[];
  defaultModelId: string | null;
  lightModelId: string | null;
  globalConcurrency: number;
  sliceRounds: number;
  defaultOrgActiveLimit: number;
  defaultOrgQueuedLimit: number;
  defaultOrgWindowBudgetUnits: number | null;
  windows: GatewayWindow[];
  fallbackEnabled: boolean;
  fallbackMonthlyCapUnits: number | null;
  circuitState: GatewayCircuitState;
  circuitOpenedAt: string | null;
  circuitResumeAfter: string | null;
  consecutiveFailures: number;
}

export interface GatewayOrgPolicy {
  orgId: string;
  priorityWeight: number;
  maxActiveRuns: number | null;
  maxQueuedRuns: number | null;
  windowBudgetUnits: number | null;
  isBlocked: boolean;
  blockReason: string | null;
}

export interface ResolvedOrgLimits {
  priorityWeight: number;
  maxActiveRuns: number;
  maxQueuedRuns: number;
  windowBudgetUnits: number | null;
  isBlocked: boolean;
  blockReason: string | null;
}

/**
 * Disabled by default. A fresh deployment must opt in explicitly, so an
 * unconfigured install keeps using the official API path.
 */
export const DEFAULT_GATEWAY_SETTINGS: GatewaySettings = {
  enabled: false,
  pausedAt: null,
  pauseReason: null,
  pausedBy: null,
  modelAllowlist: [],
  defaultModelId: null,
  lightModelId: null,
  globalConcurrency: 1,
  sliceRounds: 3,
  defaultOrgActiveLimit: 1,
  defaultOrgQueuedLimit: 3,
  defaultOrgWindowBudgetUnits: null,
  windows: [],
  fallbackEnabled: true,
  fallbackMonthlyCapUnits: null,
  circuitState: 'closed',
  circuitOpenedAt: null,
  circuitResumeAfter: null,
  consecutiveFailures: 0
};

const CIRCUIT_STATES: readonly GatewayCircuitState[] = ['closed', 'open', 'half_open'];
const MODEL_ROLES: readonly GatewayModelRole[] = ['default', 'light', 'optional'];

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.floor(parsed);
}

function toNullablePositiveInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  const parsed = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }

  return Math.floor(parsed);
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Parses the stored allowlist, dropping entries that could not be used safely. */
export function parseModelAllowlist(value: unknown): GatewayModelAllowlistEntry[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((raw): GatewayModelAllowlistEntry[] => {
    if (!raw || typeof raw !== 'object') return [];

    const entry = raw as Record<string, unknown>;
    const modelId = typeof entry.modelId === 'string' ? entry.modelId.trim() : '';
    const quotaWeight = typeof entry.quotaWeight === 'number' ? entry.quotaWeight : Number(entry.quotaWeight);

    if (!modelId) return [];
    if (!Number.isFinite(quotaWeight) || quotaWeight <= 0) return [];

    const role = MODEL_ROLES.includes(entry.role as GatewayModelRole) ? (entry.role as GatewayModelRole) : 'optional';
    // Absent/non-boolean means visible — only an explicit `false` hides a model,
    // so rows written before this field existed keep showing in the picker.
    const visible = entry.visible !== false;

    return [
      {
        modelId,
        label: typeof entry.label === 'string' && entry.label ? entry.label : modelId,
        quotaWeight,
        role,
        visible
      }
    ];
  });
}

/** Parses configured consumption windows, dropping unusable definitions. */
export function parseWindows(value: unknown): GatewayWindow[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((raw): GatewayWindow[] => {
    if (!raw || typeof raw !== 'object') return [];

    const window = raw as Record<string, unknown>;
    const id = typeof window.id === 'string' ? window.id.trim() : '';
    const durationMinutes = Number(window.durationMinutes);
    const capUnits = Number(window.capUnits);

    if (!id) return [];
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return [];
    if (!Number.isFinite(capUnits) || capUnits <= 0) return [];

    return [{ id, durationMinutes: Math.floor(durationMinutes), capUnits: Math.floor(capUnits) }];
  });
}

/** Looks up a model in the allowlist. The proxy catalog is never consulted. */
export function findAllowlistEntry(
  allowlist: GatewayModelAllowlistEntry[],
  modelId: string
): GatewayModelAllowlistEntry | undefined {
  return allowlist.find((entry) => entry.modelId === modelId);
}

/**
 * Converts a raw settings row into a fully populated, safe settings object.
 * A null row means "not configured", which is the disabled default.
 */
export function normalizeGatewaySettings(row: Partial<GatewaySettings> | null | undefined): GatewaySettings {
  if (!row) return { ...DEFAULT_GATEWAY_SETTINGS };

  const circuitState = CIRCUIT_STATES.includes(row.circuitState as GatewayCircuitState)
    ? (row.circuitState as GatewayCircuitState)
    : 'closed';

  return {
    enabled: toBoolean(row.enabled, DEFAULT_GATEWAY_SETTINGS.enabled),
    pausedAt: toNullableString(row.pausedAt),
    pauseReason: toNullableString(row.pauseReason),
    pausedBy: toNullableString(row.pausedBy),
    modelAllowlist: parseModelAllowlist(row.modelAllowlist),
    defaultModelId: toNullableString(row.defaultModelId),
    lightModelId: toNullableString(row.lightModelId),
    globalConcurrency: toPositiveInt(row.globalConcurrency, DEFAULT_GATEWAY_SETTINGS.globalConcurrency),
    sliceRounds: toPositiveInt(row.sliceRounds, DEFAULT_GATEWAY_SETTINGS.sliceRounds),
    defaultOrgActiveLimit: toPositiveInt(row.defaultOrgActiveLimit, DEFAULT_GATEWAY_SETTINGS.defaultOrgActiveLimit),
    defaultOrgQueuedLimit: toPositiveInt(row.defaultOrgQueuedLimit, DEFAULT_GATEWAY_SETTINGS.defaultOrgQueuedLimit),
    defaultOrgWindowBudgetUnits: toNullablePositiveInt(row.defaultOrgWindowBudgetUnits),
    windows: parseWindows(row.windows),
    fallbackEnabled: toBoolean(row.fallbackEnabled, DEFAULT_GATEWAY_SETTINGS.fallbackEnabled),
    fallbackMonthlyCapUnits: toNullablePositiveInt(row.fallbackMonthlyCapUnits),
    circuitState,
    circuitOpenedAt: toNullableString(row.circuitOpenedAt),
    circuitResumeAfter: toNullableString(row.circuitResumeAfter),
    consecutiveFailures: Math.max(0, Math.floor(Number(row.consecutiveFailures) || 0))
  };
}

/**
 * Merges global defaults with an org's policy row.
 *
 * A missing policy row is normal — rows are created lazily only when an operator
 * customises an org — so every field falls back to the global default.
 */
export function resolveOrgLimits(
  settings: GatewaySettings,
  policy: GatewayOrgPolicy | null | undefined
): ResolvedOrgLimits {
  if (!policy) {
    return {
      priorityWeight: 1,
      maxActiveRuns: settings.defaultOrgActiveLimit,
      maxQueuedRuns: settings.defaultOrgQueuedLimit,
      windowBudgetUnits: settings.defaultOrgWindowBudgetUnits,
      isBlocked: false,
      blockReason: null
    };
  }

  return {
    // Guarded here so virtual-time scheduling can divide by this without checks.
    priorityWeight: toPositiveInt(policy.priorityWeight, 1),
    maxActiveRuns: policy.maxActiveRuns ?? settings.defaultOrgActiveLimit,
    maxQueuedRuns: policy.maxQueuedRuns ?? settings.defaultOrgQueuedLimit,
    windowBudgetUnits: policy.windowBudgetUnits ?? settings.defaultOrgWindowBudgetUnits,
    isBlocked: Boolean(policy.isBlocked),
    blockReason: toNullableString(policy.blockReason)
  };
}

/** True when the gateway is configured, switched on, and not manually paused. */
export function isGatewayOperable(settings: GatewaySettings): boolean {
  return settings.enabled && settings.pausedAt === null;
}

/**
 * The window an org's budget is measured against: the tightest configured one.
 *
 * Shared by admission control and the usage meter on purpose. If the two picked
 * windows independently, a teacher could watch a bar sit at 40% while their run
 * was rejected for exceeding budget — the number shown must be the number
 * enforced.
 */
export function selectBudgetWindow(settings: GatewaySettings): GatewayWindow | null {
  if (settings.windows.length === 0) return null;

  return settings.windows.reduce((shortest, candidate) =>
    candidate.durationMinutes < shortest.durationMinutes ? candidate : shortest
  );
}
