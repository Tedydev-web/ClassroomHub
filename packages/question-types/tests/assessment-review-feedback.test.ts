import { describe, expect, it } from 'vitest';

import {
  resolveReleasedAssessmentFeedback,
  type AssessmentItemDefinition,
  type AssessmentResponseEnvelope
} from '../src/assessment';

const definition: AssessmentItemDefinition = {
  schemaVersion: 1,
  blocks: [
    {
      id: 'choice-1',
      kind: 'interaction',
      interaction: {
        kind: 'choice',
        prompt: { format: 'html', html: '<p>Choose.</p>' },
        required: true,
        maxScore: 1,
        config: {
          cardinality: 'single',
          presentation: 'list',
          options: [
            { id: 'option-a', html: '<p>A</p>' },
            { id: 'option-b', html: '<p>B</p>' }
          ],
          correctOptionIds: ['option-b']
        }
      }
    }
  ],
  feedback: [
    { id: 'submitted', scope: 'item', html: '<p>Submitted.</p>', visibility: 'after_submit' },
    {
      id: 'selected',
      scope: 'choice_option',
      interactionId: 'choice-1',
      optionId: 'option-a',
      html: '<p>You selected A.</p>',
      visibility: 'after_grading'
    },
    {
      id: 'unselected',
      scope: 'choice_option',
      interactionId: 'choice-1',
      optionId: 'option-b',
      html: '<p>You did not select B.</p>',
      visibility: 'after_grading'
    },
    { id: 'graded', scope: 'item', html: '<p>Graded.</p>', visibility: 'after_grading' }
  ]
};

const response: AssessmentResponseEnvelope = {
  schemaVersion: 1,
  responses: [
    {
      interactionId: 'choice-1',
      response: { kind: 'choice', selectedOptionIds: ['option-a'] }
    }
  ]
};

describe('released assessment feedback', () => {
  it('releases only after-submit feedback before grading', () => {
    expect(resolveReleasedAssessmentFeedback(definition, response, 'after_submit')).toEqual([
      { id: 'submitted', scope: 'item', html: '<p>Submitted.</p>' }
    ]);
  });

  it('preserves document order and excludes feedback for unselected options after grading', () => {
    expect(resolveReleasedAssessmentFeedback(definition, response, 'after_grading')).toEqual([
      { id: 'submitted', scope: 'item', html: '<p>Submitted.</p>' },
      {
        id: 'selected',
        scope: 'choice_option',
        interactionId: 'choice-1',
        optionId: 'option-a',
        html: '<p>You selected A.</p>'
      },
      { id: 'graded', scope: 'item', html: '<p>Graded.</p>' }
    ]);
  });

  it('does not match option feedback against a non-choice response', () => {
    const textResponse: AssessmentResponseEnvelope = {
      schemaVersion: 1,
      responses: [{ interactionId: 'choice-1', response: { kind: 'text', text: 'option-a' } }]
    };

    expect(resolveReleasedAssessmentFeedback(definition, textResponse, 'after_grading')).toEqual([
      { id: 'submitted', scope: 'item', html: '<p>Submitted.</p>' },
      { id: 'graded', scope: 'item', html: '<p>Graded.</p>' }
    ]);
  });
});
