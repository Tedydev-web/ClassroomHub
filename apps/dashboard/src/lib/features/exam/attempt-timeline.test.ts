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

    expect(timeline.entries).toEqual([{ kind: 'answered', at: at(10), questionId: 1, questionNumbers: [] }]);
  });
});

describe('naming the question a moment answered', () => {
  /** Interaction ids as the paper numbers them: a passage of three, then a single. */
  const numbers = { 'i-1': 1, 'i-2': 2, 'i-3': 3, 'i-4': 4 };

  function answer(at: string, questionId: number, responses: Array<[string, unknown]>) {
    return {
      at,
      questionId,
      answerData: { responses: responses.map(([interactionId, response]) => ({ interactionId, response })) }
    };
  }

  it('names only the question that changed, not everything the save carried', () => {
    // A save sends the item's whole answer, so without the comparison every save would
    // report all three questions again — which is how "answered question 160" got its shape.
    const timeline = buildAttemptTimeline(
      [],
      [
        answer('2026-08-28T00:00:00.000Z', 160, [['i-1', 'a']]),
        answer('2026-08-28T00:00:10.000Z', 160, [
          ['i-1', 'a'],
          ['i-2', 'b']
        ])
      ],
      numbers
    );

    const answered = timeline.entries.filter((entry) => entry.kind === 'answered');

    expect(answered[0]).toMatchObject({ questionNumbers: [1] });
    expect(answered[1]).toMatchObject({ questionNumbers: [2] });
  });

  it('names a changed mind, not just a first answer', () => {
    const timeline = buildAttemptTimeline(
      [],
      [
        answer('2026-08-28T00:00:00.000Z', 160, [['i-1', 'a']]),
        answer('2026-08-28T00:00:10.000Z', 160, [['i-1', 'b']])
      ],
      numbers
    );

    expect(timeline.entries.filter((entry) => entry.kind === 'answered')[1]).toMatchObject({ questionNumbers: [1] });
  });

  it('names every question when several arrive together', () => {
    const timeline = buildAttemptTimeline(
      [],
      [
        answer('2026-08-28T00:00:00.000Z', 160, [
          ['i-3', 'c'],
          ['i-1', 'a']
        ])
      ],
      numbers
    );

    // In paper order, not in the order the envelope happened to list them.
    expect(timeline.entries[0]).toMatchObject({ questionNumbers: [1, 3] });
  });

  it('keeps items apart, so one item cannot mask another', () => {
    const timeline = buildAttemptTimeline(
      [],
      [
        answer('2026-08-28T00:00:00.000Z', 160, [['i-1', 'a']]),
        answer('2026-08-28T00:00:05.000Z', 161, [['i-4', 'd']])
      ],
      numbers
    );

    const answered = timeline.entries.filter((entry) => entry.kind === 'answered');

    expect(answered[0]).toMatchObject({ questionNumbers: [1] });
    expect(answered[1]).toMatchObject({ questionNumbers: [4] });
  });

  it('leaves the numbers empty rather than guessing', () => {
    // An entry with no answers to read, and an interaction the paper no longer holds.
    const timeline = buildAttemptTimeline(
      [],
      [{ at: '2026-08-28T00:00:00.000Z', questionId: 160 }, answer('2026-08-28T00:00:05.000Z', 160, [['gone', 'x']])],
      numbers
    );

    for (const entry of timeline.entries) {
      expect(entry).toMatchObject({ questionNumbers: [] });
    }
  });
});
