import { describe, expect, it } from 'vitest';

import {
  formatPercent,
  getExerciseQuestionProgress,
  getTakeItemPoints,
  getTakeItemTotalPossibleGrade,
  getTotalPossibleGrade,
  hasMeaningfulCanonicalResponse,
  isRequiredTakeItem,
  normalizeAnswerValue,
  type TakeAnswers,
  type TakeItem
} from './take-progress';

/** A canonical item with one interaction worth `maxScore`, required unless told otherwise. */
function canonicalItem(id: string, maxScore: number, required = true): TakeItem {
  return {
    kind: 'canonical',
    id,
    question: { id } as never,
    definition: {
      blocks: [{ kind: 'interaction', interaction: { maxScore, required } }]
    } as never,
    revisionId: null
  };
}

const noAnswers: TakeAnswers = { answers: {}, canonicalAnswers: {} };

describe('normalizeAnswerValue', () => {
  it('keeps the previous answer when the next value is not an answer envelope', () => {
    const previous = { type: 'text', value: 'kept' } as never;

    expect(normalizeAnswerValue(previous, undefined)).toBe(previous);
    expect(normalizeAnswerValue(previous, 'not an envelope' as never)).toBe(previous);
    expect(normalizeAnswerValue(previous, {} as never)).toBe(previous);
  });

  it('takes the next answer once it carries a type', () => {
    const previous = { type: 'text', value: 'old' } as never;
    const next = { type: 'text', value: 'new' } as never;

    expect(normalizeAnswerValue(previous, next)).toBe(next);
  });
});

describe('hasMeaningfulCanonicalResponse', () => {
  it('is false for a missing response and for one with no entries', () => {
    expect(hasMeaningfulCanonicalResponse(undefined)).toBe(false);
    expect(hasMeaningfulCanonicalResponse({ responses: [] } as never)).toBe(false);
  });

  it('is true once there is at least one response', () => {
    expect(hasMeaningfulCanonicalResponse({ responses: [{}] } as never)).toBe(true);
  });
});

describe('points', () => {
  it('sums a legacy question list, treating a missing score as zero', () => {
    expect(getTotalPossibleGrade([{ points: 3 }, { points: null }, {}] as never)).toBe(3);
  });

  it('sums only the interaction blocks of a canonical item', () => {
    const item = canonicalItem('a', 4);
    (item as { definition: { blocks: unknown[] } }).definition.blocks.push({ kind: 'content' });

    expect(getTakeItemPoints(item)).toBe(4);
  });

  it('totals a mixed take', () => {
    const items: TakeItem[] = [
      { kind: 'legacy', id: 'l1', question: { id: 'l1', points: 2 } as never },
      canonicalItem('c1', 5)
    ];

    expect(getTakeItemTotalPossibleGrade(items)).toBe(7);
  });
});

describe('isRequiredTakeItem', () => {
  it('follows the interaction flag for a canonical item', () => {
    expect(isRequiredTakeItem(canonicalItem('c1', 1, true))).toBe(true);
    expect(isRequiredTakeItem(canonicalItem('c2', 1, false))).toBe(false);
  });
});

describe('getExerciseQuestionProgress', () => {
  it('counts an unanswered legacy question as zero of one', () => {
    const items: TakeItem[] = [{ kind: 'legacy', id: 'l1', question: { id: 'l1' } as never }];

    expect(getExerciseQuestionProgress(items, noAnswers)).toEqual({ answered: 0, total: 1 });
  });

  it('returns zero of zero for an empty take rather than dividing by nothing', () => {
    expect(getExerciseQuestionProgress([], noAnswers)).toEqual({ answered: 0, total: 0 });
  });
});

describe('formatPercent', () => {
  it('keeps at most one fraction digit', () => {
    expect(formatPercent(66.666)).toBe(new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(66.666));
    expect(formatPercent(50)).toBe('50');
  });
});
