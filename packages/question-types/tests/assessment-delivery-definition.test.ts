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

  it('preserves fill-blank cardinality and a complete word bank without exposing answer partitions', () => {
    const definition = {
      schemaVersion: 1 as const,
      blocks: [
        {
          id: 'fill-1',
          kind: 'interaction' as const,
          interaction: {
            kind: 'fill_blank' as const,
            prompt: { format: 'html' as const, html: '<p>Complete both.</p>' },
            required: true,
            maxScore: 2,
            config: { acceptedAnswers: ['first', 'second'] }
          }
        },
        {
          id: 'bank-1',
          kind: 'interaction' as const,
          interaction: {
            kind: 'word_bank' as const,
            prompt: { format: 'html' as const, html: '<p>Use the bank.</p>' },
            required: true,
            maxScore: 2,
            config: {
              template: 'The ___ is above the ___.',
              correctAnswers: ['sky', 'sea'],
              distractors: ['grass']
            }
          }
        }
      ],
      feedback: []
    };

    const delivery = toAssessmentDeliveryDefinition(definition);
    const serialized = JSON.stringify(delivery);
    const fillBlankBlock = delivery.blocks[0];
    const wordBankBlock = delivery.blocks[1];

    expect(fillBlankBlock.kind).toBe('interaction');
    if (fillBlankBlock.kind !== 'interaction' || fillBlankBlock.interaction.kind !== 'fill_blank') return;
    expect(fillBlankBlock.interaction.config).toEqual({ blankCount: 2 });

    expect(wordBankBlock.kind).toBe('interaction');
    if (wordBankBlock.kind !== 'interaction' || wordBankBlock.interaction.kind !== 'word_bank') return;
    expect(wordBankBlock.interaction.config).toEqual({
      template: 'The ___ is above the ___.',
      bankTokens: ['grass', 'sea', 'sky']
    });
    expect(serialized).not.toContain('acceptedAnswers');
    expect(serialized).not.toContain('correctAnswers');
    expect(serialized).not.toContain('distractors');
    expect(parseAssessmentDeliveryDefinition(delivery)).toEqual({ success: true, data: delivery });
  });

  it('keeps grouped true/false statements renderable without their boolean answer keys', () => {
    const definition = {
      schemaVersion: 1 as const,
      blocks: [
        {
          id: 'group-1',
          kind: 'interaction' as const,
          interaction: {
            kind: 'true_false_group' as const,
            prompt: { format: 'html' as const, html: '<p>Mark each statement.</p>' },
            required: true,
            maxScore: 1,
            config: {
              statements: [
                { id: 's1', html: '<p>One</p>', correctValue: true },
                { id: 's2', html: '<p>Two</p>', correctValue: false }
              ],
              scoring: { mode: 'proportional' as const }
            }
          }
        }
      ],
      feedback: []
    };

    const delivery = toAssessmentDeliveryDefinition(definition);
    const serialized = JSON.stringify(delivery);
    const block = delivery.blocks[0];

    expect(serialized).not.toContain('correctValue');
    expect(block.kind).toBe('interaction');
    if (block.kind !== 'interaction' || block.interaction.kind !== 'true_false_group') return;
    expect(block.interaction.config.statements).toEqual([
      { id: 's1', html: '<p>One</p>' },
      { id: 's2', html: '<p>Two</p>' }
    ]);
    expect(parseAssessmentDeliveryDefinition(delivery)).toEqual({ success: true, data: delivery });
  });

  it('projects ordering options independently from the answer key and round-trips the delivery DTO', () => {
    const definition = {
      schemaVersion: 1 as const,
      blocks: [
        {
          id: 'ordering-1',
          kind: 'interaction' as const,
          interaction: {
            kind: 'ordering' as const,
            prompt: { format: 'html' as const, html: '<p>Order the steps.</p>' },
            required: true,
            maxScore: 1,
            config: {
              options: [
                { id: 'step-a', html: '<p>First</p>' },
                { id: 'step-b', html: '<p>Second</p>' },
                { id: 'step-c', html: '<p>Third</p>' }
              ],
              correctOrder: ['step-a', 'step-b', 'step-c']
            }
          }
        }
      ],
      feedback: []
    };

    const delivery = toAssessmentDeliveryDefinition(definition);
    const block = delivery.blocks[0];
    if (block.kind !== 'interaction' || block.interaction.kind !== 'ordering') {
      throw new Error('expected ordering');
    }

    expect(block.interaction.config.options.map((option) => option.id)).not.toEqual(
      definition.blocks[0].interaction.config.correctOrder
    );
    expect(JSON.stringify(delivery)).not.toContain('correctOrder');
    expect(parseAssessmentDeliveryDefinition(delivery)).toEqual({ success: true, data: delivery });
  });
});
