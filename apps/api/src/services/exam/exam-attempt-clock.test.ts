import { describe, expect, it } from 'vitest';

import { GRACE_SECONDS, computeExpiry, isWithinWritingWindow, canStartNow } from './exam-attempt-clock';

/**
 * The clock, as arithmetic. Every branch of the formula gets a case, and both boundaries
 * get one, because a boundary that is only reasoned about is a boundary that is wrong.
 *
 * The instant is always injected. A function that reads the clock itself cannot be tested
 * at its boundaries at all, which is the commonest way this logic becomes untestable.
 */

const OPENED = new Date('2026-08-12T09:00:00.000Z');

describe('exam expiry', () => {
  it('never expires when the exam has neither a working time nor a closing time', () => {
    expect(computeExpiry({ startedAt: OPENED, workingSeconds: null, closesAt: null })).toBeNull();
  });

  it('expires at the closing time when there is no working time', () => {
    const closesAt = new Date('2026-08-12T10:00:00.000Z');

    expect(computeExpiry({ startedAt: OPENED, workingSeconds: null, closesAt })).toEqual(closesAt);
  });

  it('expires a working time after starting when there is no closing time', () => {
    expect(computeExpiry({ startedAt: OPENED, workingSeconds: 1800, closesAt: null })).toEqual(
      new Date('2026-08-12T09:30:00.000Z')
    );
  });

  it('takes whichever comes first when both are set', () => {
    // Half an hour of working time, but the paper closes in ten minutes.
    const closesAt = new Date('2026-08-12T09:10:00.000Z');

    expect(computeExpiry({ startedAt: OPENED, workingSeconds: 1800, closesAt })).toEqual(closesAt);
  });

  it('gives a late arrival only the time that is left, not the full duration', () => {
    const closesAt = new Date('2026-08-12T09:10:00.000Z');
    const startedAt = new Date('2026-08-12T09:05:00.000Z');

    const expiresAt = computeExpiry({ startedAt, workingSeconds: 1800, closesAt });

    expect(expiresAt).toEqual(closesAt);
    expect((expiresAt!.getTime() - startedAt.getTime()) / 1000).toBe(300);
  });

  it('gives the full duration when it fits inside the window', () => {
    const closesAt = new Date('2026-08-12T12:00:00.000Z');

    expect(computeExpiry({ startedAt: OPENED, workingSeconds: 1800, closesAt })).toEqual(
      new Date('2026-08-12T09:30:00.000Z')
    );
  });
});

describe('the writing window', () => {
  const expiresAt = new Date('2026-08-12T09:30:00.000Z');

  it('accepts a write before the clock runs out', () => {
    expect(isWithinWritingWindow(expiresAt, new Date('2026-08-12T09:29:59.000Z'))).toBe(true);
  });

  it('accepts a write at the exact moment the clock runs out', () => {
    expect(isWithinWritingWindow(expiresAt, expiresAt)).toBe(true);
  });

  it('accepts a write inside the grace period, because a slow request is not cheating', () => {
    const withinGrace = new Date(expiresAt.getTime() + (GRACE_SECONDS - 1) * 1000);

    expect(isWithinWritingWindow(expiresAt, withinGrace)).toBe(true);
  });

  it('refuses a write one second past the grace period', () => {
    const pastGrace = new Date(expiresAt.getTime() + (GRACE_SECONDS + 1) * 1000);

    expect(isWithinWritingWindow(expiresAt, pastGrace)).toBe(false);
  });

  it('accepts any write when the exam never expires', () => {
    expect(isWithinWritingWindow(null, new Date('2030-01-01T00:00:00.000Z'))).toBe(true);
  });

  it('keeps the grace short enough to be worthless as extra time', () => {
    expect(GRACE_SECONDS).toBeLessThanOrEqual(60);
  });
});

describe('starting an attempt', () => {
  const now = new Date('2026-08-12T09:00:00.000Z');

  it('refuses before the exam opens', () => {
    expect(canStartNow({ opensAt: new Date('2026-08-12T09:30:00.000Z'), closesAt: null }, now)).toBe(false);
  });

  it('refuses after the exam closes', () => {
    expect(canStartNow({ opensAt: null, closesAt: new Date('2026-08-12T08:30:00.000Z') }, now)).toBe(false);
  });

  it('accepts inside the window', () => {
    expect(
      canStartNow(
        { opensAt: new Date('2026-08-12T08:00:00.000Z'), closesAt: new Date('2026-08-12T10:00:00.000Z') },
        now
      )
    ).toBe(true);
  });

  it('accepts when there is no window at all', () => {
    expect(canStartNow({ opensAt: null, closesAt: null }, now)).toBe(true);
  });
});
