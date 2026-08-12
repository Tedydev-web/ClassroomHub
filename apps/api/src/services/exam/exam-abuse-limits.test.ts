import { describe, expect, it } from 'vitest';

import {
  EXAM_RATE_LIMITS,
  examRateLimitKey,
  isWithinAttemptCeiling,
  type ExamRateLimitedRoute
} from './exam-abuse-limits';

/**
 * The limits that keep a public write endpoint from becoming a spam vector, without
 * locking a real class out of a real exam.
 *
 * The first test is the one that distinguishes a working limit from a broken one. Forty
 * students in one room share one public address, so a naive per-address limit on starting
 * locks out the back of the class — and the failure is silent from our side and total
 * from the teacher's.
 */

describe('rate limit keys', () => {
  it('separates two exams sharing an address, so one class cannot exhaust another’s budget', () => {
    const first = examRateLimitKey('start', 'hash-of-address', 'exam-a');
    const second = examRateLimitKey('start', 'hash-of-address', 'exam-b');

    expect(first).not.toBe(second);
  });

  it('separates the endpoints, because their legitimate traffic differs by orders of magnitude', () => {
    const start = examRateLimitKey('start', 'hash', 'exam-a');
    const save = examRateLimitKey('save', 'hash', 'exam-a');

    expect(start).not.toBe(save);
  });

  it('gives the same key to the same sitter twice, or the limit would never count', () => {
    expect(examRateLimitKey('save', 'hash', 'exam-a')).toBe(examRateLimitKey('save', 'hash', 'exam-a'));
  });
});

describe('limits sized against a real class', () => {
  it('lets a class of forty start together from one address', () => {
    const { maxRequests, windowMs } = EXAM_RATE_LIMITS.start;

    expect(maxRequests).toBeGreaterThanOrEqual(40);
    expect(windowMs).toBeLessThanOrEqual(5 * 60_000);
  });

  it('refuses a burst far beyond any plausible class', () => {
    expect(EXAM_RATE_LIMITS.start.maxRequests).toBeLessThan(400);
  });

  it('gives saving a far larger budget, since one sitter saves every few seconds for an hour', () => {
    expect(EXAM_RATE_LIMITS.save.maxRequests).toBeGreaterThan(EXAM_RATE_LIMITS.start.maxRequests);
  });

  it('keeps submitting as tight as starting — one per sitter either way', () => {
    expect(EXAM_RATE_LIMITS.submit.maxRequests).toBeLessThanOrEqual(EXAM_RATE_LIMITS.save.maxRequests);
  });

  it('covers every route the sitting endpoints expose', () => {
    const routes: ExamRateLimitedRoute[] = ['start', 'save', 'submit'];

    for (const route of routes) {
      expect(EXAM_RATE_LIMITS[route].maxRequests).toBeGreaterThan(0);
      expect(EXAM_RATE_LIMITS[route].windowMs).toBeGreaterThan(0);
    }
  });
});

describe('the ceiling on attempts per paper', () => {
  it('accepts a class-sized number of sittings', () => {
    expect(isWithinAttemptCeiling(39, 200)).toBe(true);
    expect(isWithinAttemptCeiling(199, 200)).toBe(true);
  });

  it('refuses once the ceiling is reached', () => {
    expect(isWithinAttemptCeiling(200, 200)).toBe(false);
    expect(isWithinAttemptCeiling(201, 200)).toBe(false);
  });

  it('treats a missing ceiling as no ceiling, rather than as zero', () => {
    expect(isWithinAttemptCeiling(10_000, null)).toBe(true);
  });
});
