import { describe, expect, it } from 'vitest';
import { ZExamImportReconcilePayload } from '@cio/jobs';
import { EXAM_IMPORT_RECONCILE_INTERVAL_MS, MAINTENANCE_INTERVALS_MS } from './maintenance-schedule';

/**
 * How often the maintenance sweeps run.
 *
 * These are safety nets over conditions measured in minutes, and every run leaves a repeat
 * key behind in Redis. One of them was set to five seconds — a missing `60` next to a
 * neighbour that has one — and its keys grew to 98% of a 455,000-key keyspace, took the
 * append-only file past nine gigabytes and left the container restarting for good.
 *
 * A number is easy to mistype and hard to notice, so the relationship it has to obey is
 * asserted here rather than described in a comment.
 */
const ONE_MINUTE_MS = 60 * 1_000;

describe('maintenance schedule', () => {
  it('never sweeps more than once a minute', () => {
    for (const interval of MAINTENANCE_INTERVALS_MS) {
      expect(interval).toBeGreaterThanOrEqual(ONE_MINUTE_MS);
    }
  });

  it('sweeps for stale imports well inside the smallest staleness a caller may ask for', () => {
    // `staleAfterMinutes` has a floor of five minutes. A sweep slower than that would let a
    // stuck import sit past the window its own payload promises.
    const floorMinutes = ZExamImportReconcilePayload.parse({}).staleAfterMinutes;
    expect(floorMinutes).toBeGreaterThan(0);
    expect(EXAM_IMPORT_RECONCILE_INTERVAL_MS).toBeLessThan(5 * ONE_MINUTE_MS);
  });
});
