import { describe, expect, it } from 'vitest';
import type { TokenBalance } from '@cio/ai-assistant';

/**
 * The usage meter renders a used/total fraction. On a deployment with no plan
 * ceiling the allowance is a sentinel (`Number.MAX_SAFE_INTEGER`), so that
 * fraction reads 0% forever and implies a budget that does not exist — which is
 * exactly what a teacher reported seeing.
 *
 * These lock the contract the UI branches on.
 */

/** Mirrors the meter's decision in `chat-header.svelte`. */
function shouldRenderFraction(balance: TokenBalance): boolean {
  if (balance.isUnlimited) return false;

  return balance.used + balance.remaining > 0;
}

function renderedPercent(balance: TokenBalance): number {
  const total = balance.used + balance.remaining;

  return Math.min(100, Math.round((balance.used / total) * 100));
}

describe('token balance display contract', () => {
  it('suppresses the fraction when the allowance is unbounded', () => {
    const balance: TokenBalance = {
      used: 966_127,
      allowance: Number.MAX_SAFE_INTEGER,
      creditBalance: 0,
      remaining: Number.MAX_SAFE_INTEGER - 966_127,
      isUnlimited: true
    };

    expect(shouldRenderFraction(balance)).toBe(false);
  });

  it('shows why the fraction was wrong: real usage still renders as 0%', () => {
    const balance: TokenBalance = {
      used: 966_127,
      allowance: Number.MAX_SAFE_INTEGER,
      creditBalance: 0,
      remaining: Number.MAX_SAFE_INTEGER - 966_127,
      isUnlimited: true
    };

    // Nearly a million tokens spent, and the bar would still read empty.
    expect(renderedPercent(balance)).toBe(0);
  });

  it('still renders the fraction on a bounded plan', () => {
    const balance: TokenBalance = {
      used: 250_000,
      allowance: 500_000,
      creditBalance: 0,
      remaining: 250_000,
      isUnlimited: false
    };

    expect(shouldRenderFraction(balance)).toBe(true);
    expect(renderedPercent(balance)).toBe(50);
  });

  it('counts purchased credits toward the bounded total', () => {
    const balance: TokenBalance = {
      used: 500_000,
      allowance: 500_000,
      creditBalance: 500_000,
      remaining: 500_000,
      isUnlimited: false
    };

    expect(shouldRenderFraction(balance)).toBe(true);
    expect(renderedPercent(balance)).toBe(50);
  });

  it('hides the meter entirely when nothing is configured or used', () => {
    const balance: TokenBalance = {
      used: 0,
      allowance: 0,
      creditBalance: 0,
      remaining: 0,
      isUnlimited: false
    };

    expect(shouldRenderFraction(balance)).toBe(false);
  });

  it('treats an exhausted bounded plan as fully consumed', () => {
    const balance: TokenBalance = {
      used: 500_000,
      allowance: 500_000,
      creditBalance: 0,
      remaining: 0,
      isUnlimited: false
    };

    expect(renderedPercent(balance)).toBe(100);
  });
});
