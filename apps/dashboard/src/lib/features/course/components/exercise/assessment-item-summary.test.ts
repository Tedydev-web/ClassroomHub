import { describe, expect, it } from 'vitest';

import { countAssessmentQuestions, countSectionQuestions } from './assessment-item-summary';

const passageWithBlanks = {
  definition: {
    blocks: [
      { kind: 'content' },
      { kind: 'interaction' },
      { kind: 'interaction' },
      { kind: 'interaction' },
      { kind: 'interaction' },
      { kind: 'interaction' },
      { kind: 'interaction' }
    ]
  }
};

describe('counting the questions a composite item asks', () => {
  /**
   * The shape an imported exam paper actually produces: one item titled "1-6" holding a
   * passage and six blanks. Counted as a row it is one question, which is how a
   * forty-question paper came to report itself as ten.
   */
  it('counts the interactions inside a passage item, not the item', () => {
    expect(countAssessmentQuestions(passageWithBlanks)).toBe(6);
  });

  it('counts a single-question item as one', () => {
    expect(countAssessmentQuestions({ definition: { blocks: [{ kind: 'interaction' }] } })).toBe(1);
  });

  it('counts an item with no interaction as one, never zero', () => {
    // Still one thing a learner is shown; reporting zero would hide the row from its own count.
    expect(countAssessmentQuestions({ definition: { blocks: [{ kind: 'content' }] } })).toBe(1);
    expect(countAssessmentQuestions({ definition: null })).toBe(1);
    expect(countAssessmentQuestions({})).toBe(1);
  });
});

describe('counting the questions a section asks', () => {
  it('adds the legacy questions to what the composite items hold', () => {
    // The six sections of the imported paper carry one item each and read "from 1 to 6",
    // "from 17 to 26" — headings the row count has to agree with.
    expect(countSectionQuestions(0, [passageWithBlanks])).toBe(6);
    expect(countSectionQuestions(2, [passageWithBlanks, { definition: { blocks: [{ kind: 'interaction' }] } }])).toBe(
      9
    );
  });

  it('is the legacy count when a section has no composite items', () => {
    expect(countSectionQuestions(3, [])).toBe(3);
  });
});
