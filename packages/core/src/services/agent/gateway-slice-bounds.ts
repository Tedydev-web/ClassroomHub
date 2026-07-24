/**
 * Bounds for one time-sliced lease of a course-generation run.
 *
 * A run may hold the shared gateway slot for only `sliceRounds` rounds before it
 * must yield so another tenant can be served. Because progress is checkpointed,
 * the next lease picks up where this one stopped without redoing work.
 *
 * Pure arithmetic, extracted so the slicing rule can be tested without standing
 * up a run, a queue, or a model.
 */

export interface SliceBounds {
  /** First round index this lease will execute. */
  startRound: number;
  /** Exclusive upper bound for this lease. */
  endRound: number;
  /** True when this lease reaches the run's absolute ceiling — nothing to re-queue. */
  isFinalSlice: boolean;
}

export function computeSliceBounds(params: {
  roundsAlreadySpent: number;
  sliceRounds: number;
  maxWorkerRounds: number;
}): SliceBounds {
  // A corrupt or absent cursor must not strand a run; treat it as a fresh start.
  const spent = Number.isFinite(params.roundsAlreadySpent) ? Math.max(0, Math.floor(params.roundsAlreadySpent)) : 0;

  const startRound = Math.min(spent, params.maxWorkerRounds);

  // A zero or negative slice size would spin without progressing.
  const slice = Number.isFinite(params.sliceRounds) ? Math.max(1, Math.floor(params.sliceRounds)) : 1;

  const endRound = Math.min(startRound + slice, params.maxWorkerRounds);

  return {
    startRound,
    endRound,
    isFinalSlice: endRound >= params.maxWorkerRounds
  };
}
