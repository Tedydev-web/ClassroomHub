import { describe, expect, it } from 'vitest';
import { QUESTION_TYPE_IDS, QUESTION_TYPE_KEY } from '@cio/question-types';
import { DEFAULT_QUESTION_TYPE, QUESTION_TYPES } from './constants';

describe('question picker QUESTION_TYPES', () => {
  it('offers exactly the 14 enabled question types', () => {
    expect(QUESTION_TYPES).toHaveLength(14);
  });

  it('never offers internal or disabled registry entries', () => {
    const offeredIds = new Set(QUESTION_TYPES.map((questionType) => questionType.id));

    expect(offeredIds.has(QUESTION_TYPE_IDS[QUESTION_TYPE_KEY.ASSESSMENT_ITEM])).toBe(false);
    expect(offeredIds.has(QUESTION_TYPE_IDS[QUESTION_TYPE_KEY.MATCHING])).toBe(false);
    expect(offeredIds.has(QUESTION_TYPE_IDS[QUESTION_TYPE_KEY.HOTSPOT])).toBe(false);
  });

  it('gives every offered type a translation label key', () => {
    for (const questionType of QUESTION_TYPES) {
      expect(questionType.labelKey, `missing labelKey for ${questionType.key}`).toBeTruthy();
    }
  });

  it('defaults to RADIO', () => {
    expect(DEFAULT_QUESTION_TYPE.key).toBe(QUESTION_TYPE_KEY.RADIO);
  });
});
