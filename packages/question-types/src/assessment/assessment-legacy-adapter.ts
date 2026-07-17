import type { ExerciseQuestionModel, ExerciseQuestionOption } from '../exercise-types';
import { resolveAllowedFileUploadMimeTypes } from '../file-upload-settings';
import { QUESTION_TYPE_KEY } from '../question-type-keys';
import { getExpectedOrderingValues, getOrderingItems } from '../question-scoring';
import { getStarRatingMaxFromSettings, isValidStarRatingValue } from '../star-rating-settings';
import { getTextareaCharacterLimits } from '../textarea-validation';
import { getTrueFalseOptionValue, resolveTrueFalseCorrectValue } from '../true-false-answer-key';
import { getVideoRecordingMaxDurationSeconds } from '../video-recording-settings';
import { roundToTwoDecimals } from './assessment-capabilities';
import { assessmentFailure, assessmentIssue, type AssessmentResult } from './assessment-errors';
import type { AssessmentInteraction, AssessmentItemDefinition } from './assessment-item-schema';
import { parseAssessmentItemDefinition } from './assessment-item-validation';

/**
 * Pure legacy adapter: maps every enabled question type to an equivalent
 * one-interaction canonical item. Deterministic (same input, same output and
 * canonical serialization) — revision materialization depends on it.
 *
 * Semantics parity notes:
 * - The answer key mirrors what the legacy scorer actually uses; rows whose
 *   key the scorer treats as "always zero" map to a null key, never to a
 *   different value.
 * - Presentation-only settings (description, imageUrl(s), videoUrl(s)) are
 *   intentionally NOT materialized; legacy rendering stays on the legacy row
 *   until a canonical media/content rendering path exists.
 * - Disabled prototypes (MATCHING, HOTSPOT) and the internal ASSESSMENT_ITEM
 *   type fail with UNSUPPORTED_LEGACY_TYPE instead of being coerced.
 */

/** The adapter always emits a single interaction block under this id. */
export const LEGACY_ADAPTER_INTERACTION_BLOCK_ID = 'interaction-1';

type Settings = Record<string, unknown>;

function toSettings(question: ExerciseQuestionModel): Settings {
  const settings = question.settings;
  return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
}

function parseFiniteNumber(raw: unknown): number {
  const parsed = typeof raw === 'number' ? raw : raw != null ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function optionalInstructions(settings: Settings): string | undefined {
  const raw = settings.instructions;
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

function toTrimmedStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((entry) => String(entry).trim()).filter(Boolean);
}

function choiceOptions(options: readonly ExerciseQuestionOption[]): Array<{ id: string; html: string }> {
  return options.map((option, index) => ({
    id: option.id != null ? String(option.id) : `option-${index + 1}`,
    html: option.label ?? ''
  }));
}

function correctChoiceOptionIds(options: readonly ExerciseQuestionOption[]): string[] {
  return choiceOptions(options)
    .filter((_, index) => options[index]?.isCorrect === true)
    .map((option) => option.id);
}

function trueFalseOptionLabel(
  options: readonly ExerciseQuestionOption[] | undefined,
  target: boolean,
  fallback: string
): string {
  const match = options?.find((option) => getTrueFalseOptionValue(option) === target);
  return match?.label || fallback;
}

function buildInteraction(question: ExerciseQuestionModel): AssessmentInteraction | null {
  const settings = toSettings(question);
  const options = question.options ?? [];

  switch (question.questionType) {
    case QUESTION_TYPE_KEY.RADIO:
      return {
        kind: 'choice',
        ...baseFields(question),
        config: {
          cardinality: 'single',
          presentation: 'list',
          options: choiceOptions(options),
          correctOptionIds: correctChoiceOptionIds(options)
        }
      };
    case QUESTION_TYPE_KEY.CHECKBOX:
      return {
        kind: 'choice',
        ...baseFields(question),
        config: {
          cardinality: 'multiple',
          presentation: 'list',
          options: choiceOptions(options),
          correctOptionIds: correctChoiceOptionIds(options)
        }
      };
    case QUESTION_TYPE_KEY.TRUE_FALSE: {
      const correctValue = resolveTrueFalseCorrectValue(settings, options);
      return {
        kind: 'choice',
        ...baseFields(question),
        config: {
          cardinality: 'single',
          presentation: 'true_false',
          options: [
            { id: 'true', html: trueFalseOptionLabel(options, true, 'True') },
            { id: 'false', html: trueFalseOptionLabel(options, false, 'False') }
          ],
          correctOptionIds: [String(correctValue)]
        }
      };
    }
    case QUESTION_TYPE_KEY.TEXTAREA: {
      const { minCharacters, maxCharacters } = getTextareaCharacterLimits(question);
      return {
        kind: 'text',
        ...baseFields(question),
        config: {
          format: 'rich',
          ...(minCharacters !== undefined ? { minCharacters } : {}),
          ...(maxCharacters !== undefined ? { maxCharacters } : {})
        }
      };
    }
    case QUESTION_TYPE_KEY.SHORT_ANSWER: {
      const instructions = optionalInstructions(settings);
      return {
        kind: 'text',
        ...baseFields(question),
        config: { format: 'plain', ...(instructions !== undefined ? { instructions } : {}) }
      };
    }
    case QUESTION_TYPE_KEY.NUMERIC: {
      const correctValue = parseFiniteNumber(settings.correctValue);
      const rawTolerance = settings.tolerance;
      const tolerance = rawTolerance == null ? 0 : parseFiniteNumber(rawTolerance);
      const hasValidKey = Number.isFinite(correctValue) && Number.isFinite(tolerance) && tolerance >= 0;
      return {
        kind: 'numeric',
        ...baseFields(question),
        config: hasValidKey ? { correctValue, tolerance } : { correctValue: null, tolerance: 0 }
      };
    }
    case QUESTION_TYPE_KEY.FILL_BLANK: {
      const acceptedAnswers = String(settings.acceptedAnswers ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      return { kind: 'fill_blank', ...baseFields(question), config: { acceptedAnswers } };
    }
    case QUESTION_TYPE_KEY.WORD_BANK:
      return {
        kind: 'word_bank',
        ...baseFields(question),
        config: {
          template: String(settings.template ?? ''),
          correctAnswers: toTrimmedStringArray(settings.correctAnswers),
          distractors: toTrimmedStringArray(settings.distractors)
        }
      };
    case QUESTION_TYPE_KEY.ORDERING: {
      const orderingItems = getOrderingItems(question);
      return {
        kind: 'ordering',
        ...baseFields(question),
        config: {
          options: orderingItems.map((item) => ({ id: item.answerValue, html: item.label })),
          correctOrder: getExpectedOrderingValues(question)
        }
      };
    }
    case QUESTION_TYPE_KEY.FILE_UPLOAD: {
      const rawMaxSizeMb = settings.maxSizeMb;
      const maxSizeMb = typeof rawMaxSizeMb === 'number' && rawMaxSizeMb > 0 ? rawMaxSizeMb : undefined;
      return {
        kind: 'file_upload',
        ...baseFields(question),
        config: {
          acceptedTypes: [...resolveAllowedFileUploadMimeTypes(settings.acceptedTypes)],
          ...(maxSizeMb !== undefined ? { maxSizeMb } : {})
        }
      };
    }
    case QUESTION_TYPE_KEY.LINK: {
      const instructions = optionalInstructions(settings);
      return {
        kind: 'link',
        ...baseFields(question),
        config: instructions !== undefined ? { instructions } : {}
      };
    }
    case QUESTION_TYPE_KEY.STAR: {
      const maxStars = getStarRatingMaxFromSettings(settings);
      const rawCorrect = settings.correctValue;
      const correct =
        typeof rawCorrect === 'number' ? rawCorrect : rawCorrect != null ? Number(rawCorrect) : Number.NaN;
      return {
        kind: 'star_rating',
        ...baseFields(question),
        config: { maxStars, correctValue: isValidStarRatingValue(correct, maxStars) ? correct : null }
      };
    }
    case QUESTION_TYPE_KEY.VIDEO_RECORDING:
      return {
        kind: 'video_recording',
        ...baseFields(question),
        config: { maxDurationSeconds: getVideoRecordingMaxDurationSeconds(settings) }
      };
    default:
      return null;
  }
}

function baseFields(question: ExerciseQuestionModel): {
  prompt: { format: 'html'; html: string };
  required: boolean;
  maxScore: number;
} {
  return {
    prompt: { format: 'html', html: question.title },
    required: toSettings(question).required !== false,
    maxScore: roundToTwoDecimals(Number(question.points ?? 0))
  };
}

/**
 * Converts an enabled legacy question into its canonical one-interaction
 * item. Output is self-checked through the structural parser so callers can
 * rely on adapter output always being a valid schema-version-1 definition.
 */
export function legacyQuestionToAssessmentItem(
  question: ExerciseQuestionModel
): AssessmentResult<AssessmentItemDefinition> {
  const interaction = buildInteraction(question);
  if (!interaction) {
    return assessmentFailure([
      assessmentIssue(
        'UNSUPPORTED_LEGACY_TYPE',
        [],
        `Question type "${question.questionType}" has no canonical adapter`
      )
    ]);
  }

  const definition: AssessmentItemDefinition = {
    schemaVersion: 1,
    blocks: [{ id: LEGACY_ADAPTER_INTERACTION_BLOCK_ID, kind: 'interaction', interaction }],
    feedback: []
  };

  // Self-check keeps the "adapter output always parses" invariant honest;
  // a failure here means degenerate row data (e.g. duplicate ordering values).
  return parseAssessmentItemDefinition(definition);
}
