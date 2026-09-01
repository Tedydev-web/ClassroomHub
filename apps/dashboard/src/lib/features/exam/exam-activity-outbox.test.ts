import { describe, expect, it } from 'vitest';

import { MAX_PENDING_ACTIVITY, queueActivity, settleActivity } from './exam-activity-outbox';

/**
 * A departure that failed to reach the server used to be gone, from the one record that
 * exists to be complete. Every case here is about keeping it until it is accepted.
 */
function left(at: string) {
  return { kind: 'left' as const, at };
}

function returned(at: string) {
  return { kind: 'returned' as const, at };
}

describe('queueActivity', () => {
  it('offers what failed before ahead of what just happened', () => {
    // A reader of the log is reading a sequence, so the order is the order things occurred.
    expect(queueActivity([left('t1')], [returned('t2')])).toEqual([left('t1'), returned('t2')]);
  });

  it('sends nothing when there is nothing owed', () => {
    expect(queueActivity([], [])).toEqual([]);
  });

  it('drops the oldest rather than growing without bound', () => {
    // A page left open against a server that never answers must not fill memory. The recent
    // departure is the one somebody is about to ask about, so it is the one that survives.
    const many = Array.from({ length: MAX_PENDING_ACTIVITY + 5 }, (_, index) => left(`t${index}`));
    const queued = queueActivity(many, [left('newest')]);

    expect(queued).toHaveLength(MAX_PENDING_ACTIVITY);
    expect(queued.at(-1)).toEqual(left('newest'));
    expect(queued[0]).toEqual(left('t6'));
  });
});

describe('settleActivity', () => {
  it('clears exactly what the report carried', () => {
    expect(settleActivity([left('t1'), returned('t2')], [left('t1')])).toEqual([returned('t2')]);
  });

  it('keeps an event that happened while the report was in flight', () => {
    // Nobody has sent it. Clearing the whole queue on a successful answer would lose it, and
    // it would be lost silently, which is the failure this module exists to end.
    const pending = [left('t1')];
    const sending = [...pending];
    const arrivedMeanwhile = [...pending, returned('t2')];

    expect(settleActivity(arrivedMeanwhile, sending)).toEqual([returned('t2')]);
  });

  it('tells two events of the same kind apart by when they happened', () => {
    expect(settleActivity([left('t1'), left('t2')], [left('t1')])).toEqual([left('t2')]);
  });

  it('leaves the queue alone when the report carried nothing', () => {
    expect(settleActivity([left('t1')], [])).toEqual([left('t1')]);
  });
});
