import { isRecord } from '../question-answer-validation';
import {
  assessmentFailure,
  assessmentIssue,
  assessmentSuccess,
  type AssessmentIssue,
  type AssessmentResult
} from './assessment-errors';
import { parseAssessmentItemDefinition } from './assessment-item-validation';
import type {
  AssessmentBlock,
  AssessmentContentBlock,
  AssessmentInteraction,
  AssessmentInteractionKind,
  AssessmentInteractionBlock,
  AssessmentItemDefinition
} from './assessment-item-schema';

type AssessmentDeliveryInteraction =
  | (Omit<Extract<AssessmentInteraction, { kind: 'choice' }>, 'config'> & {
      config: Omit<Extract<AssessmentInteraction, { kind: 'choice' }>['config'], 'correctOptionIds' | 'scoreWeights'>;
    })
  | (Omit<Extract<AssessmentInteraction, { kind: 'numeric' }>, 'config'> & {
      config: Omit<Extract<AssessmentInteraction, { kind: 'numeric' }>['config'], 'correctValue'>;
    })
  | (Omit<Extract<AssessmentInteraction, { kind: 'word_bank' }>, 'config'> & {
      config: Omit<
        Extract<AssessmentInteraction, { kind: 'word_bank' }>['config'],
        'correctAnswers' | 'distractors'
      > & {
        bankTokens: string[];
      };
    })
  | (Omit<Extract<AssessmentInteraction, { kind: 'ordering' }>, 'config'> & {
      config: Omit<Extract<AssessmentInteraction, { kind: 'ordering' }>['config'], 'correctOrder'>;
    })
  | (Omit<Extract<AssessmentInteraction, { kind: 'true_false_group' }>, 'config'> & {
      config: Omit<Extract<AssessmentInteraction, { kind: 'true_false_group' }>['config'], 'statements'> & {
        statements: Array<
          Omit<
            Extract<AssessmentInteraction, { kind: 'true_false_group' }>['config']['statements'][number],
            'correctValue'
          >
        >;
      };
    })
  | (Omit<Extract<AssessmentInteraction, { kind: 'fill_blank' }>, 'config'> & {
      config: Omit<Extract<AssessmentInteraction, { kind: 'fill_blank' }>['config'], 'acceptedAnswers'> & {
        blankCount: number;
      };
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
      const { correctOptionIds: _correctOptionIds, scoreWeights: _scoreWeights, ...config } = interaction.config;
      return { ...interaction, config };
    }
    case 'numeric': {
      const { correctValue: _correctValue, ...config } = interaction.config;
      return { ...interaction, config };
    }
    case 'fill_blank': {
      const { acceptedAnswers: _acceptedAnswers, ...config } = interaction.config;
      return { ...interaction, config: { ...config, blankCount: interaction.config.acceptedAnswers.length } };
    }
    case 'word_bank': {
      const { correctAnswers, distractors, ...config } = interaction.config;
      const bankTokens = [...correctAnswers, ...distractors].sort((left, right) => left.localeCompare(right));
      return { ...interaction, config: { ...config, bankTokens } };
    }
    case 'ordering': {
      const { correctOrder: _correctOrder, options, ...config } = interaction.config;
      const deliveryOptions = [...options].sort((left, right) =>
        left.id < right.id ? 1 : left.id > right.id ? -1 : 0
      );
      return { ...interaction, config: { ...config, options: deliveryOptions } };
    }
    case 'true_false_group':
      return {
        ...interaction,
        config: {
          ...interaction.config,
          statements: interaction.config.statements.map(({ correctValue: _correctValue, ...statement }) => statement)
        }
      };
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

const ANSWER_KEY_FIELDS_BY_KIND = {
  choice: ['correctOptionIds', 'scoreWeights'],
  text: [],
  numeric: ['correctValue'],
  fill_blank: ['acceptedAnswers'],
  word_bank: ['correctAnswers', 'distractors'],
  ordering: ['correctOrder'],
  true_false_group: [],
  file_upload: [],
  link: [],
  star_rating: ['correctValue'],
  video_recording: []
} as const satisfies Record<AssessmentInteractionKind, readonly string[]>;

type RestoreDeliveryConfig = (config: Record<string, unknown>) => Record<string, unknown>;

const DELIVERY_CONFIG_RESTORERS = {
  choice: (config) => ({ ...config, correctOptionIds: [] }),
  text: (config) => config,
  numeric: (config) => ({ ...config, correctValue: null }),
  fill_blank: (config) => {
    const blankCount = config.blankCount;
    if (typeof blankCount !== 'number' || !Number.isInteger(blankCount) || blankCount < 0) return config;

    const { blankCount: _blankCount, ...rest } = config;
    const acceptedAnswers = Array.from({ length: blankCount }, () => '__delivery_blank__');
    return { ...rest, acceptedAnswers };
  },
  word_bank: (config) => {
    const bankTokens = config.bankTokens;
    if (!Array.isArray(bankTokens) || !bankTokens.every((token) => typeof token === 'string')) return config;

    const { bankTokens: _bankTokens, ...rest } = config;
    return { ...rest, correctAnswers: [], distractors: bankTokens };
  },
  ordering: (config) => {
    const options = config.options;
    if (!Array.isArray(options) || !options.every(isRecord)) return config;

    const optionIds = options.map((option) => option.id);
    if (!optionIds.every((optionId): optionId is string => typeof optionId === 'string')) return config;

    return { ...config, correctOrder: optionIds };
  },
  true_false_group: (config) => {
    const statements = config.statements;
    if (!Array.isArray(statements) || !statements.every(isRecord)) return config;

    return {
      ...config,
      statements: statements.map((statement) => ({ ...statement, correctValue: false }))
    };
  },
  file_upload: (config) => config,
  link: (config) => config,
  star_rating: (config) => ({ ...config, correctValue: null }),
  video_recording: (config) => config
} satisfies Record<AssessmentInteractionKind, RestoreDeliveryConfig>;

function collectExposedAuthorDataIssues(value: unknown) {
  if (!isRecord(value)) return [];

  // Typed explicitly: an empty `[]` is an evolving array under this package's own compiler
  // settings but `never[]` under the dashboard's, which checks this source too — so every push
  // below was an error there, hidden while the dashboard's generated route types were stale.
  const issues: AssessmentIssue[] = [];
  if (Object.prototype.hasOwnProperty.call(value, 'feedback')) {
    issues.push(assessmentIssue('MALFORMED_DEFINITION', ['feedback'], 'Learner delivery must not contain feedback'));
  }

  if (!Array.isArray(value.blocks)) return issues;

  value.blocks.forEach((block, blockIndex) => {
    if (!isRecord(block) || !isRecord(block.interaction) || !isRecord(block.interaction.config)) return;

    const kind = block.interaction.kind;
    if (typeof kind !== 'string' || !(kind in ANSWER_KEY_FIELDS_BY_KIND)) return;

    for (const answerKeyField of ANSWER_KEY_FIELDS_BY_KIND[kind as AssessmentInteractionKind]) {
      if (Object.prototype.hasOwnProperty.call(block.interaction.config, answerKeyField)) {
        issues.push(
          assessmentIssue(
            'MALFORMED_DEFINITION',
            ['blocks', blockIndex, 'interaction', 'config', answerKeyField],
            'Learner delivery must not contain answer keys'
          )
        );
      }
    }

    if (kind === 'true_false_group' && Array.isArray(block.interaction.config.statements)) {
      block.interaction.config.statements.forEach((statement, statementIndex) => {
        if (!isRecord(statement) || !Object.prototype.hasOwnProperty.call(statement, 'correctValue')) return;

        issues.push(
          assessmentIssue(
            'MALFORMED_DEFINITION',
            ['blocks', blockIndex, 'interaction', 'config', 'statements', statementIndex, 'correctValue'],
            'Learner delivery must not contain answer keys'
          )
        );
      });
    }
  });

  return issues;
}

function restoreAuthorShapeForValidation(interaction: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(interaction.config)) return interaction;

  const kind = interaction.kind;
  if (typeof kind !== 'string' || !(kind in DELIVERY_CONFIG_RESTORERS)) return interaction;

  const restoreConfig = DELIVERY_CONFIG_RESTORERS[kind as AssessmentInteractionKind];
  return { ...interaction, config: restoreConfig(interaction.config) };
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
