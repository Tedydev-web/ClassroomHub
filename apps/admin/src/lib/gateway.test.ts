import { describe, expect, it } from 'vitest';

import { CANCELLABLE_STATUSES, RUN_FILTERS, RUN_STATUSES, gatewayStatus, quotaLevel, runStatusBadge } from './gateway';

const base = {
  configured: true,
  paused: false,
  circuitState: 'closed' as const,
  checks: { reachable: { ok: true, detail: '' } }
};

describe('gatewayStatus', () => {
  it('is paused when the operator paused it, regardless of health', () => {
    expect(gatewayStatus({ ...base, paused: true, circuitState: 'open' })).toBe('paused');
  });
  it('is down when unconfigured or unreachable', () => {
    expect(gatewayStatus({ ...base, configured: false })).toBe('down');
    expect(gatewayStatus({ ...base, checks: { reachable: { ok: false } } })).toBe('down');
  });
  it('is cooling when the breaker is open but reachable', () => {
    expect(gatewayStatus({ ...base, circuitState: 'open' })).toBe('cooling');
  });
  it('is healthy when configured, reachable, closed and not paused', () => {
    expect(gatewayStatus(base)).toBe('healthy');
  });
});

describe('quotaLevel', () => {
  it('escalates green → amber → red with usage', () => {
    expect(quotaLevel(10)).toBe('ok');
    expect(quotaLevel(75)).toBe('warn');
    expect(quotaLevel(95)).toBe('crit');
    expect(quotaLevel(100)).toBe('crit');
  });
});

describe('runs filter contract', () => {
  it('every filter value is empty or a comma-list of API-accepted statuses', () => {
    // The critical guard: a filter value the validator rejects returns 400 and
    // blanks the Runs screen. `active` was such a value and shipped once.
    for (const f of RUN_FILTERS) {
      if (f.value === '') continue;
      for (const status of f.value.split(',')) {
        expect(RUN_STATUSES).toContain(status);
      }
    }
  });

  it('renders force-canceled runs with the danger badge (DB spelling "canceled", one l)', () => {
    expect(runStatusBadge('canceled')).toBe('badge-danger');
    // The old two-l spelling must not be what the badge keys on.
    expect(runStatusBadge('cancelled')).toBe('badge-neutral');
  });

  it('marks only in-flight runs cancellable, never terminal ones', () => {
    expect(CANCELLABLE_STATUSES.has('running')).toBe(true);
    expect(CANCELLABLE_STATUSES.has('queued')).toBe(true);
    expect(CANCELLABLE_STATUSES.has('waiting_for_input')).toBe(true);
    expect(CANCELLABLE_STATUSES.has('completed')).toBe(false);
    expect(CANCELLABLE_STATUSES.has('canceled')).toBe(false);
    expect(CANCELLABLE_STATUSES.has('active')).toBe(false);
  });
});
