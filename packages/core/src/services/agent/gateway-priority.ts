/**
 * Weighted fair queueing for the shared gateway slot.
 *
 * Ordering is by *virtual time* rather than arrival order:
 *
 *     virtualTime(org) = consumedUnits(org, window) / priorityWeight(org)
 *
 * An org that has consumed more relative to its weight sorts later, so capacity
 * spreads across tenants instead of going to whoever queued first. A weight of 3
 * accumulates virtual time three times more slowly and therefore earns roughly
 * three times the turns.
 *
 * The currency is *cost units actually spent*, not slices taken: one slice can
 * be three cheap rounds or three expensive ones. Charging after service is how
 * weighted fair queueing is normally defined.
 *
 * Consumption is measured over a trailing window, so an org that burned capacity
 * yesterday is not penalised forever.
 */

/** BullMQ accepts 1..2_097_151, where a lower number is served first. */
export const BULLMQ_MAX_PRIORITY = 2_097_151;

/**
 * Cost units per priority step. Coarse on purpose: fine-grained priorities would
 * reshuffle the queue on every small difference without changing fairness in any
 * way an operator could perceive.
 */
const PRIORITY_SCALE = 1_000;

function safeWeight(priorityWeight: number): number {
  if (!Number.isFinite(priorityWeight) || priorityWeight < 1) return 1;

  return Math.floor(priorityWeight);
}

/** Virtual time for an org: consumption discounted by its priority weight. */
export function computeVirtualTime(params: { consumedUnits: number; priorityWeight: number }): number {
  const consumed = Number.isFinite(params.consumedUnits) ? Math.max(0, params.consumedUnits) : 0;

  return consumed / safeWeight(params.priorityWeight);
}

/**
 * Maps virtual time onto a BullMQ priority.
 *
 * Priority is evaluated when a job is inserted, and a sliced run re-inserts
 * itself after every lease — so recomputing here lands exactly when the queue
 * order can still change. No separate dispatcher is needed.
 */
export function computeQueuePriority(params: { consumedUnits: number; priorityWeight: number }): number {
  const virtualTime = computeVirtualTime(params);
  const scaled = Math.round(virtualTime / PRIORITY_SCALE) + 1;

  return Math.min(Math.max(scaled, 1), BULLMQ_MAX_PRIORITY);
}

export interface VirtualTimeCandidate {
  orgId: string;
  consumedUnits: number;
  priorityWeight: number;
}

/** Sort comparator putting the least-served org first. */
export function compareByVirtualTime(a: VirtualTimeCandidate, b: VirtualTimeCandidate): number {
  return computeVirtualTime(a) - computeVirtualTime(b);
}
