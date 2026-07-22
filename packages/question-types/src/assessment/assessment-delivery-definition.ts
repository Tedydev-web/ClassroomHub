import type {
  AssessmentBlock,
  AssessmentContentBlock,
  AssessmentInteraction,
  AssessmentInteractionBlock,
  AssessmentItemDefinition
} from './assessment-item-schema';

type AssessmentDeliveryInteraction =
  | (Omit<Extract<AssessmentInteraction, { kind: 'choice' }>, 'config'> & {
      config: Omit<Extract<AssessmentInteraction, { kind: 'choice' }>['config'], 'correctOptionIds'>;
    })
  | (Omit<Extract<AssessmentInteraction, { kind: 'numeric' }>, 'config'> & {
      config: Omit<Extract<AssessmentInteraction, { kind: 'numeric' }>['config'], 'correctValue'>;
    })
  | (Omit<Extract<AssessmentInteraction, { kind: 'word_bank' }>, 'config'> & {
      config: Omit<Extract<AssessmentInteraction, { kind: 'word_bank' }>['config'], 'correctAnswers'>;
    })
  | (Omit<Extract<AssessmentInteraction, { kind: 'ordering' }>, 'config'> & {
      config: Omit<Extract<AssessmentInteraction, { kind: 'ordering' }>['config'], 'correctOrder'>;
    })
  | (Omit<Extract<AssessmentInteraction, { kind: 'fill_blank' }>, 'config'> & {
      config: Omit<Extract<AssessmentInteraction, { kind: 'fill_blank' }>['config'], 'acceptedAnswers'>;
    })
  | (Omit<Extract<AssessmentInteraction, { kind: 'star_rating' }>, 'config'> & {
      config: Omit<Extract<AssessmentInteraction, { kind: 'star_rating' }>['config'], 'correctValue'>;
    })
  | Extract<AssessmentInteraction, { kind: 'text' | 'file_upload' | 'link' | 'video_recording' }>;

export type AssessmentDeliveryBlock =
  | AssessmentContentBlock
  | (Omit<AssessmentInteractionBlock, 'interaction'> & { interaction: AssessmentDeliveryInteraction });

export type AssessmentDeliveryDefinition = {
  schemaVersion: AssessmentItemDefinition['schemaVersion'];
  blocks: AssessmentDeliveryBlock[];
};

function toDeliveryInteraction(interaction: AssessmentInteraction): AssessmentDeliveryInteraction {
  switch (interaction.kind) {
    case 'choice': {
      const { correctOptionIds: _correctOptionIds, ...config } = interaction.config;
      return { ...interaction, config };
    }
    case 'numeric': {
      const { correctValue: _correctValue, ...config } = interaction.config;
      return { ...interaction, config };
    }
    case 'fill_blank': {
      const { acceptedAnswers: _acceptedAnswers, ...config } = interaction.config;
      return { ...interaction, config };
    }
    case 'word_bank': {
      const { correctAnswers: _correctAnswers, ...config } = interaction.config;
      return { ...interaction, config };
    }
    case 'ordering': {
      const { correctOrder: _correctOrder, ...config } = interaction.config;
      return { ...interaction, config };
    }
    case 'star_rating': {
      const { correctValue: _correctValue, ...config } = interaction.config;
      return { ...interaction, config };
    }
    case 'text':
    case 'file_upload':
    case 'link':
    case 'video_recording':
      return interaction;
  }
}

function toDeliveryBlock(block: AssessmentBlock): AssessmentDeliveryBlock {
  if (block.kind === 'content') return block;

  return { ...block, interaction: toDeliveryInteraction(block.interaction) };
}

/**
 * Projection for learner delivery. It deliberately omits answer keys and
 * feedback, while retaining only the content and interaction configuration
 * needed to render and validate a response locally.
 */
export function toAssessmentDeliveryDefinition(definition: AssessmentItemDefinition): AssessmentDeliveryDefinition {
  return {
    schemaVersion: definition.schemaVersion,
    blocks: definition.blocks.map(toDeliveryBlock)
  };
}
