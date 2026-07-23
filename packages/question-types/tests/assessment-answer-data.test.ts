import { describe, expect, it } from 'vitest';

import { hasMeaningfulAnswerData, type AssessmentItemAnswerData } from '../src';

describe('ASSESSMENT_ITEM answer data', () => {
  it('treats a canonical response envelope as meaningful only when it contains a response', () => {
    const answered: AssessmentItemAnswerData = {
      type: 'ASSESSMENT_ITEM',
      response: {
        schemaVersion: 1,
        responses: [{ interactionId: 'choice-1', response: { kind: 'choice', selectedOptionIds: ['option-1'] } }]
      }
    };
    const empty: AssessmentItemAnswerData = {
      type: 'ASSESSMENT_ITEM',
      response: { schemaVersion: 1, responses: [] }
    };

    expect(hasMeaningfulAnswerData(answered)).toBe(true);
    expect(hasMeaningfulAnswerData(empty)).toBe(false);
  });
});
