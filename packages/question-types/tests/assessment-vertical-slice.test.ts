import { describe, expect, it } from 'vitest';

import {
  getAssessmentVerticalSliceResponseProgress,
  getUnsupportedAssessmentVerticalSliceInteractionKinds,
  isAssessmentVerticalSliceResponseComplete,
  scoreAssessmentVerticalSlice,
  scoreTrueFalseGroupInteraction,
  toAssessmentDeliveryDefinition,
  type AssessmentInteraction,
  type AssessmentDeliveryDefinition,
  validateAssessmentResponseEnvelope
} from '../src/assessment';

const definition = {
  schemaVersion: 1 as const,
  blocks: [
    {
      id: 'choice-1',
      kind: 'interaction' as const,
      interaction: {
        kind: 'choice' as const,
        prompt: { format: 'html' as const, html: '<p>Pick one.</p>' },
        required: true,
        maxScore: 2,
        config: {
          cardinality: 'single' as const,
          presentation: 'list' as const,
          options: [
            { id: 'a', html: '<p>A</p>' },
            { id: 'b', html: '<p>B</p>' }
          ],
          correctOptionIds: ['b']
        }
      }
    },
    {
      id: 'text-1',
      kind: 'interaction' as const,
      interaction: {
        kind: 'text' as const,
        prompt: { format: 'html' as const, html: '<p>Explain why.</p>' },
        required: true,
        maxScore: 3,
        config: { format: 'plain' as const }
      }
    }
  ],
  feedback: []
};

const trueFalseGroupInteraction: Extract<AssessmentInteraction, { kind: 'true_false_group' }> = {
  kind: 'true_false_group',
  prompt: { format: 'html', html: '<p>Mark each statement.</p>' },
  required: true,
  maxScore: 1,
  config: {
    statements: [
      { id: 's1', html: '<p>Statement 1</p>', correctValue: true },
      { id: 's2', html: '<p>Statement 2</p>', correctValue: false },
      { id: 's3', html: '<p>Statement 3</p>', correctValue: true },
      { id: 's4', html: '<p>Statement 4</p>', correctValue: false }
    ],
    scoring: { mode: 'tiered', tiers: [0, 0.1, 0.25, 0.5, 1] }
  }
};

describe('assessment vertical slice', () => {
  it('scores choice automatically and leaves extended text for manual grading', () => {
    const validation = validateAssessmentResponseEnvelope(definition, {
      schemaVersion: 1,
      responses: [
        { interactionId: 'choice-1', response: { kind: 'choice', selectedOptionIds: ['b'] } },
        { interactionId: 'text-1', response: { kind: 'text', text: 'Because the specification requires it.' } }
      ]
    });

    expect(validation.success).toBe(true);
    if (!validation.success) return;

    expect(scoreAssessmentVerticalSlice(definition, validation.data)).toEqual({
      autoScore: 2,
      manualMaxScore: 3,
      interactionScores: [
        { interactionId: 'choice-1', score: 2, maxScore: 2, grading: 'auto' },
        { interactionId: 'text-1', score: null, maxScore: 3, grading: 'manual' }
      ]
    });
  });

  it('uses all-or-nothing scoring for multi-select until response mapping is introduced', () => {
    const multipleChoiceDefinition = {
      ...definition,
      blocks: [
        {
          ...definition.blocks[0],
          interaction: {
            ...definition.blocks[0].interaction,
            config: {
              ...definition.blocks[0].interaction.config,
              cardinality: 'multiple' as const,
              correctOptionIds: ['a', 'b']
            }
          }
        }
      ]
    };
    const validation = validateAssessmentResponseEnvelope(multipleChoiceDefinition, {
      schemaVersion: 1,
      responses: [{ interactionId: 'choice-1', response: { kind: 'choice', selectedOptionIds: ['a'] } }]
    });

    expect(validation.success).toBe(true);
    if (!validation.success) return;

    expect(scoreAssessmentVerticalSlice(multipleChoiceDefinition, validation.data).autoScore).toBe(0);
  });

  it('scores weighted choices by selected percentages and clamps penalties at zero', () => {
    const weightedDefinition = {
      ...definition,
      blocks: [
        {
          ...definition.blocks[0],
          interaction: {
            ...definition.blocks[0].interaction,
            maxScore: 4,
            config: {
              ...definition.blocks[0].interaction.config,
              cardinality: 'multiple' as const,
              correctOptionIds: ['a', 'b'],
              scoreWeights: { a: 40, b: 60 }
            }
          }
        }
      ]
    };
    const partial = validateAssessmentResponseEnvelope(weightedDefinition, {
      schemaVersion: 1,
      responses: [{ interactionId: 'choice-1', response: { kind: 'choice', selectedOptionIds: ['a'] } }]
    });
    const penalizedDefinition = {
      ...weightedDefinition,
      blocks: [
        {
          ...weightedDefinition.blocks[0],
          interaction: {
            ...weightedDefinition.blocks[0].interaction,
            config: {
              ...weightedDefinition.blocks[0].interaction.config,
              correctOptionIds: ['b'],
              scoreWeights: { a: -50, b: 100 }
            }
          }
        }
      ]
    };
    const penalized = validateAssessmentResponseEnvelope(penalizedDefinition, {
      schemaVersion: 1,
      responses: [{ interactionId: 'choice-1', response: { kind: 'choice', selectedOptionIds: ['a'] } }]
    });

    expect(partial.success).toBe(true);
    if (!partial.success) return;
    expect(scoreAssessmentVerticalSlice(weightedDefinition, partial.data).autoScore).toBe(1.6);

    expect(penalized.success).toBe(true);
    if (!penalized.success) return;
    expect(scoreAssessmentVerticalSlice(penalizedDefinition, penalized.data).autoScore).toBe(0);
  });

  it('requires every required choice and extended-text response before navigation', () => {
    const deliveryDefinition = toAssessmentDeliveryDefinition(definition);
    const choiceOnlyResponse = {
      schemaVersion: 1 as const,
      responses: [{ interactionId: 'choice-1', response: { kind: 'choice' as const, selectedOptionIds: ['b'] } }]
    };
    const completeResponse = {
      schemaVersion: 1 as const,
      responses: [
        ...choiceOnlyResponse.responses,
        { interactionId: 'text-1', response: { kind: 'text' as const, text: '<p>Complete response</p>' } }
      ]
    };

    expect(isAssessmentVerticalSliceResponseComplete(deliveryDefinition, choiceOnlyResponse)).toBe(false);
    expect(isAssessmentVerticalSliceResponseComplete(deliveryDefinition, completeResponse)).toBe(true);
    expect(
      isAssessmentVerticalSliceResponseComplete(deliveryDefinition, {
        ...completeResponse,
        responses: [
          completeResponse.responses[0],
          { ...completeResponse.responses[1], response: { kind: 'text', text: '   ' } }
        ]
      })
    ).toBe(false);
  });

  it('requires every statement in a required true-false group before completion', () => {
    const deliveryDefinition = toAssessmentDeliveryDefinition({
      schemaVersion: 1,
      blocks: [{ id: 'group-1', kind: 'interaction', interaction: trueFalseGroupInteraction }],
      feedback: []
    });
    const partialResponse = {
      schemaVersion: 1 as const,
      responses: [
        {
          interactionId: 'group-1',
          response: {
            kind: 'true_false_group' as const,
            answers: [{ statementId: 's1', value: true }]
          }
        }
      ]
    };
    const completeResponse = {
      schemaVersion: 1 as const,
      responses: [
        {
          interactionId: 'group-1',
          response: {
            kind: 'true_false_group' as const,
            answers: trueFalseGroupInteraction.config.statements.map((statement) => ({
              statementId: statement.id,
              value: statement.correctValue
            }))
          }
        }
      ]
    };

    expect(isAssessmentVerticalSliceResponseComplete(deliveryDefinition, partialResponse)).toBe(false);
    expect(isAssessmentVerticalSliceResponseComplete(deliveryDefinition, completeResponse)).toBe(true);
  });

  it('allows an optional true-false group to be skipped but not partially completed', () => {
    const optionalInteraction = { ...trueFalseGroupInteraction, required: false };
    const deliveryDefinition = toAssessmentDeliveryDefinition({
      schemaVersion: 1,
      blocks: [{ id: 'group-1', kind: 'interaction', interaction: optionalInteraction }],
      feedback: []
    });
    const partialResponse = {
      schemaVersion: 1 as const,
      responses: [
        {
          interactionId: 'group-1',
          response: {
            kind: 'true_false_group' as const,
            answers: [{ statementId: 's1', value: true }]
          }
        }
      ]
    };
    const completeResponse = {
      schemaVersion: 1 as const,
      responses: [
        {
          interactionId: 'group-1',
          response: {
            kind: 'true_false_group' as const,
            answers: optionalInteraction.config.statements.map((statement) => ({
              statementId: statement.id,
              value: statement.correctValue
            }))
          }
        }
      ]
    };

    expect(isAssessmentVerticalSliceResponseComplete(deliveryDefinition, undefined)).toBe(true);
    expect(isAssessmentVerticalSliceResponseComplete(deliveryDefinition, partialResponse)).toBe(false);
    expect(isAssessmentVerticalSliceResponseComplete(deliveryDefinition, completeResponse)).toBe(true);
    expect(getAssessmentVerticalSliceResponseProgress(deliveryDefinition, undefined)).toEqual({
      answered: 0,
      total: 1
    });
  });

  it('counts answered interactions independently for grouped-question progress', () => {
    const deliveryDefinition = toAssessmentDeliveryDefinition(definition);

    expect(getAssessmentVerticalSliceResponseProgress(deliveryDefinition, undefined)).toEqual({
      answered: 0,
      total: 2
    });
    expect(
      getAssessmentVerticalSliceResponseProgress(deliveryDefinition, {
        schemaVersion: 1,
        responses: [{ interactionId: 'choice-1', response: { kind: 'choice', selectedOptionIds: ['b'] } }]
      })
    ).toEqual({ answered: 1, total: 2 });
    expect(
      getAssessmentVerticalSliceResponseProgress(deliveryDefinition, {
        schemaVersion: 1,
        responses: [
          { interactionId: 'choice-1', response: { kind: 'choice', selectedOptionIds: ['b'] } },
          { interactionId: 'text-1', response: { kind: 'text', text: '<p>Complete response</p>' } }
        ]
      })
    ).toEqual({ answered: 2, total: 2 });
  });

  it('allows an optional empty text response but rejects a structurally empty choice response', () => {
    const deliveryDefinition = toAssessmentDeliveryDefinition(definition);
    const optionalDeliveryDefinition: AssessmentDeliveryDefinition = {
      ...deliveryDefinition,
      blocks: deliveryDefinition.blocks.map((block) =>
        block.kind === 'interaction' ? { ...block, interaction: { ...block.interaction, required: false } } : block
      )
    };

    expect(isAssessmentVerticalSliceResponseComplete(optionalDeliveryDefinition, undefined)).toBe(true);
    expect(
      isAssessmentVerticalSliceResponseComplete(optionalDeliveryDefinition, {
        schemaVersion: 1,
        responses: [{ interactionId: 'text-1', response: { kind: 'text', text: '' } }]
      })
    ).toBe(true);
    expect(
      isAssessmentVerticalSliceResponseComplete(optionalDeliveryDefinition, {
        schemaVersion: 1,
        responses: [{ interactionId: 'choice-1', response: { kind: 'choice', selectedOptionIds: [] } }]
      })
    ).toBe(false);
  });

  it('rejects response entries that violate delivery semantics', () => {
    const deliveryDefinition = toAssessmentDeliveryDefinition({
      ...definition,
      blocks: definition.blocks.map((block) =>
        block.id === 'text-1'
          ? {
              ...block,
              interaction: {
                ...block.interaction,
                config: { ...block.interaction.config, minCharacters: 4, maxCharacters: 8 }
              }
            }
          : block
      )
    });
    const validTextResponse = { interactionId: 'text-1', response: { kind: 'text' as const, text: 'valid' } };

    for (const response of [
      {
        schemaVersion: 1 as const,
        responses: [
          { interactionId: 'choice-1', response: { kind: 'choice' as const, selectedOptionIds: ['ghost'] } },
          validTextResponse
        ]
      },
      {
        schemaVersion: 1 as const,
        responses: [
          { interactionId: 'choice-1', response: { kind: 'choice' as const, selectedOptionIds: ['a', 'b'] } },
          validTextResponse
        ]
      },
      {
        schemaVersion: 1 as const,
        responses: [
          { interactionId: 'choice-1', response: { kind: 'choice' as const, selectedOptionIds: ['a'] } },
          { interactionId: 'text-1', response: { kind: 'text' as const, text: 'no' } }
        ]
      },
      {
        schemaVersion: 1 as const,
        responses: [
          { interactionId: 'choice-1', response: { kind: 'choice' as const, selectedOptionIds: ['a'] } },
          validTextResponse,
          { interactionId: 'unknown', response: { kind: 'text' as const, text: 'valid' } }
        ]
      }
    ]) {
      expect(isAssessmentVerticalSliceResponseComplete(deliveryDefinition, response)).toBe(false);
    }
  });

  it('accepts numeric interactions once the canonical renderer and scorer are available', () => {
    const unsupportedDefinition = {
      ...definition,
      blocks: [
        ...definition.blocks,
        {
          id: 'numeric-1',
          kind: 'interaction' as const,
          interaction: {
            kind: 'numeric' as const,
            prompt: { format: 'html' as const, html: '<p>Enter a number.</p>' },
            required: true,
            maxScore: 1,
            config: { correctValue: 4, tolerance: 0 }
          }
        }
      ]
    };

    expect(getUnsupportedAssessmentVerticalSliceInteractionKinds(unsupportedDefinition)).toEqual([]);
  });

  it('scores the four-statement MOET tiers for zero through four correct answers', () => {
    const expectedScores = [0, 0.1, 0.25, 0.5, 1];

    expectedScores.forEach((expectedScore, correctCount) => {
      const response = {
        kind: 'true_false_group' as const,
        answers: trueFalseGroupInteraction.config.statements.map((statement, index) => ({
          statementId: statement.id,
          value: index < correctCount ? statement.correctValue : !statement.correctValue
        }))
      };

      expect(scoreTrueFalseGroupInteraction(trueFalseGroupInteraction, response)).toBe(expectedScore);
    });
  });

  it('scales tiered scores and supports proportional and all-or-nothing modes', () => {
    const fullyCorrectResponse = {
      kind: 'true_false_group' as const,
      answers: trueFalseGroupInteraction.config.statements.map((statement) => ({
        statementId: statement.id,
        value: statement.correctValue
      }))
    };
    const halfCorrectResponse = {
      kind: 'true_false_group' as const,
      answers: trueFalseGroupInteraction.config.statements.map((statement, index) => ({
        statementId: statement.id,
        value: index < 2 ? statement.correctValue : !statement.correctValue
      }))
    };

    expect(scoreTrueFalseGroupInteraction({ ...trueFalseGroupInteraction, maxScore: 2 }, fullyCorrectResponse)).toBe(2);
    expect(
      scoreTrueFalseGroupInteraction(
        {
          ...trueFalseGroupInteraction,
          maxScore: 3,
          config: { ...trueFalseGroupInteraction.config, scoring: { mode: 'proportional' } }
        },
        halfCorrectResponse
      )
    ).toBe(1.5);
    expect(
      scoreTrueFalseGroupInteraction(
        {
          ...trueFalseGroupInteraction,
          maxScore: 2.9,
          config: {
            ...trueFalseGroupInteraction.config,
            scoring: { mode: 'tiered', tiers: [0, 0.1, 0.25, 0.75, 1] }
          }
        },
        {
          kind: 'true_false_group',
          answers: trueFalseGroupInteraction.config.statements.map((statement, index) => ({
            statementId: statement.id,
            value: index < 3 ? statement.correctValue : !statement.correctValue
          }))
        }
      )
    ).toBe(2.18);
    expect(
      scoreTrueFalseGroupInteraction(
        {
          ...trueFalseGroupInteraction,
          maxScore: 0.05,
          config: {
            ...trueFalseGroupInteraction.config,
            scoring: { mode: 'tiered', tiers: [0, 0.1, 0.25, 0.7, 1] }
          }
        },
        {
          kind: 'true_false_group',
          answers: trueFalseGroupInteraction.config.statements.map((statement, index) => ({
            statementId: statement.id,
            value: index < 3 ? statement.correctValue : !statement.correctValue
          }))
        }
      )
    ).toBe(0.04);
    expect(
      scoreTrueFalseGroupInteraction(
        {
          ...trueFalseGroupInteraction,
          config: { ...trueFalseGroupInteraction.config, scoring: { mode: 'all_or_nothing' } }
        },
        halfCorrectResponse
      )
    ).toBe(0);
    expect(
      scoreTrueFalseGroupInteraction(
        {
          ...trueFalseGroupInteraction,
          config: { ...trueFalseGroupInteraction.config, scoring: { mode: 'all_or_nothing' } }
        },
        fullyCorrectResponse
      )
    ).toBe(1);
  });

  it('scores a partially answered tiered group without crediting unanswered statements', () => {
    expect(
      scoreTrueFalseGroupInteraction(trueFalseGroupInteraction, {
        kind: 'true_false_group',
        answers: [{ statementId: 's1', value: true }]
      })
    ).toBe(0.1);
  });

  it('sums decimal interaction scores without floating-point drift', () => {
    const decimalDefinition = {
      schemaVersion: 1 as const,
      blocks: [
        {
          id: 'choice-decimal-1',
          kind: 'interaction' as const,
          interaction: {
            kind: 'choice' as const,
            prompt: { format: 'html' as const, html: '<p>First.</p>' },
            required: true,
            maxScore: 0.1,
            config: {
              cardinality: 'single' as const,
              presentation: 'list' as const,
              options: [{ id: 'correct-1', html: '<p>Correct</p>' }],
              correctOptionIds: ['correct-1']
            }
          }
        },
        {
          id: 'choice-decimal-2',
          kind: 'interaction' as const,
          interaction: {
            kind: 'choice' as const,
            prompt: { format: 'html' as const, html: '<p>Second.</p>' },
            required: true,
            maxScore: 0.2,
            config: {
              cardinality: 'single' as const,
              presentation: 'list' as const,
              options: [{ id: 'correct-2', html: '<p>Correct</p>' }],
              correctOptionIds: ['correct-2']
            }
          }
        }
      ],
      feedback: []
    };
    const validation = validateAssessmentResponseEnvelope(decimalDefinition, {
      schemaVersion: 1,
      responses: [
        {
          interactionId: 'choice-decimal-1',
          response: { kind: 'choice', selectedOptionIds: ['correct-1'] }
        },
        {
          interactionId: 'choice-decimal-2',
          response: { kind: 'choice', selectedOptionIds: ['correct-2'] }
        }
      ]
    });
    if (!validation.success) throw new Error('expected a valid decimal response');

    expect(scoreAssessmentVerticalSlice(decimalDefinition, validation.data).autoScore).toBe(0.3);
  });

  it('scores numeric responses within the authored tolerance', () => {
    const numericDefinition = {
      schemaVersion: 1 as const,
      blocks: [
        {
          id: 'numeric-1',
          kind: 'interaction' as const,
          interaction: {
            kind: 'numeric' as const,
            prompt: { format: 'html' as const, html: '<p>Value.</p>' },
            required: true,
            maxScore: 2,
            config: { correctValue: 10, tolerance: 0.25 }
          }
        }
      ],
      feedback: []
    };
    const accepted = validateAssessmentResponseEnvelope(numericDefinition, {
      schemaVersion: 1,
      responses: [{ interactionId: 'numeric-1', response: { kind: 'numeric', value: 10.2 } }]
    });
    const rejected = validateAssessmentResponseEnvelope(numericDefinition, {
      schemaVersion: 1,
      responses: [{ interactionId: 'numeric-1', response: { kind: 'numeric', value: 10.3 } }]
    });
    expect(
      isAssessmentVerticalSliceResponseComplete(toAssessmentDeliveryDefinition(numericDefinition), undefined)
    ).toBe(false);
    if (!accepted.success || !rejected.success) throw new Error('expected numeric responses');
    expect(scoreAssessmentVerticalSlice(numericDefinition, accepted.data).autoScore).toBe(2);
    expect(scoreAssessmentVerticalSlice(numericDefinition, rejected.data).autoScore).toBe(0);
  });

  it('scores fill-blank responses positionally with legacy case-insensitive partial credit', () => {
    const fillBlankDefinition = {
      schemaVersion: 1 as const,
      blocks: [
        {
          id: 'fill-1',
          kind: 'interaction' as const,
          interaction: {
            kind: 'fill_blank' as const,
            prompt: { format: 'html' as const, html: '<p>Complete both blanks.</p>' },
            required: true,
            maxScore: 3,
            config: { acceptedAnswers: ['First', 'Second'] }
          }
        }
      ],
      feedback: []
    };
    const response = {
      schemaVersion: 1,
      responses: [{ interactionId: 'fill-1', response: { kind: 'fill_blank', values: [' first ', 'wrong'] } }]
    } as const;
    const validation = validateAssessmentResponseEnvelope(fillBlankDefinition, response);

    expect(validation.success).toBe(true);
    if (!validation.success) return;

    expect(
      isAssessmentVerticalSliceResponseComplete(toAssessmentDeliveryDefinition(fillBlankDefinition), response)
    ).toBe(true);
    expect(scoreAssessmentVerticalSlice(fillBlankDefinition, validation.data).autoScore).toBe(1.5);
  });
});

const wordBankDefinition = {
  schemaVersion: 1 as const,
  blocks: [
    {
      id: 'word-bank-1',
      kind: 'interaction' as const,
      interaction: {
        kind: 'word_bank' as const,
        prompt: { format: 'html' as const, html: '<p>Fill the sentence.</p>' },
        required: true,
        maxScore: 2,
        config: {
          template: '<p>The ___ sat on the ___.</p>',
          correctAnswers: ['cat', 'mat'],
          distractors: ['hat']
        }
      }
    }
  ],
  feedback: []
};

const orderingDefinition = {
  schemaVersion: 1 as const,
  blocks: [
    {
      id: 'ordering-1',
      kind: 'interaction' as const,
      interaction: {
        kind: 'ordering' as const,
        prompt: { format: 'html' as const, html: '<p>Put these in order.</p>' },
        required: true,
        maxScore: 3,
        config: {
          options: [
            { id: 'a', html: '<p>First</p>' },
            { id: 'b', html: '<p>Second</p>' },
            { id: 'c', html: '<p>Third</p>' }
          ],
          correctOrder: ['a', 'b', 'c']
        }
      }
    }
  ],
  feedback: []
};

function wordBankResponse(filledBlanks: string[]) {
  return {
    schemaVersion: 1,
    responses: [{ interactionId: 'word-bank-1', response: { kind: 'word_bank', filledBlanks } }]
  };
}

function orderingResponse(orderedOptionIds: string[]) {
  return {
    schemaVersion: 1,
    responses: [{ interactionId: 'ordering-1', response: { kind: 'ordering', orderedOptionIds } }]
  };
}

describe('word bank interactions', () => {
  it('is supported by the vertical slice', () => {
    expect(getUnsupportedAssessmentVerticalSliceInteractionKinds(wordBankDefinition)).toEqual([]);
  });

  it('accepts a response whose every blank holds a bank token', () => {
    const delivery = toAssessmentDeliveryDefinition(wordBankDefinition);

    expect(isAssessmentVerticalSliceResponseComplete(delivery, wordBankResponse(['cat', 'mat']))).toBe(true);
    expect(isAssessmentVerticalSliceResponseComplete(delivery, wordBankResponse(['hat', 'cat']))).toBe(true);
  });

  it('rejects a blank holding a word that is not in the bank', () => {
    const delivery = toAssessmentDeliveryDefinition(wordBankDefinition);

    expect(isAssessmentVerticalSliceResponseComplete(delivery, wordBankResponse(['cat', 'dog']))).toBe(false);
  });

  it('rejects an empty response for a required interaction', () => {
    const delivery = toAssessmentDeliveryDefinition(wordBankDefinition);

    expect(isAssessmentVerticalSliceResponseComplete(delivery, wordBankResponse(['', '']))).toBe(false);
    expect(isAssessmentVerticalSliceResponseComplete(delivery, undefined)).toBe(false);
  });

  it('counts a fully blank response as unanswered progress', () => {
    const delivery = toAssessmentDeliveryDefinition(wordBankDefinition);

    expect(getAssessmentVerticalSliceResponseProgress(delivery, wordBankResponse(['', '']))).toEqual({
      answered: 0,
      total: 1
    });
    expect(getAssessmentVerticalSliceResponseProgress(delivery, wordBankResponse(['cat', 'mat']))).toEqual({
      answered: 1,
      total: 1
    });
  });

  it('scores each blank positionally, case-insensitively, for partial credit', () => {
    const correct = validateAssessmentResponseEnvelope(wordBankDefinition, wordBankResponse([' Cat ', 'mat']));
    const half = validateAssessmentResponseEnvelope(wordBankDefinition, wordBankResponse(['cat', 'hat']));

    expect(correct.success && half.success).toBe(true);
    if (!correct.success || !half.success) return;

    expect(scoreAssessmentVerticalSlice(wordBankDefinition, correct.data).autoScore).toBe(2);
    expect(scoreAssessmentVerticalSlice(wordBankDefinition, half.data).autoScore).toBe(1);
  });
});

describe('ordering interactions', () => {
  it('is supported by the vertical slice', () => {
    expect(getUnsupportedAssessmentVerticalSliceInteractionKinds(orderingDefinition)).toEqual([]);
  });

  it('accepts an order that covers every option exactly once', () => {
    const delivery = toAssessmentDeliveryDefinition(orderingDefinition);

    expect(isAssessmentVerticalSliceResponseComplete(delivery, orderingResponse(['c', 'a', 'b']))).toBe(true);
  });

  it('rejects a partial order, a duplicate, and an unknown option', () => {
    const delivery = toAssessmentDeliveryDefinition(orderingDefinition);

    expect(isAssessmentVerticalSliceResponseComplete(delivery, orderingResponse(['a', 'b']))).toBe(false);
    expect(isAssessmentVerticalSliceResponseComplete(delivery, orderingResponse(['a', 'a', 'b']))).toBe(false);
    expect(isAssessmentVerticalSliceResponseComplete(delivery, orderingResponse(['a', 'b', 'z']))).toBe(false);
  });

  it('counts a partial order as unanswered progress', () => {
    const delivery = toAssessmentDeliveryDefinition(orderingDefinition);

    expect(getAssessmentVerticalSliceResponseProgress(delivery, orderingResponse(['a', 'b']))).toEqual({
      answered: 0,
      total: 1
    });
    expect(getAssessmentVerticalSliceResponseProgress(delivery, orderingResponse(['a', 'b', 'c']))).toEqual({
      answered: 1,
      total: 1
    });
  });

  it('scores the exact order only, never a partial arrangement', () => {
    const exact = validateAssessmentResponseEnvelope(orderingDefinition, orderingResponse(['a', 'b', 'c']));
    const swapped = validateAssessmentResponseEnvelope(orderingDefinition, orderingResponse(['a', 'c', 'b']));

    expect(exact.success && swapped.success).toBe(true);
    if (!exact.success || !swapped.success) return;

    expect(scoreAssessmentVerticalSlice(orderingDefinition, exact.data).autoScore).toBe(3);
    expect(scoreAssessmentVerticalSlice(orderingDefinition, swapped.data).autoScore).toBe(0);
  });
});
