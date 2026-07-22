import { describe, expect, it } from 'vitest';

import {
  getUnsupportedAssessmentVerticalSliceInteractionKinds,
  scoreAssessmentVerticalSlice,
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
