import { describe, expect, it } from 'vitest';
import type { GatewayUsageSummary, TokenBalance } from '@cio/ai-assistant';

import { DEFAULT_GATEWAY_SETTINGS, selectBudgetWindow } from '@cio/core/services/agent/gateway-settings';

/**
 * The teacher-facing meter shows progress against this workspace's slice of the
 * shared subscription. Two things have to hold:
 *
 *  - the denominator is the org's own budget, never the shared pool or the
 *    unbounded plan allowance (which renders 0% forever);
 *  - the window the bar measures is the same one admission control enforces,
 *    otherwise a teacher watches a half-full bar while their run is rejected.
 */

/** Mirrors the meter's branch order in `chat-header.svelte`. */
type MeterKind = 'gateway' | 'bare_count' | 'plan_fraction' | 'hidden';

function selectMeter(params: {
  isStudent: boolean;
  gatewayUsage: GatewayUsageSummary | null;
  tokenUsage: TokenBalance | null;
}): MeterKind {
  if (params.isStudent) return 'hidden';
  if (params.gatewayUsage) return 'gateway';
  if (params.tokenUsage?.isUnlimited) return 'bare_count';
  if (params.tokenUsage && params.tokenUsage.used + params.tokenUsage.remaining > 0) return 'plan_fraction';

  return 'hidden';
}

/** Mirrors `toPercent` in `chat-header.svelte`. */
function toPercent(used: number, total: number): number {
  if (total <= 0) return 0;

  return Math.min(100, Math.round((used / total) * 100));
}

const unlimitedPlan: TokenBalance = {
  used: 966_127,
  allowance: Number.MAX_SAFE_INTEGER,
  creditBalance: 0,
  remaining: Number.MAX_SAFE_INTEGER - 966_127,
  isUnlimited: true
};

describe('gateway capacity meter', () => {
  it('prefers the org capacity bar over the unbounded plan allowance', () => {
    const gatewayUsage: GatewayUsageSummary = {
      usedUnits: 966_127,
      budgetUnits: 40_000_000,
      windowMinutes: 10_080
    };

    expect(selectMeter({ isStudent: false, gatewayUsage, tokenUsage: unlimitedPlan })).toBe('gateway');
    // The same usage that read 0% against the sentinel now reads a real number.
    expect(toPercent(gatewayUsage.usedUnits, gatewayUsage.budgetUnits)).toBe(2);
  });

  it('falls back to a bare count when no budget is configured', () => {
    expect(selectMeter({ isStudent: false, gatewayUsage: null, tokenUsage: unlimitedPlan })).toBe('bare_count');
  });

  it('leaves the bounded-plan fraction alone', () => {
    const bounded: TokenBalance = {
      used: 250_000,
      allowance: 500_000,
      creditBalance: 0,
      remaining: 250_000,
      isUnlimited: false
    };

    expect(selectMeter({ isStudent: false, gatewayUsage: null, tokenUsage: bounded })).toBe('plan_fraction');
    expect(toPercent(bounded.used, bounded.used + bounded.remaining)).toBe(50);
  });

  it('clamps an over-budget window to a full bar', () => {
    expect(toPercent(48_000_000, 40_000_000)).toBe(100);
  });

  it('renders empty rather than dividing by zero on a zero budget', () => {
    expect(toPercent(1_000, 0)).toBe(0);
  });

  it('never shows the capacity bar to students', () => {
    const gatewayUsage: GatewayUsageSummary = {
      usedUnits: 100,
      budgetUnits: 40_000_000,
      windowMinutes: 10_080
    };

    expect(selectMeter({ isStudent: true, gatewayUsage, tokenUsage: unlimitedPlan })).toBe('hidden');
  });

  it('reports the window in whole days for the hint', () => {
    const weekly = 10_080;

    expect(Math.max(1, Math.round(weekly / 1440))).toBe(7);
  });
});

describe('budget window selection', () => {
  it('returns null when no window is configured, so no bar is drawn', () => {
    expect(selectBudgetWindow(DEFAULT_GATEWAY_SETTINGS)).toBeNull();
  });

  it('uses the only window when the subscription exposes a single limit', () => {
    const window = selectBudgetWindow({
      ...DEFAULT_GATEWAY_SETTINGS,
      windows: [{ id: 'weekly', durationMinutes: 10_080, capUnits: 400_000_000 }]
    });

    expect(window).toEqual({ id: 'weekly', durationMinutes: 10_080, capUnits: 400_000_000 });
  });

  it('picks the tightest window so the meter matches what admission enforces', () => {
    const window = selectBudgetWindow({
      ...DEFAULT_GATEWAY_SETTINGS,
      windows: [
        { id: 'weekly', durationMinutes: 10_080, capUnits: 400_000_000 },
        { id: 'short', durationMinutes: 300, capUnits: 40_000_000 }
      ]
    });

    expect(window?.id).toBe('short');
  });
});
