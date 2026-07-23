import { describe, expect, it } from 'vitest';

import {
  getAssessmentVerticalSliceResponseProgress,
  getUnsupportedAssessmentVerticalSliceInteractionKinds,
  isAssessmentVerticalSliceResponseComplete,
  scoreAssessmentVerticalSlice,
  toAssessmentDeliveryDefinition,
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

  it('rejects interactions that have no Phase 3 renderer and scorer', () => {
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

    expect(getUnsupportedAssessmentVerticalSliceInteractionKinds(unsupportedDefinition)).toEqual(['numeric']);
  });
});
