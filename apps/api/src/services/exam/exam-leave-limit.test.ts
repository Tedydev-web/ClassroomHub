import { describe, expect, it } from 'vitest';

import { reachedLeaveLimit } from './exam-attempt';

/**
 * The setting reads "auto-submit after this many departures". It was comparing with `>`, so
 * two meant the third departure: a teacher's limit exceeded once for free, and a candidate
 * promised one more departure than they had.
 *
 * The rule this guards otherwise runs only against a live database, behind a flag the normal
 * suite does not set — which is how a comparison wrong by one survived to production.
 */
describe('reachedLeaveLimit', () => {
  it('ends the paper on the departure the teacher counted to', () => {
    expect(reachedLeaveLimit(1, 2)).toBe(false);
    expect(reachedLeaveLimit(2, 2)).toBe(true);
  });

  it('ends it on the first departure when that is what was asked for', () => {
    expect(reachedLeaveLimit(1, 1)).toBe(true);
  });

  it('stays ended once the count runs past the limit', () => {
    // Reports arrive late and out of order; passing the limit must not read as under it.
    expect(reachedLeaveLimit(9, 2)).toBe(true);
  });

  it('never ends a paper the teacher left unlimited', () => {
    for (const leaves of [0, 1, 50, 1000]) {
      expect(reachedLeaveLimit(leaves, null)).toBe(false);
    }
  });

  it('does not end a paper before anybody has left', () => {
    expect(reachedLeaveLimit(0, 1)).toBe(false);
  });
});
