import { describe, expect, it } from 'vitest';

import { summariseFocus, type ActivityEvent } from './exam-activity';

/**
 * The cases that matter are the malformed ones. A device that slept, a tab that closed, a
 * log that began mid-absence — each produces a sequence that does not alternate, and a
 * summary that quietly invents a duration for one of them would be evidence a teacher
 * reads as fact.
 */
const at = (seconds: number) => new Date(Date.UTC(2026, 7, 28, 9, 0, seconds)).toISOString();

function log(...entries: Array<[ActivityEvent['kind'], number]>): ActivityEvent[] {
  return entries.map(([kind, seconds]) => ({ kind, at: at(seconds) }));
}

describe('summarising how often a paper was left', () => {
  it('reports nothing for a paper nobody left', () => {
    expect(summariseFocus([])).toEqual({
      leaves: 0,
      totalAwaySeconds: 0,
      longestAwaySeconds: 0,
      endedAway: false
    });
  });

  it('measures one absence', () => {
    const summary = summariseFocus(log(['left', 10], ['returned', 40]));

    expect(summary.leaves).toBe(1);
    expect(summary.totalAwaySeconds).toBe(30);
    expect(summary.longestAwaySeconds).toBe(30);
    expect(summary.endedAway).toBe(false);
  });

  it('separates several short absences from one long one', () => {
    // The shape that is worth telling apart: three lookups against a single phone call.
    const lookups = summariseFocus(
      log(['left', 0], ['returned', 25], ['left', 60], ['returned', 85], ['left', 120], ['returned', 150])
    );
    const call = summariseFocus(log(['left', 0], ['returned', 240]));

    expect(lookups.leaves).toBe(3);
    expect(lookups.longestAwaySeconds).toBe(30);
    expect(call.leaves).toBe(1);
    expect(call.longestAwaySeconds).toBe(240);

    // Counting alone cannot tell these apart in the direction that matters: the single
    // long absence is the innocent one and it is the one with the larger total.
    expect(call.totalAwaySeconds).toBeGreaterThan(lookups.totalAwaySeconds);
  });

  it('keeps the count but drops the duration when a return was never recorded', () => {
    const summary = summariseFocus(log(['left', 10], ['left', 100], ['returned', 130]));

    expect(summary.leaves).toBe(2);
    // Only the second absence has an end; the first contributes nothing rather than a
    // guess.
    expect(summary.totalAwaySeconds).toBe(30);
    expect(summary.endedAway).toBe(false);
  });

  it('says so when the paper was left and never seen again', () => {
    const summary = summariseFocus(log(['left', 10], ['returned', 20], ['left', 50]));

    expect(summary.leaves).toBe(2);
    expect(summary.totalAwaySeconds).toBe(10);
    expect(summary.endedAway).toBe(true);
  });

  it('ignores a return that opens the log', () => {
    const summary = summariseFocus(log(['returned', 5], ['left', 10], ['returned', 20]));

    expect(summary.leaves).toBe(1);
    expect(summary.totalAwaySeconds).toBe(10);
  });

  it('reads events in time order however they arrive', () => {
    const summary = summariseFocus(log(['returned', 40], ['left', 10]));

    expect(summary.leaves).toBe(1);
    expect(summary.totalAwaySeconds).toBe(30);
  });

  it('ignores an entry whose timestamp is not a time', () => {
    const summary = summariseFocus([
      { kind: 'left', at: 'not a date' },
      { kind: 'left', at: at(10) },
      { kind: 'returned', at: at(25) }
    ]);

    expect(summary.leaves).toBe(1);
    expect(summary.totalAwaySeconds).toBe(15);
  });
});
