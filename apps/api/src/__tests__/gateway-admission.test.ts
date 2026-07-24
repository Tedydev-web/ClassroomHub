import { describe, expect, it } from 'vitest';
import { evaluateGatewayAdmission } from '@cio/core/services/agent/gateway-admission';
import { DEFAULT_GATEWAY_SETTINGS, normalizeGatewaySettings } from '@cio/core/services/agent/gateway-settings';

const NOW = Date.parse('2026-07-23T10:00:00.000Z');

const LIMITS = {
  priorityWeight: 1,
  maxActiveRuns: 1,
  maxQueuedRuns: 3,
  windowBudgetUnits: 10_000,
  isBlocked: false,
  blockReason: null
};

function settings(overrides: Partial<typeof DEFAULT_GATEWAY_SETTINGS> = {}) {
  return normalizeGatewaySettings({
    ...DEFAULT_GATEWAY_SETTINGS,
    enabled: true,
    windows: [
      { id: 'short', durationMinutes: 300, capUnits: 50_000 },
      { id: 'weekly', durationMinutes: 10_080, capUnits: 500_000 }
    ],
    ...overrides
  } as never);
}

function baseParams() {
  return {
    settings: settings(),
    limits: LIMITS,
    activeRuns: 0,
    queuedRuns: 0,
    orgWindowUnits: 0,
    globalWindowUnits: { short: 0, weekly: 0 } as Record<string, number>,
    hasFallback: true,
    now: NOW
  };
}

describe('evaluateGatewayAdmission', () => {
  it('admits when nothing is constrained', () => {
    const result = evaluateGatewayAdmission(baseParams());

    expect(result.admitted).toBe(true);
  });

  it('admits on fallback when the gateway is paused', () => {
    const result = evaluateGatewayAdmission({
      ...baseParams(),
      settings: settings({ pausedAt: '2026-07-23T09:00:00.000Z', pauseReason: 'quota drill' })
    });

    expect(result.admitted).toBe(true);
    expect(result.viaFallback).toBe(true);
  });

  it('rejects when the gateway is paused and no fallback exists', () => {
    const result = evaluateGatewayAdmission({
      ...baseParams(),
      settings: settings({ pausedAt: '2026-07-23T09:00:00.000Z', pauseReason: 'quota drill' }),
      hasFallback: false
    });

    expect(result.admitted).toBe(false);
    expect(result.reason).toBe('gateway_paused');
    expect(result.detail).toContain('quota drill');
  });

  it('rejects a blocked org even when capacity is free', () => {
    const result = evaluateGatewayAdmission({
      ...baseParams(),
      limits: { ...LIMITS, isBlocked: true, blockReason: 'abuse investigation' }
    });

    expect(result.admitted).toBe(false);
    expect(result.reason).toBe('org_blocked');
    expect(result.detail).toContain('abuse investigation');
  });

  it('rejects when the org already has its maximum active runs', () => {
    const result = evaluateGatewayAdmission({ ...baseParams(), activeRuns: 1 });

    expect(result.admitted).toBe(false);
    expect(result.reason).toBe('org_active_limit');
  });

  it('rejects when the org queue is full', () => {
    const result = evaluateGatewayAdmission({ ...baseParams(), queuedRuns: 3 });

    expect(result.admitted).toBe(false);
    expect(result.reason).toBe('org_queue_limit');
  });

  it('rejects when the org has exhausted its window budget', () => {
    const result = evaluateGatewayAdmission({ ...baseParams(), orgWindowUnits: 10_000 });

    expect(result.admitted).toBe(false);
    expect(result.reason).toBe('org_budget_exceeded');
  });

  it('admits when the org has budget left', () => {
    const result = evaluateGatewayAdmission({ ...baseParams(), orgWindowUnits: 9_999 });

    expect(result.admitted).toBe(true);
  });

  it('ignores the org budget when none is configured', () => {
    const result = evaluateGatewayAdmission({
      ...baseParams(),
      limits: { ...LIMITS, windowBudgetUnits: null },
      orgWindowUnits: 10_000_000
    });

    expect(result.admitted).toBe(true);
  });

  it('rejects when any single window is over its global cap', () => {
    // Every configured window must pass — the subscription enforces more than one.
    const result = evaluateGatewayAdmission({
      ...baseParams(),
      globalWindowUnits: { short: 50_000, weekly: 0 }
    });

    expect(result.admitted).toBe(false);
    expect(result.reason).toBe('global_window_exhausted');
    expect(result.detail).toContain('short');
  });

  it('admits when every window is under its cap', () => {
    const result = evaluateGatewayAdmission({
      ...baseParams(),
      globalWindowUnits: { short: 49_999, weekly: 499_999 }
    });

    expect(result.admitted).toBe(true);
  });

  it('falls back rather than rejecting when a window is exhausted but fallback exists', () => {
    const result = evaluateGatewayAdmission({
      ...baseParams(),
      globalWindowUnits: { short: 50_000, weekly: 0 },
      hasFallback: true,
      allowFallbackOnWindowExhaustion: true
    });

    expect(result.admitted).toBe(true);
    expect(result.viaFallback).toBe(true);
  });

  it('checks org blocking before consuming capacity signals', () => {
    // Cheapest and most decisive check first: a blocked org should never even be
    // measured against window budgets.
    const result = evaluateGatewayAdmission({
      ...baseParams(),
      limits: { ...LIMITS, isBlocked: true, blockReason: 'blocked' },
      activeRuns: 99,
      orgWindowUnits: 999_999
    });

    expect(result.reason).toBe('org_blocked');
  });
});
