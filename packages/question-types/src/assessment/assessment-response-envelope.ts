import * as z from 'zod';
import { isFileUploadTypeAllowed } from '../file-upload-settings';
import {
  MAX_ANSWER_COLLECTION_ITEMS,
  MAX_ANSWER_ITEM_TEXT_LENGTH,
  MAX_FILE_KEY_LENGTH,
  MAX_FILE_NAME_LENGTH,
  MAX_MIME_TYPE_LENGTH,
  MAX_URL_LENGTH,
  isExactStringPermutation,
  isHttpUrl,
  isRecord,
  isUnique
} from '../question-answer-validation';
import { getTextareaAnswerCharacterCount } from '../textarea-validation';
import {
  assessmentFailure,
  assessmentIssue,
  assessmentSuccess,
  zodIssuesToAssessmentIssues,
  type AssessmentIssue,
  type AssessmentResult
} from './assessment-errors';
import {
  getAssessmentInteractionBlocks,
  type AssessmentInteraction,
  type AssessmentItemDefinition
} from './assessment-item-schema';
import {
  MAX_ASSESSMENT_ID_LENGTH,
  MAX_ASSESSMENT_INTERACTIONS,
  MAX_RESPONSE_TEXT_LENGTH,
  MAX_STAR_RATING_STARS
} from './assessment-limits';

const choiceResponseSchema = z.strictObject({
  kind: z.literal('choice'),
  selectedOptionIds: z.array(z.string().min(1).max(MAX_ANSWER_ITEM_TEXT_LENGTH)).min(1).max(MAX_ANSWER_COLLECTION_ITEMS)
});

const textResponseSchema = z.strictObject({
  kind: z.literal('text'),
  text: z.string().max(MAX_RESPONSE_TEXT_LENGTH)
});

const numericResponseSchema = z.strictObject({
  kind: z.literal('numeric'),
  value: z.number().refine(Number.isFinite, { message: 'value must be a finite number' })
});

const fillBlankResponseSchema = z.strictObject({
  kind: z.literal('fill_blank'),
  values: z.array(z.string().max(MAX_ANSWER_ITEM_TEXT_LENGTH)).max(MAX_ANSWER_COLLECTION_ITEMS)
});

const wordBankResponseSchema = z.strictObject({
  kind: z.literal('word_bank'),
  filledBlanks: z.array(z.string().max(MAX_ANSWER_ITEM_TEXT_LENGTH)).max(MAX_ANSWER_COLLECTION_ITEMS)
});

const orderingResponseSchema = z.strictObject({
  kind: z.literal('ordering'),
  orderedOptionIds: z.array(z.string().min(1).max(MAX_ANSWER_ITEM_TEXT_LENGTH)).min(1).max(MAX_ANSWER_COLLECTION_ITEMS)
});

const trueFalseGroupResponseSchema = z.strictObject({
  kind: z.literal('true_false_group'),
  answers: z
    .array(
      z.strictObject({
        statementId: z.string().min(1).max(MAX_ANSWER_ITEM_TEXT_LENGTH),
        value: z.boolean()
      })
    )
    .min(1)
    .max(MAX_ANSWER_COLLECTION_ITEMS)
});

const fileUploadResponseSchema = z.strictObject({
  kind: z.literal('file_upload'),
  assetId: z.string().min(1).max(MAX_FILE_KEY_LENGTH),
  fileKey: z.string().min(1).max(MAX_FILE_KEY_LENGTH),
  fileName: z.string().min(1).max(MAX_FILE_NAME_LENGTH),
  mimeType: z.string().min(1).max(MAX_MIME_TYPE_LENGTH),
  size: z.number().int().positive()
});

const linkResponseSchema = z.strictObject({
  kind: z.literal('link'),
  urls: z
    .array(z.string().min(1).max(MAX_URL_LENGTH).refine(isHttpUrl, { message: 'must be an http(s) URL' }))
    .min(1)
    .max(MAX_ANSWER_COLLECTION_ITEMS)
});

const starRatingResponseSchema = z.strictObject({
  kind: z.literal('star_rating'),
  value: z.number().int().min(1).max(MAX_STAR_RATING_STARS)
});

const videoRecordingResponseSchema = z.strictObject({
  kind: z.literal('video_recording'),
  assetId: z.string().min(1).max(MAX_FILE_KEY_LENGTH),
  storageKey: z.string().min(1).max(MAX_FILE_KEY_LENGTH),
  fileName: z.string().min(1).max(MAX_FILE_NAME_LENGTH),
  mimeType: z
    .string()
    .max(MAX_MIME_TYPE_LENGTH)
    .refine((value) => value.startsWith('video/'), { message: 'must be a video mime type' }),
  size: z.number().int().positive(),
  durationSeconds: z.number().positive().refine(Number.isFinite, { message: 'must be finite' }),
  recordedAt: z.string().refine((value) => Number.isFinite(Date.parse(value)), { message: 'must be a date string' }),
  uploadedAt: z.string().refine((value) => Number.isFinite(Date.parse(value)), { message: 'must be a date string' }),
  provider: z.literal('cloudflare'),
  retakeCount: z.number().int().min(0).optional()
});

export const assessmentInteractionResponseSchema = z.discriminatedUnion('kind', [
  choiceResponseSchema,
  textResponseSchema,
  numericResponseSchema,
  fillBlankResponseSchema,
  wordBankResponseSchema,
  orderingResponseSchema,
  trueFalseGroupResponseSchema,
  fileUploadResponseSchema,
  linkResponseSchema,
  starRatingResponseSchema,
  videoRecordingResponseSchema
]);

export type AssessmentInteractionResponse = z.infer<typeof assessmentInteractionResponseSchema>;

export const assessmentResponseEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  responses: z
    .array(
      z.strictObject({
        interactionId: z.string().min(1).max(MAX_ASSESSMENT_ID_LENGTH),
        response: assessmentInteractionResponseSchema
      })
    )
    .max(MAX_ASSESSMENT_INTERACTIONS)
});

export type AssessmentResponseEnvelope = z.infer<typeof assessmentResponseEnvelopeSchema>;

export interface ValidatedAssessmentResponses {
  responsesByInteractionId: ReadonlyMap<string, AssessmentInteractionResponse>;
  /** Optional interactions the student explicitly left unanswered (FR-14). */
  missingOptionalInteractionIds: string[];
}

export type AssessmentResponseValidationOptions = {
  requireCompleteTrueFalseGroups?: boolean;
};

function normalizeBankToken(value: string): string {
  return value.trim().toLowerCase();
}

function textCharacterCount(text: string, format: 'rich' | 'plain'): number {
  return format === 'rich' ? getTextareaAnswerCharacterCount(text) : text.trim().length;
}

/** Config-bound semantic checks; assumes kind already matches the interaction. */
function collectConstraintIssues(
  interaction: AssessmentInteraction,
  response: AssessmentInteractionResponse,
  path: Array<string | number>
): AssessmentIssue[] {
  const issues: AssessmentIssue[] = [];
  const constraint = (message: string) => issues.push(assessmentIssue('RESPONSE_CONSTRAINT', path, message));

  switch (interaction.kind) {
    case 'choice': {
      if (response.kind !== 'choice') return issues;

      const optionIds = new Set(interaction.config.options.map((option) => option.id));
      if (!isUnique(response.selectedOptionIds)) constraint('Selected options must be unique');
      if (interaction.config.cardinality === 'single' && response.selectedOptionIds.length !== 1) {
        constraint('Single choice accepts exactly one selection');
      }
      if (!response.selectedOptionIds.every((selectedId) => optionIds.has(selectedId))) {
        constraint('Selected options must reference declared options');
      }

      return issues;
    }
    case 'text': {
      if (response.kind !== 'text') return issues;

      const characterCount = textCharacterCount(response.text, interaction.config.format);
      const { minCharacters, maxCharacters } = interaction.config;
      if (minCharacters !== undefined && characterCount < minCharacters) {
        constraint(`Answer must be at least ${minCharacters} characters`);
      }
      if (maxCharacters !== undefined && characterCount > maxCharacters) {
        constraint(`Answer must be at most ${maxCharacters} characters`);
      }

      return issues;
    }
    case 'numeric':
      return issues;
    case 'fill_blank': {
      if (response.kind !== 'fill_blank') return issues;

      if (response.values.length !== interaction.config.acceptedAnswers.length) {
        constraint('Answer count must match the number of blanks');
      }

      return issues;
    }
    case 'word_bank': {
      if (response.kind !== 'word_bank') return issues;

      if (response.filledBlanks.length !== interaction.config.correctAnswers.length) {
        constraint('Answer count must match the number of blanks');
      } else {
        const bank = new Set(
          [...interaction.config.correctAnswers, ...interaction.config.distractors].map(normalizeBankToken)
        );
        if (!response.filledBlanks.every((filled) => bank.has(normalizeBankToken(filled)))) {
          constraint('Answers must come from the word bank');
        }
      }

      return issues;
    }
    case 'ordering': {
      if (response.kind !== 'ordering') return issues;

      const optionIds = interaction.config.options.map((option) => option.id);
      if (!isExactStringPermutation(response.orderedOptionIds, optionIds)) {
        constraint('Order must be an exact permutation of the options');
      }

      return issues;
    }
    case 'true_false_group': {
      if (response.kind !== 'true_false_group') return issues;

      const statementIds = new Set(interaction.config.statements.map((statement) => statement.id));
      const responseStatementIds = response.answers.map((answer) => answer.statementId);
      if (!isUnique(responseStatementIds)) constraint('Statement answers must be unique');
      if (!responseStatementIds.every((statementId) => statementIds.has(statementId))) {
        constraint('Statement answers must reference declared statements');
      }

      return issues;
    }
    case 'file_upload': {
      if (response.kind !== 'file_upload') return issues;

      const allowed = isFileUploadTypeAllowed(
        { fileName: response.fileName, mimeType: response.mimeType },
        interaction.config.acceptedTypes
      );
      if (!allowed) constraint('File type is not accepted for this interaction');
      if (interaction.config.maxSizeMb !== undefined && response.size > interaction.config.maxSizeMb * 1024 * 1024) {
        constraint(`File size cannot exceed ${interaction.config.maxSizeMb} MB`);
      }

      return issues;
    }
    case 'link':
      return issues;
    case 'star_rating':
      if (response.kind === 'star_rating' && response.value > interaction.config.maxStars) {
        constraint(`Rating cannot exceed ${interaction.config.maxStars} stars`);
      }

      return issues;
    case 'video_recording':
      if (response.kind === 'video_recording' && response.durationSeconds > interaction.config.maxDurationSeconds + 2) {
        // Two-second grace mirrors the existing submission service tolerance.
        constraint('Recording exceeds the configured duration');
      }

      return issues;
  }

  interaction satisfies never;
  return issues;
}

/** A present response that carries no answerable content (required-check input). */
function isMeaningfulResponse(interaction: AssessmentInteraction, response: AssessmentInteractionResponse): boolean {
  switch (interaction.kind) {
    case 'choice':
      return response.kind === 'choice' && response.selectedOptionIds.length > 0;
    case 'text':
      return response.kind === 'text' && textCharacterCount(response.text, interaction.config.format) > 0;
    case 'numeric':
      return response.kind === 'numeric';
    case 'fill_blank':
      return response.kind === 'fill_blank' && response.values.some((value) => value.trim().length > 0);
    case 'word_bank':
      return (
        response.kind === 'word_bank' &&
        response.filledBlanks.length > 0 &&
        response.filledBlanks.every((value) => value.trim().length > 0)
      );
    case 'ordering':
      return response.kind === 'ordering' && response.orderedOptionIds.length > 0;
    case 'true_false_group':
      return response.kind === 'true_false_group' && response.answers.length > 0;
    case 'file_upload':
      return response.kind === 'file_upload';
    case 'link':
      return response.kind === 'link' && response.urls.length > 0;
    case 'star_rating':
      return response.kind === 'star_rating';
    case 'video_recording':
      return response.kind === 'video_recording';
  }

  interaction satisfies never;
  return false;
}

/**
 * Validates a response envelope against a parsed definition. Deterministic
 * stages: structural parse, duplicate detection (before any Map is built),
 * unknown-id, kind cross-check, config-bound constraints, required checks.
 * Never evaluates author-provided expressions.
 */
export function validateAssessmentResponseEnvelope(
  definition: AssessmentItemDefinition,
  value: unknown,
  options: AssessmentResponseValidationOptions = {}
): AssessmentResult<ValidatedAssessmentResponses> {
  if (!isRecord(value)) {
    return assessmentFailure([assessmentIssue('MALFORMED_RESPONSE', [], 'Response envelope must be an object')]);
  }

  if (value.schemaVersion !== 1) {
    return assessmentFailure([
      assessmentIssue(
        'UNSUPPORTED_SCHEMA_VERSION',
        ['schemaVersion'],
        `Unsupported response envelope schema version: ${String(value.schemaVersion)}`
      )
    ]);
  }

  const parsed = assessmentResponseEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    return assessmentFailure(zodIssuesToAssessmentIssues(parsed.error, () => 'MALFORMED_RESPONSE'));
  }

  // Duplicate detection runs on the raw entry array before any Map exists.
  const duplicateIssues: AssessmentIssue[] = [];
  const seenInteractionIds = new Set<string>();
  parsed.data.responses.forEach((entry, entryIndex) => {
    if (seenInteractionIds.has(entry.interactionId)) {
      duplicateIssues.push(
        assessmentIssue(
          'DUPLICATE_RESPONSE_ENTRY',
          ['responses', entryIndex, 'interactionId'],
          `Duplicate response for interaction "${entry.interactionId}"`
        )
      );
    }
    seenInteractionIds.add(entry.interactionId);
  });
  if (duplicateIssues.length > 0) return assessmentFailure(duplicateIssues);

  const interactionBlocks = getAssessmentInteractionBlocks(definition);
  const interactionsById = new Map(interactionBlocks.map((block) => [block.id, block.interaction]));

  const issues: AssessmentIssue[] = [];
  const responsesByInteractionId = new Map<string, AssessmentInteractionResponse>();

  parsed.data.responses.forEach((entry, entryIndex) => {
    const entryPath: Array<string | number> = ['responses', entryIndex];
    const interaction = interactionsById.get(entry.interactionId);
    if (!interaction) {
      issues.push(
        assessmentIssue(
          'UNKNOWN_INTERACTION',
          [...entryPath, 'interactionId'],
          `No interaction with id "${entry.interactionId}"`
        )
      );
      return;
    }

    if (interaction.kind !== entry.response.kind) {
      issues.push(
        assessmentIssue(
          'RESPONSE_KIND_MISMATCH',
          [...entryPath, 'response', 'kind'],
          `Interaction "${entry.interactionId}" expects a ${interaction.kind} response`
        )
      );
      return;
    }

    issues.push(...collectConstraintIssues(interaction, entry.response, [...entryPath, 'response']));
    if (
      options.requireCompleteTrueFalseGroups &&
      interaction.kind === 'true_false_group' &&
      entry.response.kind === 'true_false_group' &&
      entry.response.answers.length > 0 &&
      entry.response.answers.length !== interaction.config.statements.length
    ) {
      issues.push(
        assessmentIssue(
          'MISSING_REQUIRED_RESPONSE',
          [...entryPath, 'response', 'answers'],
          `Interaction "${entry.interactionId}" must answer every statement once started`
        )
      );
    }
    responsesByInteractionId.set(entry.interactionId, entry.response);
  });

  const missingOptionalInteractionIds: string[] = [];
  for (const block of interactionBlocks) {
    const response = responsesByInteractionId.get(block.id);
    const meaningful = response !== undefined && isMeaningfulResponse(block.interaction, response);

    if (!block.interaction.required) {
      if (response === undefined) missingOptionalInteractionIds.push(block.id);
      continue;
    }
    if (!meaningful) {
      issues.push(
        assessmentIssue('MISSING_REQUIRED_RESPONSE', ['responses'], `Interaction "${block.id}" requires an answer`)
      );
    }
  }

  if (issues.length > 0) return assessmentFailure(issues);

  return assessmentSuccess({ responsesByInteractionId, missingOptionalInteractionIds });
}
