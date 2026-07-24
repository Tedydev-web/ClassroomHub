import type { GatewayModelAllowlistEntry } from './types';

export type GatewayState = 'healthy' | 'cooling' | 'down' | 'paused';

/**
 * The single word the operator reads first. Paused wins over everything — an
 * operator who hit the kill switch needs to see that, not a stale health
 * verdict. Then unusable (unconfigured/unreachable) is "down", a tripped breaker
 * that is still reachable is "cooling", and the rest is "healthy".
 */
export function gatewayStatus(h: {
  configured: boolean;
  paused: boolean;
  circuitState: 'closed' | 'open' | 'half_open' | string;
  checks: { reachable: { ok: boolean } };
}): GatewayState {
  if (h.paused) return 'paused';
  if (!h.configured || !h.checks.reachable.ok) return 'down';
  if (h.circuitState === 'open') return 'cooling';
  return 'healthy';
}

export type QuotaLevel = 'ok' | 'warn' | 'crit';

/** Green under 70%, amber under 90%, red at or above — the usual burn bands. */
export function quotaLevel(percentUsed: number): QuotaLevel {
  if (percentUsed >= 90) return 'crit';
  if (percentUsed >= 70) return 'warn';
  return 'ok';
}

/**
 * The run statuses the gateway API's runs filter accepts. Mirrors `RUN_STATUSES`
 * in packages/utils/src/validation/admin/ai-gateway.ts. This app hand-rolls its
 * types instead of importing the API graph, so gateway.test.ts asserts every
 * filter value below is a member of this set — a filter that sends a value the
 * validator rejects returns 400 and blanks the whole screen, which no
 * type-checker can catch. Note `waiting_for_input` is a real DB status but is
 * absent from the validator, so it is only reachable under the "All" filter.
 */
export const RUN_STATUSES = ['queued', 'running', 'paused', 'completed', 'failed', 'canceled'] as const;

/**
 * Status filter tabs on the Runs screen. `value` is a comma-separated list the
 * API accepts verbatim (`?status=queued,running`); '' means no filter (all).
 */
export const RUN_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'queued,running', label: 'Active' },
  { value: 'queued', label: 'Queued' },
  { value: 'running', label: 'Running' },
  { value: 'failed', label: 'Failed' },
  { value: '', label: 'All' }
];

/**
 * In-flight statuses an operator can force-cancel. Governs the Cancel button on
 * already-loaded rows, so it may include `waiting_for_input` even though that
 * status cannot be filtered. Terminal statuses (completed/failed/canceled) are
 * excluded. Spelling is the DB's single-l `canceled`.
 */
export const CANCELLABLE_STATUSES = new Set<string>(['queued', 'running', 'waiting_for_input', 'paused']);

/** Badge class for a run status. `canceled` is the DB spelling (one l). */
export function runStatusBadge(status: string): string {
  if (status === 'failed' || status === 'canceled') return 'badge-danger';
  if (status === 'completed') return 'badge-success';
  if (status === 'running') return 'badge-accent';
  return 'badge-neutral';
}

/** Badge class for a model allowlist entry's role. */
export function modelRoleBadge(role: GatewayModelAllowlistEntry['role']): string {
  if (role === 'default') return 'badge-accent';
  if (role === 'light') return 'badge-success';
  return 'badge-neutral';
}

/**
 * Flips one allowlist entry's `visible` flag, leaving every other entry
 * untouched. The settings PATCH replaces `modelAllowlist` wholesale (no
 * per-element merge), so toggling one model must resend the full array with
 * only that entry's flag changed.
 */
export function toggleModelVisibility(
  allowlist: GatewayModelAllowlistEntry[],
  modelId: string
): GatewayModelAllowlistEntry[] {
  return allowlist.map((entry) => {
    if (entry.modelId !== modelId) return entry;

    const isCurrentlyVisible = entry.visible !== false;
    return { ...entry, visible: !isCurrentlyVisible };
  });
}
