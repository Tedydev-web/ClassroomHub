import { describe, expect, it } from 'vitest';
import {
  legacyQuestionToAssessmentItem,
  parseAssessmentItemDefinition,
  validateAssessmentItemForPublish
} from '../src/assessment';
import type { AssessmentItemDefinition } from '../src/assessment';
import { buildChoiceInteraction, buildDefinition, interactionBlock } from './fixtures/assessment/definition-builders';

function expectPublishViolation(definition: AssessmentItemDefinition, pathFragment: string): void {
  const result = validateAssessmentItemForPublish(definition);
  expect(result.success).toBe(false);
  if (result.success) return;

  expect(result.issues.every((issue) => issue.code === 'PUBLISH_RULE_VIOLATION')).toBe(true);
  expect(result.issues.some((issue) => issue.path.join('.').includes(pathFragment))).toBe(true);
}

describe('validateAssessmentItemForPublish', () => {
  it('accepts a well-formed authorable definition', () => {
    const result = validateAssessmentItemForPublish(buildDefinition());
    expect(result.success).toBe(true);
  });

  it('rejects choice interactions with fewer than two options or no correct option', () => {
    const oneOption = buildDefinition({
      blocks: [
        interactionBlock(
          'i1',
          buildChoiceInteraction({
            config: {
              cardinality: 'single',
              presentation: 'list',
              options: [{ id: 'a', html: 'A' }],
              correctOptionIds: ['a']
            }
          })
        )
      ]
    });
    const noCorrect = buildDefinition({
      blocks: [
        interactionBlock(
          'i1',
          buildChoiceInteraction({
            config: {
              cardinality: 'single',
              presentation: 'list',
              options: [
                { id: 'a', html: 'A' },
                { id: 'b', html: 'B' }
              ],
              correctOptionIds: []
            }
          })
        )
      ]
    });

    expectPublishViolation(oneOption, 'options');
    expectPublishViolation(noCorrect, 'correctOptionIds');
  });

  it('rejects single-cardinality choice with multiple correct options', () => {
    const multiCorrectSingle = buildDefinition({
      blocks: [
        interactionBlock(
          'i1',
          buildChoiceInteraction({
            config: {
              cardinality: 'single',
              presentation: 'list',
              options: [
                { id: 'a', html: 'A' },
                { id: 'b', html: 'B' }
              ],
              correctOptionIds: ['a', 'b']
            }
          })
        )
      ]
    });

    expectPublishViolation(multiCorrectSingle, 'correctOptionIds');
  });

  it('rejects true_false presentation whose option ids are not exactly true/false', () => {
    const wrongIds = buildDefinition({
      blocks: [
        interactionBlock(
          'i1',
          buildChoiceInteraction({
            config: {
              cardinality: 'single',
              presentation: 'true_false',
              options: [
                { id: 'yes', html: 'Yes' },
                { id: 'no', html: 'No' }
              ],
              correctOptionIds: ['yes']
            }
          })
        )
      ]
    });

    expectPublishViolation(wrongIds, 'options');
  });

  it('rejects numeric and star interactions without an answer key', () => {
    const numericNoKey = buildDefinition({
      blocks: [
        interactionBlock('i1', {
          kind: 'numeric',
          prompt: { format: 'html', html: 'Number' },
          required: true,
          maxScore: 1,
          config: { correctValue: null, tolerance: 0 }
        })
      ]
    });
    const starNoKey = buildDefinition({
      blocks: [
        interactionBlock('i1', {
          kind: 'star_rating',
          prompt: { format: 'html', html: 'Rate' },
          required: true,
          maxScore: 1,
          config: { maxStars: 5, correctValue: null }
        })
      ]
    });

    expectPublishViolation(numericNoKey, 'correctValue');
    expectPublishViolation(starNoKey, 'correctValue');
  });

  it('rejects fill_blank without accepted answers and word_bank template/answer mismatches', () => {
    const emptyFillBlank = buildDefinition({
      blocks: [
        interactionBlock('i1', {
          kind: 'fill_blank',
          prompt: { format: 'html', html: 'Fill' },
          required: true,
          maxScore: 1,
          config: { acceptedAnswers: [] }
        })
      ]
    });
    const templateWithoutBlanks = buildDefinition({
      blocks: [
        interactionBlock('i1', {
          kind: 'word_bank',
          prompt: { format: 'html', html: 'Complete' },
          required: true,
          maxScore: 1,
          config: { template: 'No blanks here', correctAnswers: ['cat'], distractors: [] }
        })
      ]
    });
    const missingAnswers = buildDefinition({
      blocks: [
        interactionBlock('i1', {
          kind: 'word_bank',
          prompt: { format: 'html', html: 'Complete' },
          required: true,
          maxScore: 1,
          config: { template: 'The ___ and the ___', correctAnswers: ['cat'], distractors: [] }
        })
      ]
    });

    expectPublishViolation(emptyFillBlank, 'acceptedAnswers');
    expectPublishViolation(templateWithoutBlanks, 'template');
    expectPublishViolation(missingAnswers, 'correctAnswers');
  });

  it('rejects ordering that is not a permutation or has fewer than two options', () => {
    const notPermutation = buildDefinition({
      blocks: [
        interactionBlock('i1', {
          kind: 'ordering',
          prompt: { format: 'html', html: 'Order' },
          required: true,
          maxScore: 1,
          config: {
            options: [
              { id: 'a', html: 'A' },
              { id: 'b', html: 'B' }
            ],
            correctOrder: ['a', 'ghost']
          }
        })
      ]
    });
    const oneOption = buildDefinition({
      blocks: [
        interactionBlock('i1', {
          kind: 'ordering',
          prompt: { format: 'html', html: 'Order' },
          required: true,
          maxScore: 1,
          config: { options: [{ id: 'a', html: 'A' }], correctOrder: ['a'] }
        })
      ]
    });

    expectPublishViolation(notPermutation, 'correctOrder');
    expectPublishViolation(oneOption, 'options');
  });

  it('degenerate legacy adapter output parses structurally but fails the publish gate', () => {
    const degenerateRadio = legacyQuestionToAssessmentItem({
      id: 99,
      title: 'Broken radio with no options',
      questionType: 'RADIO',
      points: 5,
      options: [],
      settings: {}
    });

    expect(degenerateRadio.success).toBe(true);
    if (!degenerateRadio.success) return;

    expect(parseAssessmentItemDefinition(degenerateRadio.data).success).toBe(true);
    expect(validateAssessmentItemForPublish(degenerateRadio.data).success).toBe(false);
  });
});
