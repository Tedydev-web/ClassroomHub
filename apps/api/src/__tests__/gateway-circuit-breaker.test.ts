import { describe, expect, it } from 'vitest';
import {
  AUTH_FAILURE_COOLDOWN_MS,
  classifyGatewayFailure,
  computeCooldownMs,
  isCircuitAdmitting,
  nextCircuitStateOnFailure,
  nextCircuitStateOnSuccess
} from '@cio/core/services/agent/gateway-circuit-breaker';

const NOW = Date.parse('2026-07-23T10:00:00.000Z');

const CLOSED = {
  circuitState: 'closed' as const,
  circuitOpenedAt: null,
  circuitResumeAfter: null,
  consecutiveFailures: 0
};

describe('classifyGatewayFailure', () => {
  it('classifies 429 as quota exhaustion', () => {
    expect(classifyGatewayFailure({ statusCode: 429 })).toBe('quota_exhausted');
  });

  it('classifies 401 as expired auth', () => {
    expect(classifyGatewayFailure({ statusCode: 401 })).toBe('auth_expired');
  });

  it('classifies 403 as expired auth', () => {
    expect(classifyGatewayFailure({ statusCode: 403 })).toBe('auth_expired');
  });

  it('classifies 5xx as an upstream error', () => {
    expect(classifyGatewayFailure({ statusCode: 503 })).toBe('upstream_error');
  });

  it('classifies a missing status code as an upstream error', () => {
    expect(classifyGatewayFailure({})).toBe('upstream_error');
  });
});

describe('computeCooldownMs', () => {
  it('escalates across consecutive failures', () => {
    const first = computeCooldownMs({ consecutiveFailures: 1, reason: 'quota_exhausted' });
    const second = computeCooldownMs({ consecutiveFailures: 2, reason: 'quota_exhausted' });
    const third = computeCooldownMs({ consecutiveFailures: 3, reason: 'quota_exhausted' });

    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it('caps escalation so the gateway is retried eventually', () => {
    const capped = computeCooldownMs({ consecutiveFailures: 99, reason: 'quota_exhausted' });
    const alsoCapped = computeCooldownMs({ consecutiveFailures: 500, reason: 'quota_exhausted' });

    expect(capped).toBe(alsoCapped);
  });

  it('honors a retry-after hint when it exceeds the computed cooldown', () => {
    const cooldown = computeCooldownMs({
      consecutiveFailures: 1,
      reason: 'quota_exhausted',
      retryAfterMs: 300_000
    });

    expect(cooldown).toBe(300_000);
  });

  it('ignores a retry-after hint smaller than the computed cooldown', () => {
    const computed = computeCooldownMs({ consecutiveFailures: 3, reason: 'quota_exhausted' });
    const withHint = computeCooldownMs({
      consecutiveFailures: 3,
      reason: 'quota_exhausted',
      retryAfterMs: 1_000
    });

    expect(withHint).toBe(computed);
  });

  it('uses a long cooldown for expired auth because it needs operator action', () => {
    const authCooldown = computeCooldownMs({ consecutiveFailures: 1, reason: 'auth_expired' });
    const quotaCooldown = computeCooldownMs({ consecutiveFailures: 1, reason: 'quota_exhausted' });

    expect(authCooldown).toBe(AUTH_FAILURE_COOLDOWN_MS);
    expect(authCooldown).toBeGreaterThan(quotaCooldown);
  });
});

describe('nextCircuitStateOnFailure', () => {
  it('opens a closed circuit and records the resume time', () => {
    const next = nextCircuitStateOnFailure(CLOSED, { reason: 'quota_exhausted', now: NOW });

    expect(next.circuitState).toBe('open');
    expect(next.consecutiveFailures).toBe(1);
    expect(Date.parse(next.circuitResumeAfter as string)).toBeGreaterThan(NOW);
  });

  it('escalates the cooldown when an open circuit fails again', () => {
    const first = nextCircuitStateOnFailure(CLOSED, { reason: 'quota_exhausted', now: NOW });
    const second = nextCircuitStateOnFailure(first, { reason: 'quota_exhausted', now: NOW });

    expect(second.consecutiveFailures).toBe(2);
    expect(Date.parse(second.circuitResumeAfter as string)).toBeGreaterThan(
      Date.parse(first.circuitResumeAfter as string)
    );
  });

  it('reopens with a longer cooldown when a half-open probe fails', () => {
    const opened = nextCircuitStateOnFailure(CLOSED, { reason: 'quota_exhausted', now: NOW });
    const halfOpen = { ...opened, circuitState: 'half_open' as const };
    const reopened = nextCircuitStateOnFailure(halfOpen, { reason: 'quota_exhausted', now: NOW });

    expect(reopened.circuitState).toBe('open');
    expect(reopened.consecutiveFailures).toBe(2);
  });
});

describe('nextCircuitStateOnSuccess', () => {
  it('closes the circuit and clears the failure counter', () => {
    const opened = nextCircuitStateOnFailure(CLOSED, { reason: 'quota_exhausted', now: NOW });
    const closed = nextCircuitStateOnSuccess(opened);

    expect(closed.circuitState).toBe('closed');
    expect(closed.consecutiveFailures).toBe(0);
    expect(closed.circuitResumeAfter).toBeNull();
    expect(closed.circuitOpenedAt).toBeNull();
  });
});

describe('isCircuitAdmitting', () => {
  it('admits when closed', () => {
    expect(isCircuitAdmitting(CLOSED, NOW).admits).toBe(true);
  });

  it('blocks while open and before the resume time', () => {
    const opened = nextCircuitStateOnFailure(CLOSED, { reason: 'quota_exhausted', now: NOW });
    const decision = isCircuitAdmitting(opened, NOW + 1_000);

    expect(decision.admits).toBe(false);
    expect(decision.nextState).toBe('open');
  });

  it('moves to half-open once the resume time has passed', () => {
    const opened = nextCircuitStateOnFailure(CLOSED, { reason: 'quota_exhausted', now: NOW });
    const resumeAt = Date.parse(opened.circuitResumeAfter as string);
    const decision = isCircuitAdmitting(opened, resumeAt + 1);

    expect(decision.admits).toBe(true);
    expect(decision.nextState).toBe('half_open');
    expect(decision.isProbe).toBe(true);
  });

  it('admits exactly one probe while half-open', () => {
    const halfOpen = { ...CLOSED, circuitState: 'half_open' as const, consecutiveFailures: 1 };
    const decision = isCircuitAdmitting(halfOpen, NOW);

    expect(decision.admits).toBe(true);
    expect(decision.isProbe).toBe(true);
  });

  it('reports the remaining cooldown so callers can surface an ETA', () => {
    const opened = nextCircuitStateOnFailure(CLOSED, { reason: 'quota_exhausted', now: NOW });
    const decision = isCircuitAdmitting(opened, NOW + 1_000);

    expect(decision.retryAfterMs).toBeGreaterThan(0);
  });
});
