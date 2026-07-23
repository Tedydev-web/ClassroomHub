import { isRecord } from '../question-answer-validation';
import { assessmentFailure, assessmentIssue, assessmentSuccess, type AssessmentResult } from './assessment-errors';
import { parseAssessmentItemDefinition } from './assessment-item-validation';
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
  presentation?: AssessmentItemDefinition['presentation'];
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
    ...(definition.presentation ? { presentation: definition.presentation } : {}),
    blocks: definition.blocks.map(toDeliveryBlock)
  };
}

function getAnswerKeyField(kind: unknown): string | undefined {
  switch (kind) {
    case 'choice':
      return 'correctOptionIds';
    case 'numeric':
    case 'star_rating':
      return 'correctValue';
    case 'fill_blank':
      return 'acceptedAnswers';
    case 'word_bank':
      return 'correctAnswers';
    case 'ordering':
      return 'correctOrder';
    default:
      return undefined;
  }
}

function collectExposedAuthorDataIssues(value: unknown) {
  if (!isRecord(value)) return [];

  const issues = [];
  if (Object.prototype.hasOwnProperty.call(value, 'feedback')) {
    issues.push(assessmentIssue('MALFORMED_DEFINITION', ['feedback'], 'Learner delivery must not contain feedback'));
  }

  if (!Array.isArray(value.blocks)) return issues;

  value.blocks.forEach((block, blockIndex) => {
    if (!isRecord(block) || !isRecord(block.interaction) || !isRecord(block.interaction.config)) return;

    const answerKeyField = getAnswerKeyField(block.interaction.kind);
    if (answerKeyField && Object.prototype.hasOwnProperty.call(block.interaction.config, answerKeyField)) {
      issues.push(
        assessmentIssue(
          'MALFORMED_DEFINITION',
          ['blocks', blockIndex, 'interaction', 'config', answerKeyField],
          'Learner delivery must not contain answer keys'
        )
      );
    }
  });

  return issues;
}

function restoreAuthorShapeForValidation(interaction: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(interaction.config)) return interaction;

  const config = interaction.config;
  switch (interaction.kind) {
    case 'choice':
      return { ...interaction, config: { ...config, correctOptionIds: [] } };
    case 'numeric':
    case 'star_rating':
      return { ...interaction, config: { ...config, correctValue: null } };
    case 'fill_blank':
      return { ...interaction, config: { ...config, acceptedAnswers: [] } };
    case 'word_bank':
      return { ...interaction, config: { ...config, correctAnswers: [] } };
    case 'ordering':
      return { ...interaction, config: { ...config, correctOrder: [] } };
    default:
      return interaction;
  }
}

function restoreAuthorDefinitionShape(value: unknown): unknown {
  if (!isRecord(value)) return value;

  const blocks = Array.isArray(value.blocks)
    ? value.blocks.map((block) => {
        if (!isRecord(block) || block.kind !== 'interaction' || !isRecord(block.interaction)) return block;

        return { ...block, interaction: restoreAuthorShapeForValidation(block.interaction) };
      })
    : value.blocks;

  return { ...value, blocks, feedback: [] };
}

/** Strict trust-boundary parser for answer-key-free learner definitions. */
export function parseAssessmentDeliveryDefinition(value: unknown): AssessmentResult<AssessmentDeliveryDefinition> {
  const exposedAuthorDataIssues = collectExposedAuthorDataIssues(value);
  if (exposedAuthorDataIssues.length > 0) return assessmentFailure(exposedAuthorDataIssues);

  const parsedDefinition = parseAssessmentItemDefinition(restoreAuthorDefinitionShape(value));
  if (!parsedDefinition.success) return parsedDefinition;

  return assessmentSuccess(toAssessmentDeliveryDefinition(parsedDefinition.data));
}
