import type {
  AssessmentContentBlock,
  AssessmentInteraction,
  AssessmentInteractionBlock,
  AssessmentItemDefinition
} from '../../../src/assessment';

/** Test builders producing structurally valid version-1 definitions. */

export function buildChoiceInteraction(
  overrides: Partial<AssessmentInteraction & { kind: 'choice' }> = {}
): Extract<AssessmentInteraction, { kind: 'choice' }> {
  return {
    kind: 'choice',
    prompt: { format: 'html', html: 'Pick one' },
    required: true,
    maxScore: 10,
    config: {
      cardinality: 'single',
      presentation: 'list',
      options: [
        { id: 'a', html: 'A' },
        { id: 'b', html: 'B' }
      ],
      correctOptionIds: ['a']
    },
    ...overrides
  } as Extract<AssessmentInteraction, { kind: 'choice' }>;
}

export function buildTextInteraction(): Extract<AssessmentInteraction, { kind: 'text' }> {
  return {
    kind: 'text',
    prompt: { format: 'html', html: 'Explain' },
    required: true,
    maxScore: 5,
    config: { format: 'rich' }
  };
}

export function buildStarInteraction(): Extract<AssessmentInteraction, { kind: 'star_rating' }> {
  return {
    kind: 'star_rating',
    prompt: { format: 'html', html: 'Rate it' },
    required: false,
    maxScore: 2,
    config: { maxStars: 5, correctValue: 4 }
  };
}

export function interactionBlock(id: string, interaction: AssessmentInteraction): AssessmentInteractionBlock {
  return { id, kind: 'interaction', interaction };
}

export function contentBlock(id: string, html = '<p>Read this first</p>'): AssessmentContentBlock {
  return { id, kind: 'content', content: { format: 'html', html } };
}

export function buildDefinition(overrides: Partial<AssessmentItemDefinition> = {}): AssessmentItemDefinition {
  return {
    schemaVersion: 1,
    blocks: [interactionBlock('i1', buildChoiceInteraction())],
    feedback: [],
    ...overrides
  };
}

/** A hybrid three-interaction item: auto choice + manual text + optional auto star. */
export function buildHybridDefinition(): AssessmentItemDefinition {
  return buildDefinition({
    blocks: [
      contentBlock('c1'),
      interactionBlock('i1', buildChoiceInteraction({ maxScore: 4 })),
      interactionBlock('i2', buildTextInteraction()),
      interactionBlock('i3', buildStarInteraction())
    ]
  });
}
