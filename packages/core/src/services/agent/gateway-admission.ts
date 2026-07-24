import { isGatewayOperable, type GatewaySettings, type ResolvedOrgLimits } from './gateway-settings';

/**
 * Admission control for the shared AI gateway.
 *
 * This gate is deliberately independent of `enforceTokenBalance`: self-owned
 * deployments receive an unlimited plan allowance, so that check cannot stop a
 * tenant from draining a shared subscription. Admission must hold regardless of
 * deployment mode.
 *
 * Checks run cheapest-and-most-decisive first, so a blocked org is never
 * measured against capacity it will not be allowed to use.
 */

export type GatewayAdmissionReason =
  | 'admitted'
  | 'gateway_paused'
  | 'gateway_unavailable'
  | 'org_blocked'
  | 'org_active_limit'
  | 'org_queue_limit'
  | 'org_budget_exceeded'
  | 'global_window_exhausted';

export interface GatewayAdmissionResult {
  admitted: boolean;
  reason: GatewayAdmissionReason;
  /** Operator-facing context. Never contains credentials. */
  detail?: string;
  /** True when admission depends on the official API rather than the gateway. */
  viaFallback: boolean;
}

export interface EvaluateGatewayAdmissionParams {
  settings: GatewaySettings;
  limits: ResolvedOrgLimits;
  activeRuns: number;
  queuedRuns: number;
  /** Cost units this org consumed inside the tightest configured window. */
  orgWindowUnits: number;
  /** Cost units consumed platform-wide, keyed by window id. */
  globalWindowUnits: Record<string, number>;
  /** Whether the official API is available as a fallback route. */
  hasFallback: boolean;
  /**
   * Whether an exhausted global window should fall back instead of rejecting.
   * Batch callers that can wait usually leave this off; interactive callers set it.
   */
  allowFallbackOnWindowExhaustion?: boolean;
  now: number;
}

function reject(reason: GatewayAdmissionReason, detail?: string): GatewayAdmissionResult {
  return { admitted: false, reason, detail, viaFallback: false };
}

export function evaluateGatewayAdmission(params: EvaluateGatewayAdmissionParams): GatewayAdmissionResult {
  // Per-org policy first: blocking is an operator decision that outranks capacity.
  if (params.limits.isBlocked) {
    return reject('org_blocked', params.limits.blockReason ?? undefined);
  }

  if (!isGatewayOperable(params.settings)) {
    if (params.hasFallback) {
      return { admitted: true, reason: 'admitted', viaFallback: true };
    }

    const reason = params.settings.pausedAt ? 'gateway_paused' : 'gateway_unavailable';

    return reject(reason, params.settings.pauseReason ?? undefined);
  }

  if (params.activeRuns >= params.limits.maxActiveRuns) {
    return reject('org_active_limit');
  }

  if (params.queuedRuns >= params.limits.maxQueuedRuns) {
    return reject('org_queue_limit');
  }

  if (params.limits.windowBudgetUnits !== null && params.orgWindowUnits >= params.limits.windowBudgetUnits) {
    return reject('org_budget_exceeded');
  }

  // Every configured window must pass: the subscription enforces more than one
  // limit at a time, and being under the weekly cap says nothing about the
  // shorter rolling window.
  for (const window of params.settings.windows) {
    const used = params.globalWindowUnits[window.id] ?? 0;

    if (used >= window.capUnits) {
      if (params.hasFallback && params.allowFallbackOnWindowExhaustion) {
        return { admitted: true, reason: 'admitted', viaFallback: true };
      }

      return reject('global_window_exhausted', `window "${window.id}" is at capacity`);
    }
  }

  return { admitted: true, reason: 'admitted', viaFallback: false };
}
