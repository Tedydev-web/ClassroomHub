import { describe, expect, it } from 'vitest';

import { linkAttempts, type AttemptLinkInput } from './exam-attempt-links';

function attempt(overrides: Partial<AttemptLinkInput> & { attemptId: string }): AttemptLinkInput {
  return {
    examId: 'exam-1',
    displayName: overrides.attemptId,
    startedAt: '2026-10-14T08:00:00.000Z',
    submittedAt: null,
    deviceHash: null,
    fingerprintHash: null,
    ipHash: null,
    ...overrides
  };
}

describe('linkAttempts', () => {
  it('links nothing when attempts share no signal', () => {
    const links = linkAttempts([
      attempt({ attemptId: 'a', deviceHash: 'd1', ipHash: 'n1' }),
      attempt({ attemptId: 'b', deviceHash: 'd2', ipHash: 'n2' })
    ]);

    expect(links.get('a')).toEqual({ links: [], startedAfterSubmitOf: null });
  });

  it('names the strongest shared signal for each pair', () => {
    const links = linkAttempts([
      attempt({ attemptId: 'a', deviceHash: 'd1', fingerprintHash: 'f1', ipHash: 'n1' }),
      attempt({ attemptId: 'same-device', deviceHash: 'd1', fingerprintHash: 'f9', ipHash: 'n9' }),
      attempt({ attemptId: 'private-window', deviceHash: 'd2', fingerprintHash: 'f1', ipHash: 'n1' }),
      attempt({ attemptId: 'same-wifi', deviceHash: 'd3', fingerprintHash: 'f3', ipHash: 'n1' })
    ]);

    expect(links.get('a')?.links.map((link) => [link.attemptId, link.signal])).toEqual([
      ['same-device', 'device'],
      ['private-window', 'device_likely'],
      ['same-wifi', 'network']
    ]);
  });

  it('does not treat a matching fingerprint on another network as the same device', () => {
    const links = linkAttempts([
      attempt({ attemptId: 'a', fingerprintHash: 'f1', ipHash: 'n1' }),
      attempt({ attemptId: 'b', fingerprintHash: 'f1', ipHash: 'n2' })
    ]);

    expect(links.get('a')?.links).toEqual([]);
  });

  it('never links attempts on different papers', () => {
    const links = linkAttempts([
      attempt({ attemptId: 'a', examId: 'exam-1', deviceHash: 'd1' }),
      attempt({ attemptId: 'b', examId: 'exam-2', deviceHash: 'd1' })
    ]);

    expect(links.get('a')?.links).toEqual([]);
  });

  it('points out an attempt begun soon after a linked one was handed in', () => {
    const links = linkAttempts([
      attempt({
        attemptId: 'throwaway',
        displayName: 'Nguyễn Văn Ảo',
        deviceHash: 'd1',
        startedAt: '2026-10-14T08:00:00.000Z',
        submittedAt: '2026-10-14T08:20:00.000Z'
      }),
      attempt({ attemptId: 'real', deviceHash: 'd1', startedAt: '2026-10-14T08:24:00.000Z' })
    ]);

    expect(links.get('real')?.startedAfterSubmitOf).toEqual({
      attemptId: 'throwaway',
      displayName: 'Nguyễn Văn Ảo',
      minutes: 4,
      signal: 'device'
    });
    expect(links.get('throwaway')?.startedAfterSubmitOf).toBeNull();
  });

  it('ignores a linked attempt handed in long before this one began', () => {
    const links = linkAttempts([
      attempt({
        attemptId: 'morning',
        ipHash: 'n1',
        startedAt: '2026-10-14T01:00:00.000Z',
        submittedAt: '2026-10-14T01:40:00.000Z'
      }),
      attempt({ attemptId: 'evening', ipHash: 'n1', startedAt: '2026-10-14T12:00:00.000Z' })
    ]);

    expect(links.get('evening')?.startedAfterSubmitOf).toBeNull();
    expect(links.get('evening')?.links).toHaveLength(1);
  });

  it('prefers the nearest earlier hand-in when several qualify', () => {
    const links = linkAttempts([
      attempt({
        attemptId: 'x',
        ipHash: 'n1',
        startedAt: '2026-10-14T08:00:00.000Z',
        submittedAt: '2026-10-14T08:05:00.000Z'
      }),
      attempt({
        attemptId: 'y',
        deviceHash: 'd1',
        startedAt: '2026-10-14T08:00:00.000Z',
        submittedAt: '2026-10-14T08:25:00.000Z'
      }),
      attempt({ attemptId: 'z', deviceHash: 'd1', ipHash: 'n1', startedAt: '2026-10-14T08:28:00.000Z' })
    ]);

    expect(links.get('z')?.startedAfterSubmitOf?.attemptId).toBe('y');
  });
});
