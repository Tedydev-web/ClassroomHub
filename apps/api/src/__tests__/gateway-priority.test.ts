import { describe, expect, it } from 'vitest';
import {
  BULLMQ_MAX_PRIORITY,
  computeQueuePriority,
  compareByVirtualTime
} from '@cio/core/services/agent/gateway-priority';

describe('computeQueuePriority', () => {
  it('gives an org with no consumption the best possible priority', () => {
    expect(computeQueuePriority({ consumedUnits: 0, priorityWeight: 1 })).toBe(1);
  });

  it('gives equal priority to equal consumption at equal weight', () => {
    const a = computeQueuePriority({ consumedUnits: 10_000, priorityWeight: 1 });
    const b = computeQueuePriority({ consumedUnits: 10_000, priorityWeight: 1 });

    expect(a).toBe(b);
  });

  it('ranks a heavier consumer later', () => {
    // BullMQ semantics: a numerically larger priority is served later.
    const light = computeQueuePriority({ consumedUnits: 1_000, priorityWeight: 1 });
    const heavy = computeQueuePriority({ consumedUnits: 100_000, priorityWeight: 1 });

    expect(heavy).toBeGreaterThan(light);
  });

  it('lets a higher weight earn earlier turns at equal consumption', () => {
    const standard = computeQueuePriority({ consumedUnits: 100_000, priorityWeight: 1 });
    const privileged = computeQueuePriority({ consumedUnits: 100_000, priorityWeight: 3 });

    expect(privileged).toBeLessThan(standard);
  });

  it('makes a weight-3 org roughly three times cheaper per unit consumed', () => {
    const weightOne = computeQueuePriority({ consumedUnits: 300_000, priorityWeight: 1 });
    const weightThree = computeQueuePriority({ consumedUnits: 300_000, priorityWeight: 3 });
    const weightOneAtThird = computeQueuePriority({ consumedUnits: 100_000, priorityWeight: 1 });

    expect(weightThree).toBe(weightOneAtThird);
    expect(weightOne).toBeGreaterThan(weightThree);
  });

  it('clamps to the BullMQ maximum instead of overflowing', () => {
    const priority = computeQueuePriority({ consumedUnits: Number.MAX_SAFE_INTEGER, priorityWeight: 1 });

    expect(priority).toBeLessThanOrEqual(BULLMQ_MAX_PRIORITY);
    expect(Number.isInteger(priority)).toBe(true);
  });

  it('never returns a priority below the BullMQ minimum of one', () => {
    expect(computeQueuePriority({ consumedUnits: -50, priorityWeight: 1 })).toBeGreaterThanOrEqual(1);
  });

  it('treats a zero weight as one rather than dividing by zero', () => {
    const zeroWeight = computeQueuePriority({ consumedUnits: 10_000, priorityWeight: 0 });
    const oneWeight = computeQueuePriority({ consumedUnits: 10_000, priorityWeight: 1 });

    expect(Number.isFinite(zeroWeight)).toBe(true);
    expect(zeroWeight).toBe(oneWeight);
  });

  it('treats a negative weight as one', () => {
    const negative = computeQueuePriority({ consumedUnits: 10_000, priorityWeight: -5 });
    const oneWeight = computeQueuePriority({ consumedUnits: 10_000, priorityWeight: 1 });

    expect(negative).toBe(oneWeight);
  });
});

describe('compareByVirtualTime', () => {
  it('orders the least-served org first', () => {
    const orgs = [
      { orgId: 'heavy', consumedUnits: 100_000, priorityWeight: 1 },
      { orgId: 'light', consumedUnits: 1_000, priorityWeight: 1 }
    ];

    expect([...orgs].sort(compareByVirtualTime).map((o) => o.orgId)).toEqual(['light', 'heavy']);
  });

  it('lets weight pull a heavier consumer ahead', () => {
    const orgs = [
      { orgId: 'unweighted', consumedUnits: 50_000, priorityWeight: 1 },
      { orgId: 'weighted', consumedUnits: 90_000, priorityWeight: 3 }
    ];

    expect([...orgs].sort(compareByVirtualTime).map((o) => o.orgId)).toEqual(['weighted', 'unweighted']);
  });
});
