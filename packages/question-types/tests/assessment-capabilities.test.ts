import { describe, expect, it } from 'vitest';
import { deriveItemCapabilities, getItemMaxScore, mapAuthoredHtml } from '../src/assessment';
import {
  buildChoiceInteraction,
  buildDefinition,
  buildHybridDefinition,
  buildStarInteraction,
  buildTextInteraction,
  contentBlock,
  interactionBlock
} from './fixtures/assessment/definition-builders';

describe('deriveItemCapabilities', () => {
  it('derives auto mode when every interaction is auto-gradable', () => {
    const capabilities = deriveItemCapabilities(
      buildDefinition({
        blocks: [interactionBlock('i1', buildChoiceInteraction()), interactionBlock('i2', buildStarInteraction())]
      })
    );

    expect(capabilities.gradingMode).toBe('auto');
    expect(capabilities.autoGradable).toBe(true);
    expect(capabilities.manualGradingRequired).toBe(false);
  });

  it('derives manual mode when every interaction is manual', () => {
    const capabilities = deriveItemCapabilities(
      buildDefinition({ blocks: [interactionBlock('i1', buildTextInteraction())] })
    );

    expect(capabilities.gradingMode).toBe('manual');
    expect(capabilities.autoGradable).toBe(false);
    expect(capabilities.manualGradingRequired).toBe(true);
  });

  it('derives hybrid mode for mixed items', () => {
    const capabilities = deriveItemCapabilities(buildHybridDefinition());

    expect(capabilities.gradingMode).toBe('hybrid');
    expect(capabilities.autoGradable).toBe(false);
    expect(capabilities.manualGradingRequired).toBe(true);
  });

  it('multi-interaction items always support partial credit', () => {
    expect(deriveItemCapabilities(buildHybridDefinition()).supportsPartialCredit).toBe(true);
  });

  it('does not advertise partial credit for an all-or-nothing true-false group', () => {
    const definition = buildDefinition({
      blocks: [
        interactionBlock('i1', {
          kind: 'true_false_group',
          prompt: { format: 'html', html: 'Mark each statement' },
          required: true,
          maxScore: 1,
          config: {
            statements: [
              { id: 's1', html: 'One', correctValue: true },
              { id: 's2', html: 'Two', correctValue: false }
            ],
            scoring: { mode: 'all_or_nothing' }
          }
        })
      ]
    });

    expect(deriveItemCapabilities(definition).supportsPartialCredit).toBe(false);
  });

  it('advertises partial credit for a weighted single-choice interaction', () => {
    const definition = buildDefinition({
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
              correctOptionIds: ['b'],
              scoreWeights: { a: 25, b: 100 }
            }
          })
        )
      ]
    });

    expect(deriveItemCapabilities(definition).supportsPartialCredit).toBe(true);
  });

  it('does not advertise partial credit for an exact-match multiple-choice interaction', () => {
    const definition = buildDefinition({
      blocks: [
        interactionBlock(
          'i1',
          buildChoiceInteraction({
            config: {
              cardinality: 'multiple',
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

    expect(deriveItemCapabilities(definition).supportsPartialCredit).toBe(false);
  });

  it('flags managed asset requirements for file and video interactions', () => {
    const withVideo = buildDefinition({
      blocks: [
        interactionBlock('i1', {
          kind: 'video_recording',
          prompt: { format: 'html', html: 'Record' },
          required: true,
          maxScore: 1,
          config: { maxDurationSeconds: 60 }
        })
      ]
    });

    expect(deriveItemCapabilities(withVideo).requiresManagedAssets).toBe(true);
    expect(deriveItemCapabilities(buildDefinition()).requiresManagedAssets).toBe(false);
  });
});

describe('getItemMaxScore', () => {
  it('sums interaction maxima without floating point drift', () => {
    const definition = buildDefinition({
      blocks: [
        interactionBlock('i1', buildChoiceInteraction({ maxScore: 0.1 })),
        interactionBlock('i2', buildChoiceInteraction({ maxScore: 0.2 }))
      ]
    });

    expect(getItemMaxScore(definition)).toBe(0.3);
  });

  it('sums repeated two-decimal values exactly', () => {
    const definition = buildDefinition({
      blocks: [
        interactionBlock('i1', buildChoiceInteraction({ maxScore: 33.33 })),
        interactionBlock('i2', buildChoiceInteraction({ maxScore: 33.33 })),
        interactionBlock('i3', buildChoiceInteraction({ maxScore: 33.33 }))
      ]
    });

    expect(getItemMaxScore(definition)).toBe(99.99);
  });

  it('ignores content blocks and returns 0 for zero-point items', () => {
    const definition = buildDefinition({
      blocks: [contentBlock('c1'), interactionBlock('i1', buildChoiceInteraction({ maxScore: 0 }))]
    });

    expect(getItemMaxScore(definition)).toBe(0);
  });
});

describe('mapAuthoredHtml', () => {
  it('maps every authored html field and nothing else, without mutating the input', () => {
    const definition = buildHybridDefinition();
    definition.feedback = [{ id: 'f1', scope: 'item', html: '<p>Feedback</p>', visibility: 'after_submit' }];
    const snapshot = JSON.parse(JSON.stringify(definition)) as typeof definition;

    const mapped = mapAuthoredHtml(definition, (html) => `SAFE:${html}`);

    expect(definition).toEqual(snapshot);

    const contentBlockResult = mapped.blocks[0];
    if (contentBlockResult.kind !== 'content') throw new Error('expected content block');
    expect(contentBlockResult.content.html).toBe('SAFE:<p>Read this first</p>');

    for (const block of mapped.blocks) {
      if (block.kind !== 'interaction') continue;

      expect(block.interaction.prompt.html.startsWith('SAFE:')).toBe(true);
      if (block.interaction.kind === 'choice') {
        for (const option of block.interaction.config.options) {
          expect(option.html.startsWith('SAFE:')).toBe(true);
        }
      }
    }

    expect(mapped.feedback[0]?.html).toBe('SAFE:<p>Feedback</p>');
  });

  it('does not touch non-html fields like instructions, template, or ids', () => {
    const definition = buildDefinition({
      blocks: [
        interactionBlock('i1', {
          kind: 'word_bank',
          prompt: { format: 'html', html: 'Complete' },
          required: true,
          maxScore: 1,
          config: { template: 'The ___', correctAnswers: ['cat'], distractors: [] }
        })
      ]
    });

    const mapped = mapAuthoredHtml(definition, (html) => `SAFE:${html}`);
    const block = mapped.blocks[0];
    if (block.kind !== 'interaction' || block.interaction.kind !== 'word_bank') throw new Error('expected word_bank');

    expect(block.id).toBe('i1');
    expect(block.interaction.config.template).toBe('The ___');
    expect(block.interaction.config.correctAnswers).toEqual(['cat']);
  });

  it('maps grouped true/false statement html without changing answer values', () => {
    const definition = buildDefinition({
      blocks: [
        interactionBlock('i1', {
          kind: 'true_false_group',
          prompt: { format: 'html', html: '<p>Prompt</p>' },
          required: true,
          maxScore: 1,
          config: {
            statements: [
              { id: 's1', html: '<p>One</p>', correctValue: true },
              { id: 's2', html: '<p>Two</p>', correctValue: false }
            ],
            scoring: { mode: 'proportional' }
          }
        })
      ]
    });

    const mapped = mapAuthoredHtml(definition, (html) => `SAFE:${html}`);
    const block = mapped.blocks[0];
    if (block.kind !== 'interaction' || block.interaction.kind !== 'true_false_group') {
      throw new Error('expected true_false_group');
    }

    expect(block.interaction.prompt.html).toBe('SAFE:<p>Prompt</p>');
    expect(block.interaction.config.statements).toEqual([
      { id: 's1', html: 'SAFE:<p>One</p>', correctValue: true },
      { id: 's2', html: 'SAFE:<p>Two</p>', correctValue: false }
    ]);
  });
});
