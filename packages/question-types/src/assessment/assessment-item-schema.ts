import * as z from 'zod';
import { FILE_UPLOAD_MIME_TYPES } from '../file-upload-settings';
import { MAX_ANSWER_COLLECTION_ITEMS, MAX_ANSWER_ITEM_TEXT_LENGTH } from '../question-answer-validation';
import { VIDEO_RECORDING_PLATFORM_MAX_DURATION_SECONDS } from '../video-recording-settings';
import {
  ASSESSMENT_ID_PATTERN,
  MAX_ASSESSMENT_BLOCKS,
  MAX_AUTHORED_HTML_LENGTH,
  MAX_INTERACTION_MAX_SCORE,
  MAX_INTERACTION_OPTIONS,
  MAX_ITEM_FEEDBACK_ENTRIES,
  MAX_STAR_RATING_STARS
} from './assessment-limits';

/**
 * Schema-version-1 canonical assessment item model. Closed discriminated
 * unions; strict objects everywhere (unknown keys are rejected so the
 * canonical serialization and content hash stay stable).
 *
 * Structural rules here must accept every definition the legacy adapter can
 * produce from a valid database row. Stricter author-facing rules (minimum
 * option counts, present answer keys, ...) live in the publish gate.
 */

const assessmentIdSchema = z
  .string()
  .regex(ASSESSMENT_ID_PATTERN, 'identifier must be 1-64 characters of A-Za-z0-9_- starting alphanumeric');

const authoredHtmlSchema = z.strictObject({
  format: z.literal('html'),
  html: z.string().max(MAX_AUTHORED_HTML_LENGTH)
});

/** Two-decimal, non-negative interaction maximum. */
const maxScoreSchema = z
  .number()
  .min(0)
  .max(MAX_INTERACTION_MAX_SCORE)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
    message: 'maxScore must have at most two decimal places'
  });

/** Choice options carry strict identifiers (adapter emits stringified DB ids). */
const choiceOptionSchema = z.strictObject({
  id: assessmentIdSchema,
  html: z.string().max(MAX_AUTHORED_HTML_LENGTH)
});

/**
 * Ordering option ids are the legacy answer values (option id, value, or
 * label text), so they allow arbitrary non-empty strings instead of the
 * strict identifier pattern.
 */
const orderingOptionSchema = z.strictObject({
  id: z.string().min(1).max(MAX_ANSWER_ITEM_TEXT_LENGTH),
  html: z.string().max(MAX_AUTHORED_HTML_LENGTH)
});

const interactionBaseShape = {
  prompt: authoredHtmlSchema,
  required: z.boolean(),
  maxScore: maxScoreSchema
};

const instructionsSchema = z.string().max(MAX_ANSWER_ITEM_TEXT_LENGTH).optional();

const choiceInteractionSchema = z.strictObject({
  kind: z.literal('choice'),
  ...interactionBaseShape,
  config: z.strictObject({
    cardinality: z.enum(['single', 'multiple']),
    presentation: z.enum(['list', 'true_false']),
    options: z.array(choiceOptionSchema).max(MAX_INTERACTION_OPTIONS),
    correctOptionIds: z.array(assessmentIdSchema).max(MAX_INTERACTION_OPTIONS),
    scoreWeights: z.record(assessmentIdSchema, z.number().min(-100).max(100)).optional()
  })
});

const textInteractionSchema = z.strictObject({
  kind: z.literal('text'),
  ...interactionBaseShape,
  config: z.strictObject({
    format: z.enum(['rich', 'plain']),
    minCharacters: z.number().int().min(0).optional(),
    maxCharacters: z.number().int().min(0).optional(),
    instructions: instructionsSchema
  })
});

const numericInteractionSchema = z.strictObject({
  kind: z.literal('numeric'),
  ...interactionBaseShape,
  config: z.strictObject({
    /** null = no valid answer key; the interaction always scores zero (legacy parity). */
    correctValue: z.number().nullable(),
    tolerance: z.number().min(0)
  })
});

const fillBlankInteractionSchema = z.strictObject({
  kind: z.literal('fill_blank'),
  ...interactionBaseShape,
  config: z.strictObject({
    acceptedAnswers: z.array(z.string().min(1).max(MAX_ANSWER_ITEM_TEXT_LENGTH)).max(MAX_ANSWER_COLLECTION_ITEMS)
  })
});

const wordBankInteractionSchema = z.strictObject({
  kind: z.literal('word_bank'),
  ...interactionBaseShape,
  config: z.strictObject({
    template: z.string().max(MAX_AUTHORED_HTML_LENGTH),
    correctAnswers: z.array(z.string().min(1).max(MAX_ANSWER_ITEM_TEXT_LENGTH)).max(MAX_ANSWER_COLLECTION_ITEMS),
    distractors: z.array(z.string().min(1).max(MAX_ANSWER_ITEM_TEXT_LENGTH)).max(MAX_ANSWER_COLLECTION_ITEMS)
  })
});

const orderingInteractionSchema = z.strictObject({
  kind: z.literal('ordering'),
  ...interactionBaseShape,
  config: z.strictObject({
    options: z.array(orderingOptionSchema).max(MAX_INTERACTION_OPTIONS),
    correctOrder: z.array(z.string().min(1).max(MAX_ANSWER_ITEM_TEXT_LENGTH)).max(MAX_INTERACTION_OPTIONS)
  })
});

export const DEFAULT_TRUE_FALSE_GROUP_TIERS = [0, 0.1, 0.25, 0.5, 1] as const;

const trueFalseGroupStatementSchema = z.strictObject({
  id: assessmentIdSchema,
  html: z.string().max(MAX_AUTHORED_HTML_LENGTH),
  correctValue: z.boolean()
});

const scoreFractionSchema = z.number().min(0).max(1);

const trueFalseGroupScoringSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    mode: z.literal('tiered'),
    tiers: z.array(scoreFractionSchema).max(MAX_INTERACTION_OPTIONS + 1)
  }),
  z.strictObject({ mode: z.literal('proportional') }),
  z.strictObject({ mode: z.literal('all_or_nothing') })
]);

const trueFalseGroupInteractionSchema = z.strictObject({
  kind: z.literal('true_false_group'),
  ...interactionBaseShape,
  config: z.strictObject({
    statements: z.array(trueFalseGroupStatementSchema).min(2).max(MAX_INTERACTION_OPTIONS),
    scoring: trueFalseGroupScoringSchema
  })
});

const fileUploadInteractionSchema = z.strictObject({
  kind: z.literal('file_upload'),
  ...interactionBaseShape,
  config: z.strictObject({
    acceptedTypes: z.array(z.enum(FILE_UPLOAD_MIME_TYPES)).min(1).max(FILE_UPLOAD_MIME_TYPES.length),
    maxSizeMb: z.number().positive().optional()
  })
});

const linkInteractionSchema = z.strictObject({
  kind: z.literal('link'),
  ...interactionBaseShape,
  config: z.strictObject({
    instructions: instructionsSchema
  })
});

const starRatingInteractionSchema = z.strictObject({
  kind: z.literal('star_rating'),
  ...interactionBaseShape,
  config: z.strictObject({
    maxStars: z.number().int().min(1).max(MAX_STAR_RATING_STARS),
    /** null = no valid answer key; always scores zero (legacy parity). */
    correctValue: z.number().int().min(1).max(MAX_STAR_RATING_STARS).nullable()
  })
});

const videoRecordingInteractionSchema = z.strictObject({
  kind: z.literal('video_recording'),
  ...interactionBaseShape,
  config: z.strictObject({
    maxDurationSeconds: z.number().int().min(1).max(VIDEO_RECORDING_PLATFORM_MAX_DURATION_SECONDS)
  })
});

export const ASSESSMENT_INTERACTION_SCHEMAS = [
  choiceInteractionSchema,
  textInteractionSchema,
  numericInteractionSchema,
  fillBlankInteractionSchema,
  wordBankInteractionSchema,
  orderingInteractionSchema,
  trueFalseGroupInteractionSchema,
  fileUploadInteractionSchema,
  linkInteractionSchema,
  starRatingInteractionSchema,
  videoRecordingInteractionSchema
] as const;

export const assessmentInteractionSchema = z.discriminatedUnion('kind', [...ASSESSMENT_INTERACTION_SCHEMAS]);

export const ASSESSMENT_INTERACTION_KINDS = [
  'choice',
  'text',
  'numeric',
  'fill_blank',
  'word_bank',
  'ordering',
  'true_false_group',
  'file_upload',
  'link',
  'star_rating',
  'video_recording'
] as const;

export type AssessmentInteractionKind = (typeof ASSESSMENT_INTERACTION_KINDS)[number];

const contentBlockSchema = z.strictObject({
  id: assessmentIdSchema,
  kind: z.literal('content'),
  content: authoredHtmlSchema
});

const interactionBlockSchema = z.strictObject({
  id: assessmentIdSchema,
  kind: z.literal('interaction'),
  interaction: assessmentInteractionSchema
});

const assessmentBlockSchema = z.discriminatedUnion('kind', [contentBlockSchema, interactionBlockSchema]);

const feedbackBaseShape = {
  id: assessmentIdSchema,
  html: z.string().max(MAX_AUTHORED_HTML_LENGTH),
  visibility: z.enum(['after_submit', 'after_grading'])
};

const itemFeedbackSchema = z.discriminatedUnion('scope', [
  z.strictObject({
    ...feedbackBaseShape,
    scope: z.literal('item')
  }),
  z.strictObject({
    ...feedbackBaseShape,
    scope: z.literal('choice_option'),
    interactionId: assessmentIdSchema,
    optionId: assessmentIdSchema
  })
]);

const itemPresentationSchema = z.strictObject({
  layout: z.enum(['flow', 'passage_split'])
});

export const assessmentItemDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  presentation: itemPresentationSchema.optional(),
  blocks: z.array(assessmentBlockSchema).min(1).max(MAX_ASSESSMENT_BLOCKS),
  feedback: z.array(itemFeedbackSchema).max(MAX_ITEM_FEEDBACK_ENTRIES)
});

export type AssessmentItemDefinition = z.infer<typeof assessmentItemDefinitionSchema>;
export type AssessmentBlock = z.infer<typeof assessmentBlockSchema>;
export type AssessmentContentBlock = z.infer<typeof contentBlockSchema>;
export type AssessmentInteractionBlock = z.infer<typeof interactionBlockSchema>;
export type AssessmentInteraction = z.infer<typeof assessmentInteractionSchema>;
export type ItemFeedback = z.infer<typeof itemFeedbackSchema>;

/** Interaction blocks in document order. The block id is the interaction identifier. */
export function getAssessmentInteractionBlocks(definition: AssessmentItemDefinition): AssessmentInteractionBlock[] {
  return definition.blocks.filter((block): block is AssessmentInteractionBlock => block.kind === 'interaction');
}
