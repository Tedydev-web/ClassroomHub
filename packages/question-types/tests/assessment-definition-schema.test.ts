import { describe, expect, it } from 'vitest';
import { parseAssessmentItemDefinition } from '../src/assessment';
import type { AssessmentIssueCode } from '../src/assessment';
import {
  buildChoiceInteraction,
  buildDefinition,
  buildHybridDefinition,
  contentBlock,
  interactionBlock
} from './fixtures/assessment/definition-builders';
import { LEGACY_GOLDEN_CASES } from './fixtures/assessment/legacy-golden';

function expectIssue(value: unknown, code: AssessmentIssueCode): void {
  const result = parseAssessmentItemDefinition(value);
  expect(result.success).toBe(false);
  if (result.success) return;

  expect(result.issues.length).toBeGreaterThan(0);
  expect(result.issues.map((issue) => issue.code)).toContain(code);
}

describe('parseAssessmentItemDefinition — valid definitions', () => {
  it('accepts a minimal one-interaction item', () => {
    const result = parseAssessmentItemDefinition(buildDefinition());
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.schemaVersion).toBe(1);
    expect(result.data.blocks).toHaveLength(1);
  });

  it('accepts a multi-block hybrid item with content and feedback', () => {
    const definition = buildHybridDefinition();
    definition.feedback = [
      { id: 'f1', scope: 'item', html: '<p>Well done</p>', visibility: 'after_submit' },
      { id: 'f2', scope: 'item', html: '<p>Review the material</p>', visibility: 'after_grading' }
    ];

    const result = parseAssessmentItemDefinition(definition);
    expect(result.success).toBe(true);
  });

  it('accepts an explicit passage split presentation without changing the default flow contract', () => {
    const defaultResult = parseAssessmentItemDefinition(buildHybridDefinition());
    const splitResult = parseAssessmentItemDefinition({
      ...buildHybridDefinition(),
      presentation: { layout: 'passage_split' }
    });

    expect(defaultResult.success).toBe(true);
    if (!defaultResult.success) return;
    expect(defaultResult.data.presentation).toBeUndefined();

    expect(splitResult.success).toBe(true);
    if (!splitResult.success) return;
    expect(splitResult.data.presentation).toEqual({ layout: 'passage_split' });
  });

  it('accepts every golden adapter output shape', () => {
    for (const goldenCase of LEGACY_GOLDEN_CASES) {
      const result = parseAssessmentItemDefinition(goldenCase.expected);
      expect(result.success, goldenCase.name).toBe(true);
    }
  });

  it('accepts zero maxScore and two-decimal fractions', () => {
    const zeroScore = buildDefinition({
      blocks: [interactionBlock('i1', buildChoiceInteraction({ maxScore: 0 }))]
    });
    const fractional = buildDefinition({
      blocks: [interactionBlock('i1', buildChoiceInteraction({ maxScore: 0.25 }))]
    });

    expect(parseAssessmentItemDefinition(zeroScore).success).toBe(true);
    expect(parseAssessmentItemDefinition(fractional).success).toBe(true);
  });

  it('accepts degenerate legacy shapes: zero options and empty correct set', () => {
    const degenerate = buildDefinition({
      blocks: [
        interactionBlock(
          'i1',
          buildChoiceInteraction({
            config: { cardinality: 'single', presentation: 'list', options: [], correctOptionIds: [] }
          })
        )
      ]
    });

    expect(parseAssessmentItemDefinition(degenerate).success).toBe(true);
  });
});

describe('parseAssessmentItemDefinition — versioning and kinds', () => {
  it('rejects unknown schema versions explicitly', () => {
    expectIssue({ ...buildDefinition(), schemaVersion: 0 }, 'UNSUPPORTED_SCHEMA_VERSION');
    expectIssue({ ...buildDefinition(), schemaVersion: 2 }, 'UNSUPPORTED_SCHEMA_VERSION');
    expectIssue({ ...buildDefinition(), schemaVersion: '1' }, 'UNSUPPORTED_SCHEMA_VERSION');
    expectIssue({ blocks: [], feedback: [] }, 'UNSUPPORTED_SCHEMA_VERSION');
  });

  it('rejects unknown interaction kinds explicitly, never coercing', () => {
    const definition = buildDefinition();
    const unknownKind = {
      ...definition,
      blocks: [
        {
          id: 'i1',
          kind: 'interaction',
          interaction: { ...buildChoiceInteraction(), kind: 'slider' }
        }
      ]
    };

    expectIssue(unknownKind, 'UNSUPPORTED_INTERACTION_KIND');
  });

  it('rejects non-object input', () => {
    expectIssue(null, 'MALFORMED_DEFINITION');
    expectIssue('{}', 'MALFORMED_DEFINITION');
    expectIssue(42, 'MALFORMED_DEFINITION');
  });
});

describe('parseAssessmentItemDefinition — structural failures', () => {
  it('rejects empty blocks and items without interactions', () => {
    expectIssue(buildDefinition({ blocks: [] }), 'MALFORMED_DEFINITION');
    expectIssue(buildDefinition({ blocks: [contentBlock('c1')] }), 'MALFORMED_DEFINITION');
  });

  it('rejects duplicate block ids across content and interaction blocks', () => {
    const duplicateInteractionIds = buildDefinition({
      blocks: [interactionBlock('same', buildChoiceInteraction()), interactionBlock('same', buildChoiceInteraction())]
    });
    const contentCollision = buildDefinition({
      blocks: [contentBlock('same'), interactionBlock('same', buildChoiceInteraction())]
    });

    expectIssue(duplicateInteractionIds, 'DUPLICATE_BLOCK_ID');
    expectIssue(contentCollision, 'DUPLICATE_BLOCK_ID');
  });

  it('rejects invalid block id patterns', () => {
    for (const badId of ['', '-leading', 'a'.repeat(65), 'space id', 'ünïcode']) {
      expectIssue(
        buildDefinition({ blocks: [interactionBlock(badId, buildChoiceInteraction())] }),
        'MALFORMED_DEFINITION'
      );
    }
  });

  it('rejects unknown extra keys at every level (strict objects)', () => {
    expectIssue({ ...buildDefinition(), extra: true }, 'MALFORMED_DEFINITION');

    const extraInInteraction = buildDefinition();
    const withExtra = {
      ...extraInInteraction,
      blocks: [{ ...interactionBlock('i1', { ...buildChoiceInteraction(), surprise: 1 } as never) }]
    };
    expectIssue(withExtra, 'MALFORMED_DEFINITION');
  });

  it('rejects unknown item presentation layouts', () => {
    expectIssue({ ...buildHybridDefinition(), presentation: { layout: 'automatic_split' } }, 'MALFORMED_DEFINITION');
  });

  it('rejects invalid maxScore values with INVALID_SCORE', () => {
    for (const badScore of [-1, 3.333, Number.NaN, Number.POSITIVE_INFINITY, 10_001]) {
      expectIssue(
        buildDefinition({ blocks: [interactionBlock('i1', buildChoiceInteraction({ maxScore: badScore }))] }),
        'INVALID_SCORE'
      );
    }
  });

  it('rejects correct option ids outside the declared options', () => {
    const outside = buildDefinition({
      blocks: [
        interactionBlock(
          'i1',
          buildChoiceInteraction({
            config: {
              cardinality: 'single',
              presentation: 'list',
              options: [{ id: 'a', html: 'A' }],
              correctOptionIds: ['ghost']
            }
          })
        )
      ]
    });

    expectIssue(outside, 'MALFORMED_DEFINITION');
  });

  it('rejects duplicate option ids inside an interaction', () => {
    const duplicated = buildDefinition({
      blocks: [
        interactionBlock(
          'i1',
          buildChoiceInteraction({
            config: {
              cardinality: 'multiple',
              presentation: 'list',
              options: [
                { id: 'a', html: 'A' },
                { id: 'a', html: 'A again' }
              ],
              correctOptionIds: []
            }
          })
        )
      ]
    });

    expectIssue(duplicated, 'MALFORMED_DEFINITION');
  });

  it('rejects star correct values above max stars and negative numeric tolerance', () => {
    const badStar = buildDefinition({
      blocks: [
        interactionBlock('i1', {
          kind: 'star_rating',
          prompt: { format: 'html', html: 'Rate' },
          required: true,
          maxScore: 1,
          config: { maxStars: 5, correctValue: 6 }
        })
      ]
    });
    const badTolerance = buildDefinition({
      blocks: [
        interactionBlock('i1', {
          kind: 'numeric',
          prompt: { format: 'html', html: 'Number' },
          required: true,
          maxScore: 1,
          config: { correctValue: 1, tolerance: -0.5 }
        })
      ]
    });

    expectIssue(badStar, 'MALFORMED_DEFINITION');
    expectIssue(badTolerance, 'MALFORMED_DEFINITION');
  });

  it('rejects text limits where max is below min', () => {
    const invalidLimits = buildDefinition({
      blocks: [
        interactionBlock('i1', {
          kind: 'text',
          prompt: { format: 'html', html: 'Explain' },
          required: true,
          maxScore: 1,
          config: { format: 'rich', minCharacters: 100, maxCharacters: 10 }
        })
      ]
    });

    expectIssue(invalidLimits, 'MALFORMED_DEFINITION');
  });

  it('rejects duplicate feedback ids', () => {
    const definition = buildDefinition({
      feedback: [
        { id: 'f1', scope: 'item', html: 'a', visibility: 'after_submit' },
        { id: 'f1', scope: 'item', html: 'b', visibility: 'after_grading' }
      ]
    });

    expectIssue(definition, 'MALFORMED_DEFINITION');
  });
});
