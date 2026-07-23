import { describe, expect, it } from 'vitest';

import { parseAssessmentDeliveryDefinition, toAssessmentDeliveryDefinition } from '../src/assessment';

describe('toAssessmentDeliveryDefinition', () => {
  it('preserves renderable choice content without exposing correct option ids', () => {
    const definition = {
      schemaVersion: 1 as const,
      presentation: { layout: 'passage_split' as const },
      blocks: [
        {
          id: 'content-1',
          kind: 'content' as const,
          content: { format: 'html' as const, html: '<p>Read this first.</p>' }
        },
        {
          id: 'choice-1',
          kind: 'interaction' as const,
          interaction: {
            kind: 'choice' as const,
            prompt: { format: 'html' as const, html: '<p>Select one.</p>' },
            required: true,
            maxScore: 2,
            config: {
              cardinality: 'single' as const,
              presentation: 'list' as const,
              options: [
                { id: 'option-a', html: '<p>A</p>' },
                { id: 'option-b', html: '<p>B</p>' }
              ],
              correctOptionIds: ['option-b']
            }
          }
        },
        {
          id: 'numeric-1',
          kind: 'interaction' as const,
          interaction: {
            kind: 'numeric' as const,
            prompt: { format: 'html' as const, html: '<p>Enter a number.</p>' },
            required: true,
            maxScore: 1,
            config: { correctValue: 42, tolerance: 0 }
          }
        }
      ],
      feedback: [
        {
          id: 'feedback-1',
          scope: 'item' as const,
          html: '<p>Review after grading.</p>',
          visibility: 'after_grading' as const
        }
      ]
    };

    const delivery = toAssessmentDeliveryDefinition(definition);
    const serialized = JSON.stringify(delivery);

    expect(delivery).toEqual({
      schemaVersion: 1,
      presentation: { layout: 'passage_split' },
      blocks: [
        {
          id: 'content-1',
          kind: 'content',
          content: { format: 'html', html: '<p>Read this first.</p>' }
        },
        {
          id: 'choice-1',
          kind: 'interaction',
          interaction: {
            kind: 'choice',
            prompt: { format: 'html', html: '<p>Select one.</p>' },
            required: true,
            maxScore: 2,
            config: {
              cardinality: 'single',
              presentation: 'list',
              options: [
                { id: 'option-a', html: '<p>A</p>' },
                { id: 'option-b', html: '<p>B</p>' }
              ]
            }
          }
        },
        {
          id: 'numeric-1',
          kind: 'interaction',
          interaction: {
            kind: 'numeric',
            prompt: { format: 'html', html: '<p>Enter a number.</p>' },
            required: true,
            maxScore: 1,
            config: { tolerance: 0 }
          }
        }
      ]
    });
    expect(serialized).not.toContain('correctOptionIds');
    expect(serialized).not.toContain('correctValue');
    expect(serialized).not.toContain('feedback-1');
    expect(parseAssessmentDeliveryDefinition(delivery)).toEqual({ success: true, data: delivery });
  });

  it('rejects answer keys and feedback at the learner trust boundary', () => {
    const leakedDefinition = {
      schemaVersion: 1,
      blocks: [
        {
          id: 'choice-1',
          kind: 'interaction',
          interaction: {
            kind: 'choice',
            prompt: { format: 'html', html: '<p>Select one.</p>' },
            required: true,
            maxScore: 1,
            config: {
              cardinality: 'single',
              presentation: 'list',
              options: [
                { id: 'option-a', html: '<p>A</p>' },
                { id: 'option-b', html: '<p>B</p>' }
              ],
              correctOptionIds: ['option-a']
            }
          }
        }
      ],
      feedback: []
    };

    const result = parseAssessmentDeliveryDefinition(leakedDefinition);

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.issues.map((issue) => issue.path)).toEqual([
      ['feedback'],
      ['blocks', 0, 'interaction', 'config', 'correctOptionIds']
    ]);
  });
});
