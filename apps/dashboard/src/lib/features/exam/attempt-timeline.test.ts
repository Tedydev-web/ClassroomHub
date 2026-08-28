import { describe, expect, it } from 'vitest';

import { buildAttemptTimeline } from './attempt-timeline';

const at = (seconds: number) => new Date(Date.UTC(2026, 7, 28, 9, 0, seconds)).toISOString();

/**
 * The point of merging the two logs is the ordering, so the ordering is what these check —
 * and the case that motivates the whole screen: a departure, a return, and what the
 * candidate did in the seconds after it.
 */
describe('one sitting in the order it happened', () => {
  it('interleaves answers with departures by time, not by which log they came from', () => {
    const timeline = buildAttemptTimeline(
      [
        { kind: 'left', at: at(30) },
        { kind: 'returned', at: at(75) }
      ],
      [
        { at: at(10), questionId: 1 },
        { at: at(80), questionId: 2 },
        { at: at(85), questionId: 3 }
      ]
    );

    expect(timeline.entries.map((entry) => entry.kind)).toEqual([
      'answered',
      'left',
      'returned',
      'answered',
      'answered'
    ]);
  });

  it('measures a return against the departure it follows', () => {
    const timeline = buildAttemptTimeline(
      [
        { kind: 'left', at: at(0) },
        { kind: 'returned', at: at(45) }
      ],
      []
    );

    const returned = timeline.entries.find((entry) => entry.kind === 'returned');
    expect(returned).toMatchObject({ kind: 'returned', awaySeconds: 45 });
  });

  it('refuses to invent a duration for a return with nothing before it', () => {
    const timeline = buildAttemptTimeline([{ kind: 'returned', at: at(20) }], []);

    expect(timeline.entries).toEqual([{ kind: 'returned', at: at(20), awaySeconds: null }]);
  });

  it('carries the summary alongside, so a reader sees the shape and the detail', () => {
    const timeline = buildAttemptTimeline(
      [
        { kind: 'left', at: at(0) },
        { kind: 'returned', at: at(30) },
        { kind: 'left', at: at(90) },
        { kind: 'returned', at: at(115) }
      ],
      []
    );

    expect(timeline.focus.leaves).toBe(2);
    expect(timeline.focus.totalAwaySeconds).toBe(55);
    expect(timeline.focus.longestAwaySeconds).toBe(30);
  });

  it('holds up with neither log present', () => {
    const timeline = buildAttemptTimeline(null, undefined);

    expect(timeline.entries).toEqual([]);
    expect(timeline.focus.leaves).toBe(0);
  });

  it('drops entries whose timestamp is not a time rather than sorting them to the front', () => {
    const timeline = buildAttemptTimeline(
      [{ kind: 'left', at: 'whenever' }],
      [
        { at: at(10), questionId: 1 },
        { at: 'whenever', questionId: 2 }
      ]
    );

    expect(timeline.entries).toEqual([{ kind: 'answered', at: at(10), questionId: 1 }]);
  });
});
