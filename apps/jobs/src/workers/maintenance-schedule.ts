/**
 * How often each maintenance sweep runs.
 *
 * Kept apart from the worker because a schedule is data, and data this easy to mistype
 * deserves to be asserted rather than described. One of these was once `5 * 1_000` beside
 * a neighbour reading `5 * 60 * 1_000` — a missing `60`. The sweep ran every five seconds
 * over a condition measured in tens of minutes, its repeat keys grew to 98% of a
 * 455,000-key Redis, the append-only file passed nine gigabytes, and the container spent
 * its life restarting.
 */

/** Stuck `media_job` rows. */
export const MEDIA_JOB_REAP_INTERVAL_MS = 5 * 60 * 1_000;

/**
 * Exam imports whose enqueue did not survive — a safety net for a Redis that was
 * unreachable when the row was written. Acts on imports stale by `staleAfterMinutes`,
 * which defaults to thirty and cannot be set below five, so a minute is well inside the
 * smallest window a caller may ask for.
 */
export const EXAM_IMPORT_RECONCILE_INTERVAL_MS = 60 * 1_000;

/** Object storage, written to and read back so a revoked credential cannot hide. */
export const STORAGE_HEALTH_CHECK_INTERVAL_MS = 10 * 60 * 1_000;

/** The daily analytics rollup. */
export const ANALYTICS_DAILY_ROLLUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;

/** Every sweep above, for the invariant that none of them runs too hot. */
export const MAINTENANCE_INTERVALS_MS = [
  MEDIA_JOB_REAP_INTERVAL_MS,
  EXAM_IMPORT_RECONCILE_INTERVAL_MS,
  STORAGE_HEALTH_CHECK_INTERVAL_MS,
  ANALYTICS_DAILY_ROLLUP_INTERVAL_MS
] as const;
