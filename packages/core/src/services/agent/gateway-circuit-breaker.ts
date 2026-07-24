import type { GatewayCircuitState } from './gateway-settings';

/**
 * Circuit breaker for the shared AI gateway.
 *
 * The subscription behind the gateway has a hard, time-windowed quota. A 429 is
 * the only authoritative signal that it is exhausted — the proxy's own quota
 * view omits live in-proxy cooldowns. When the breaker opens, traffic routes to
 * the official API instead of failing, so an open circuit degrades cost rather
 * than availability.
 *
 * Pure functions: state in, state out. Persistence lives in the caller.
 */

export type GatewayFailureReason = 'quota_exhausted' | 'auth_expired' | 'upstream_error';

export interface CircuitSnapshot {
  circuitState: GatewayCircuitState;
  circuitOpenedAt: string | null;
  circuitResumeAfter: string | null;
  consecutiveFailures: number;
}

export interface CircuitAdmissionDecision {
  admits: boolean;
  nextState: GatewayCircuitState;
  /** True when this call is the single probe allowed out of a half-open circuit. */
  isProbe: boolean;
  /** Milliseconds until the circuit is eligible to retry; 0 when admitting. */
  retryAfterMs: number;
}

/**
 * Escalating cooldowns for quota exhaustion. Short first so a brief spike
 * recovers quickly, longer after repeated failures so a genuinely drained
 * window is not hammered.
 */
const QUOTA_COOLDOWN_LADDER_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;

/**
 * Expired OAuth cannot heal on its own — it needs an operator to re-authenticate
 * the gateway — so retrying quickly only wastes requests.
 */
export const AUTH_FAILURE_COOLDOWN_MS = 60 * 60_000;

/** Maps a transport error to the reason that drives cooldown behavior. */
export function classifyGatewayFailure(error: { statusCode?: number }): GatewayFailureReason {
  if (error.statusCode === 429) return 'quota_exhausted';
  if (error.statusCode === 401 || error.statusCode === 403) return 'auth_expired';

  return 'upstream_error';
}

/**
 * Cooldown for the next open period.
 *
 * A server-supplied `Retry-After` wins when it is longer than our ladder: the
 * upstream knows its own reset better than we do. A shorter hint is ignored so a
 * misconfigured proxy cannot defeat the backoff. The AI SDK does not honor
 * `Retry-After` itself, so this layer must.
 */
export function computeCooldownMs(params: {
  consecutiveFailures: number;
  reason: GatewayFailureReason;
  retryAfterMs?: number;
}): number {
  if (params.reason === 'auth_expired') {
    return Math.max(AUTH_FAILURE_COOLDOWN_MS, params.retryAfterMs ?? 0);
  }

  const index = Math.min(Math.max(params.consecutiveFailures, 1), QUOTA_COOLDOWN_LADDER_MS.length) - 1;
  const laddered = QUOTA_COOLDOWN_LADDER_MS[index];

  return Math.max(laddered, params.retryAfterMs ?? 0);
}

/** Opens the circuit (or re-opens it harder) after a failed call. */
export function nextCircuitStateOnFailure(
  snapshot: CircuitSnapshot,
  params: { reason: GatewayFailureReason; now: number; retryAfterMs?: number }
): CircuitSnapshot {
  const consecutiveFailures = snapshot.consecutiveFailures + 1;
  const cooldownMs = computeCooldownMs({
    consecutiveFailures,
    reason: params.reason,
    retryAfterMs: params.retryAfterMs
  });

  return {
    circuitState: 'open',
    circuitOpenedAt: new Date(params.now).toISOString(),
    circuitResumeAfter: new Date(params.now + cooldownMs).toISOString(),
    consecutiveFailures
  };
}

/** Closes the circuit after a successful call and resets the backoff. */
export function nextCircuitStateOnSuccess(snapshot: CircuitSnapshot): CircuitSnapshot {
  if (snapshot.circuitState === 'closed' && snapshot.consecutiveFailures === 0) {
    return snapshot;
  }

  return {
    circuitState: 'closed',
    circuitOpenedAt: null,
    circuitResumeAfter: null,
    consecutiveFailures: 0
  };
}

/**
 * Decides whether the gateway may be called right now.
 *
 * An open circuit whose cooldown has elapsed transitions to half-open and lets a
 * single probe through; the caller records success or failure to close or
 * re-open it.
 */
export function isCircuitAdmitting(snapshot: CircuitSnapshot, now: number): CircuitAdmissionDecision {
  if (snapshot.circuitState === 'closed') {
    return { admits: true, nextState: 'closed', isProbe: false, retryAfterMs: 0 };
  }

  if (snapshot.circuitState === 'half_open') {
    return { admits: true, nextState: 'half_open', isProbe: true, retryAfterMs: 0 };
  }

  const resumeAt = snapshot.circuitResumeAfter ? Date.parse(snapshot.circuitResumeAfter) : 0;

  if (Number.isFinite(resumeAt) && now > resumeAt) {
    return { admits: true, nextState: 'half_open', isProbe: true, retryAfterMs: 0 };
  }

  return {
    admits: false,
    nextState: 'open',
    isProbe: false,
    retryAfterMs: Math.max(0, resumeAt - now)
  };
}
