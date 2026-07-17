import { describe, expect, it } from 'vitest';
import { canonicalizeAssessmentItemDefinition } from '../src/assessment';
import type { AssessmentItemDefinition } from '../src/assessment';
import { buildHybridDefinition } from './fixtures/assessment/definition-builders';
import { LEGACY_GOLDEN_CASES } from './fixtures/assessment/legacy-golden';

/** Rebuilds an object with reversed key insertion order, recursively. */
function withReversedKeyOrder<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => withReversedKeyOrder(entry)) as T;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).reverse();
    const rebuilt: Record<string, unknown> = {};
    for (const [key, entryValue] of entries) {
      rebuilt[key] = withReversedKeyOrder(entryValue);
    }
    return rebuilt as T;
  }
  return value;
}

describe('canonicalizeAssessmentItemDefinition', () => {
  it('is invariant to object key insertion order', () => {
    const definition = buildHybridDefinition();
    const reordered = withReversedKeyOrder(definition);

    expect(canonicalizeAssessmentItemDefinition(reordered)).toBe(canonicalizeAssessmentItemDefinition(definition));
  });

  it('preserves array order (blocks are order-significant)', () => {
    const definition = buildHybridDefinition();
    const swapped: AssessmentItemDefinition = {
      ...definition,
      blocks: [...definition.blocks].reverse()
    };

    expect(canonicalizeAssessmentItemDefinition(swapped)).not.toBe(canonicalizeAssessmentItemDefinition(definition));
  });

  it('round-trips through JSON.parse to a deep-equal value', () => {
    const definition = buildHybridDefinition();
    const canonical = canonicalizeAssessmentItemDefinition(definition);

    expect(JSON.parse(canonical)).toEqual(definition);
  });

  it('is stable across golden adapter fixtures', () => {
    for (const goldenCase of LEGACY_GOLDEN_CASES) {
      const first = canonicalizeAssessmentItemDefinition(goldenCase.expected);
      const second = canonicalizeAssessmentItemDefinition(withReversedKeyOrder(goldenCase.expected));

      expect(first, goldenCase.name).toBe(second);
    }
  });
});
