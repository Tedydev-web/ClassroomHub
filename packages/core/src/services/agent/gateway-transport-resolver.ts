import { findAllowlistEntry, isGatewayOperable, type GatewaySettings } from './gateway-settings';
import { isCircuitAdmitting } from './gateway-circuit-breaker';

/**
 * Decides which transport serves a given model call.
 *
 * Routing policy, and why it is asymmetric:
 *
 * - **Interactive** work (chat) falls back to the official API the moment the
 *   gateway cannot serve immediately. Making a person watch a spinner to save a
 *   small amount of money is a bad trade.
 * - **Batch** work (course generation) queues instead. It already shows a
 *   progress card, waiting is free, and the run resumes from a checkpoint.
 *
 * Output quality is never traded for quota: this resolver changes the *route*,
 * never the requested model.
 */

export type GatewayWorkload = 'interactive' | 'batch';

export type GatewayRouteDecision = 'gateway' | 'official' | 'queue' | 'unavailable';

export type GatewayRouteReason =
  | 'healthy'
  | 'gateway_disabled'
  | 'gateway_paused'
  | 'gateway_unconfigured'
  | 'gateway_busy'
  | 'circuit_open'
  | 'model_not_allowed'
  | 'fallback_disabled'
  | 'fallback_unconfigured'
  | 'fallback_cap_exceeded';

export interface GatewayRoute {
  decision: GatewayRouteDecision;
  reason: GatewayRouteReason;
  /** Operator-facing context, e.g. the pause reason. Never contains credentials. */
  detail?: string;
  /** True when this call is the single probe allowed out of a half-open circuit. */
  isProbe: boolean;
  /** Milliseconds until the gateway is worth retrying, when known. */
  retryAfterMs: number;
}

export interface GatewayConnection {
  baseURL: string;
  authToken: string;
}

export interface ResolveGatewayRouteParams {
  settings: GatewaySettings;
  connection: GatewayConnection;
  /** Whether an official provider key exists to fall back to. */
  hasOfficialKey: boolean;
  model: string;
  workload: GatewayWorkload;
  /** Whether the gateway's concurrency slots are all in use. */
  gatewaySlotBusy: boolean;
  /** Cost units already spent on fallback this month, for the spend guard. */
  fallbackMonthlyUnitsUsed?: number;
  now: number;
}

/**
 * Chooses the fallback path when the gateway cannot serve.
 *
 * The spend cap is checked here rather than through `enforceTokenBalance`
 * because self-owned deployments bypass that check entirely
 * (`usage.ts` returns an unlimited allowance), which would leave a runaway loop
 * free to spend without limit.
 */
function resolveFallback(params: ResolveGatewayRouteParams, reason: GatewayRouteReason, detail?: string): GatewayRoute {
  if (!params.settings.fallbackEnabled) {
    return { decision: 'unavailable', reason: 'fallback_disabled', detail, isProbe: false, retryAfterMs: 0 };
  }

  if (!params.hasOfficialKey) {
    return { decision: 'unavailable', reason: 'fallback_unconfigured', detail, isProbe: false, retryAfterMs: 0 };
  }

  const cap = params.settings.fallbackMonthlyCapUnits;
  const used = params.fallbackMonthlyUnitsUsed ?? 0;

  if (cap !== null && used >= cap) {
    return {
      decision: 'unavailable',
      reason: 'fallback_cap_exceeded',
      detail,
      isProbe: false,
      retryAfterMs: 0
    };
  }

  return { decision: 'official', reason, detail, isProbe: false, retryAfterMs: 0 };
}

export function resolveGatewayRoute(params: ResolveGatewayRouteParams): GatewayRoute {
  const { settings } = params;

  if (!settings.enabled) {
    return resolveFallback(params, 'gateway_disabled');
  }

  if (!isGatewayOperable(settings)) {
    return resolveFallback(params, 'gateway_paused', settings.pauseReason ?? undefined);
  }

  if (!params.connection.baseURL || !params.connection.authToken) {
    return resolveFallback(params, 'gateway_unconfigured');
  }

  // The proxy advertises models it cannot actually serve, so the stored
  // allowlist — not the proxy catalog — decides what may be requested.
  if (!findAllowlistEntry(settings.modelAllowlist, params.model)) {
    return resolveFallback(params, 'model_not_allowed');
  }

  const circuit = isCircuitAdmitting(settings, params.now);

  if (!circuit.admits) {
    const fallback = resolveFallback(params, 'circuit_open');

    return { ...fallback, retryAfterMs: circuit.retryAfterMs };
  }

  if (params.gatewaySlotBusy) {
    if (params.workload === 'batch') {
      return { decision: 'queue', reason: 'gateway_busy', isProbe: false, retryAfterMs: 0 };
    }

    return resolveFallback(params, 'gateway_busy');
  }

  return {
    decision: 'gateway',
    reason: 'healthy',
    isProbe: circuit.isProbe,
    retryAfterMs: 0
  };
}
