import * as z from 'zod';
import { assessmentResponseEnvelopeSchema } from '@cio/question-types';

import {
  ENABLED_QUESTION_TYPE_REGISTRY,
  MAX_INTERACTION_MAX_SCORE,
  VIDEO_RECORDING_PLATFORM_MAX_DURATION_SECONDS,
  getStarRatingMaxFromSettings,
  isValidStarRatingValue
} from '@cio/question-types';

import { QUESTION_TYPE } from '../constants';
import { ZSlug } from '../shared/slug';
import { ZExerciseSection } from './exercise-section';
import { ZAssessmentItemMutation } from './assessment-item';

const ENABLED_EXERCISE_QUESTION_TYPE_IDS = ENABLED_QUESTION_TYPE_REGISTRY.map((type) => type.id);
const ENABLED_EXERCISE_QUESTION_TYPE_ID_SET = new Set(ENABLED_EXERCISE_QUESTION_TYPE_IDS);

export const ZExerciseQuestionTypeId = z
  .number()
  .int()
  .refine((questionTypeId) => ENABLED_EXERCISE_QUESTION_TYPE_ID_SET.has(questionTypeId), {
    message: `Question type must be one of: ${ENABLED_EXERCISE_QUESTION_TYPE_IDS.join(', ')}`
  });
export type TExerciseQuestionTypeId = z.infer<typeof ZExerciseQuestionTypeId>;

// Authored points stay integers (existing route contract) and are capped at the
// canonical interaction maximum so the first student submission can never fail
// materialization against the kernel's maxScore bound.
export const ZExerciseQuestionPoints = z.number().int().min(0).max(MAX_INTERACTION_MAX_SCORE);

type QuestionRuleInput = {
  options?: Array<{ isCorrect: boolean }>;
  settings?: Record<string, unknown>;
};

const QUESTION_VALIDATION_RULES: Record<number, Array<(question: QuestionRuleInput) => string | null>> = {
  [QUESTION_TYPE.RADIO]: [
    (question) => {
      const options = question.options || [];
      if (options.length > 0 && options.length < 2) {
        return 'Options must have at least 2 items for RADIO/CHECKBOX questions';
      }
      return null;
    },
    (question) => {
      if (typeof question.settings?.correctValue === 'boolean') {
        return null;
      }

      const options = question.options || [];
      if (options.length > 0 && !options.some((opt) => opt.isCorrect === true)) {
        return 'Please mark an option as the correct answer';
      }
      return null;
    }
  ],
  [QUESTION_TYPE.CHECKBOX]: [
    (question) => {
      const options = question.options || [];
      if (options.length > 0 && options.length < 2) {
        return 'Options must have at least 2 items for RADIO/CHECKBOX questions';
      }
      return null;
    },
    (question) => {
      const options = question.options || [];
      if (options.length > 0 && !options.some((opt) => opt.isCorrect === true)) {
        return 'Please mark an option as the correct answer';
      }
      return null;
    }
  ],
  [QUESTION_TYPE.TRUE_FALSE]: [
    (question) => {
      const options = question.options || [];
      if (options.length > 0 && options.length < 2) {
        return 'True/False questions need both True and False options';
      }
      return null;
    },
    (question) => {
      const options = question.options || [];
      if (options.length > 0 && !options.some((opt) => opt.isCorrect === true)) {
        return 'Please mark an option as the correct answer';
      }
      return null;
    }
  ],
  [QUESTION_TYPE.TEXTAREA]: [],
  [QUESTION_TYPE.WORD_BANK]: [
    (question) => {
      const settings = question.settings;
      const template = String(settings?.template ?? '');
      const blankCount = (template.match(/_{3,}/g) ?? []).length;
      if (blankCount < 1) {
        return 'Word bank questions need at least one ___ blank in the template';
      }
      const raw = settings?.correctAnswers;
      const answers = Array.isArray(raw) ? (raw as unknown[]) : [];
      if (answers.length < blankCount) {
        return 'Provide a correct answer for each blank';
      }
      for (let i = 0; i < blankCount; i++) {
        if (!String(answers[i] ?? '').trim()) {
          return `Correct answer for blank ${i + 1} is required`;
        }
      }
      return null;
    }
  ],
  [QUESTION_TYPE.STAR]: [
    (question) => {
      const settings = question.settings ?? {};
      const maxStars = getStarRatingMaxFromSettings(settings);
      const rawCorrect = settings.correctValue;
      const correct = typeof rawCorrect === 'number' ? rawCorrect : rawCorrect != null ? Number(rawCorrect) : NaN;
      if (!isValidStarRatingValue(correct, maxStars)) {
        return 'Set a correct star value from 1 up to the maximum number of stars';
      }

      return null;
    }
  ],
  [QUESTION_TYPE.VIDEO_RECORDING]: [
    (question) => {
      const settings = question.settings ?? {};
      const rawDuration = settings.maxDurationSeconds;
      const maxDurationSeconds =
        typeof rawDuration === 'number' ? rawDuration : rawDuration != null ? Number(rawDuration) : NaN;
      if (!Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0) {
        return 'Set a recording duration greater than 0 seconds';
      }
      if (maxDurationSeconds > VIDEO_RECORDING_PLATFORM_MAX_DURATION_SECONDS) {
        return `Recording duration cannot exceed ${VIDEO_RECORDING_PLATFORM_MAX_DURATION_SECONDS} seconds`;
      }

      return null;
    }
  ]
};

// Base schema for exercise update question (without refinement)
const ZExerciseUpdateQuestionBase = z.object({
  id: z.number().int().optional(),
  exerciseSectionId: z.string().uuid().nullable().optional(),
  question: z.string().min(1),
  questionTypeId: ZExerciseQuestionTypeId.optional(),
  points: ZExerciseQuestionPoints.optional(),
  order: z.number().int().min(0).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  deletedAt: z.string().optional(), // Marks question as deleted
  options: z
    .array(
      z.object({
        id: z.number().int().optional(),
        label: z.string().min(1),
        isCorrect: z.boolean(),
        settings: z.record(z.string(), z.unknown()).optional(),
        deletedAt: z.string().optional() // Marks option as deleted
      })
    )
    .optional()
});

function validateQuestionOptions(question: z.infer<typeof ZExerciseUpdateQuestionBase>, ctx: z.core.$RefinementCtx) {
  // Skip validation for deleted questions
  if (question.deletedAt) return;

  const rules = QUESTION_VALIDATION_RULES[question.questionTypeId ?? -1] ?? [];
  for (const rule of rules) {
    const message = rule(question);
    if (!message) continue;
    ctx.addIssue({
      code: 'custom',
      message,
      path: ['options']
    });
  }
}

// Final schema with validation refinement
const ZExerciseUpdateQuestion = ZExerciseUpdateQuestionBase.superRefine(validateQuestionOptions);

const ZCanonicalQuestionPlacement = z.object({
  id: z.number().int().positive(),
  exerciseSectionId: z.string().uuid().nullable(),
  order: z.number().int().min(0)
});

const ZCanonicalQuestionPlacements = z.array(ZCanonicalQuestionPlacement).superRefine((placements, ctx) => {
  const placementIds = new Set<number>();
  const placementOrderKeys = new Set<string>();

  for (const [placementIndex, placement] of placements.entries()) {
    if (placementIds.has(placement.id)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Canonical question placement IDs must be unique',
        path: [placementIndex, 'id']
      });
    }
    placementIds.add(placement.id);

    const placementOrderKey = `${placement.exerciseSectionId ?? 'unsectioned'}:${placement.order}`;
    if (placementOrderKeys.has(placementOrderKey)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Canonical question orders must be unique within each section',
        path: [placementIndex, 'order']
      });
    }
    placementOrderKeys.add(placementOrderKey);
  }
});

const ZExerciseCreateQuestionBase = z.object({
  question: z.string().min(1),
  questionTypeId: ZExerciseQuestionTypeId.optional(),
  points: ZExerciseQuestionPoints.optional(),
  order: z.number().int().min(0).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  options: z
    .array(
      z.object({
        label: z.string().min(1),
        isCorrect: z.boolean(),
        settings: z.record(z.string(), z.unknown()).optional()
      })
    )
    .optional()
});

const ZExerciseCreateQuestion = ZExerciseCreateQuestionBase.superRefine(validateQuestionOptions);

export const ZExerciseCreate = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  lessonId: z.string().optional(),
  sectionId: z.string().optional(),
  order: z.number().int().optional(),
  courseId: z.string().min(1),
  dueBy: z.string().optional(),
  slug: ZSlug.optional(),
  questions: z.array(ZExerciseCreateQuestion).optional()
});
export type TExerciseCreate = z.infer<typeof ZExerciseCreate>;

export const ZExerciseUpdate = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  lessonId: z.string().optional(),
  sectionId: z.string().optional(),
  order: z.number().int().optional(),
  isUnlocked: z.boolean().optional(),
  dueBy: z.string().optional(), // Changed from iso.datetime() to string to match frontend format
  allowMultipleAttempts: z.boolean().optional(),
  slug: ZSlug.optional(),
  questions: z.array(ZExerciseUpdateQuestion).optional(),
  canonicalQuestionPlacements: ZCanonicalQuestionPlacements.optional(),
  assessmentItemMutations: z.array(ZAssessmentItemMutation).max(100).optional(),
  sections: z.array(ZExerciseSection).optional(),
  sectionDisplayMode: z.enum(['one_question', 'all_questions', 'learner_choice']).optional(),
  completionPolicy: z.enum(['submitted', 'passed']).optional(),
  passThreshold: z.number().int().min(0).max(100).optional()
});
export type TExerciseUpdate = z.infer<typeof ZExerciseUpdate>;

export const ZExerciseGetParam = z.object({
  exerciseId: z.string().uuid()
});
export type TExerciseGetParam = z.infer<typeof ZExerciseGetParam>;

export const ZExerciseListQuery = z.object({
  lessonId: z.string().optional(),
  sectionId: z.string().optional()
});
export type TExerciseListQuery = z.infer<typeof ZExerciseListQuery>;

// Exercise Submission Schemas
export const EXERCISE_SUBMISSION_MAX_ANSWER_CHARACTERS = 100_000;
export const EXERCISE_SUBMISSION_MAX_TOTAL_ANSWER_CHARACTERS = 1_000_000;

export function getExerciseSubmissionPayloadCharacterCount(
  answers: ReadonlyArray<{ answer?: string; response?: unknown }>
): number {
  return answers.reduce((total, answer) => {
    if (answer.response === undefined) return total + (answer.answer?.length ?? 0);

    try {
      return total + (answer.answer?.length ?? 0) + (JSON.stringify(answer.response)?.length ?? 0);
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }, 0);
}

export const ZExerciseSubmissionCreate = z.object({
  exerciseId: z.string().min(1),
  idempotencyKey: z.uuid().optional(),
  answers: z
    .array(
      z.object({
        questionId: z.number().int(),
        questionRevisionId: z.uuid().optional(),
        optionId: z.number().int().optional(),
        answer: z.string().max(EXERCISE_SUBMISSION_MAX_ANSWER_CHARACTERS).optional(),
        response: assessmentResponseEnvelopeSchema.optional()
      })
    )
    .max(500)
    .superRefine((answers, ctx) => {
      const totalAnswerCharacters = getExerciseSubmissionPayloadCharacterCount(answers);
      if (totalAnswerCharacters <= EXERCISE_SUBMISSION_MAX_TOTAL_ANSWER_CHARACTERS) return;

      ctx.addIssue({
        code: 'custom',
        message: 'Submission answers are too large'
      });
    })
});
export type TExerciseSubmissionCreate = z.infer<typeof ZExerciseSubmissionCreate>;

// Exercise Template Schemas
export const ZExerciseFromTemplate = z.object({
  lessonId: z.string().optional(),
  sectionId: z.string().optional(),
  order: z.number().int().optional(),
  templateId: z.number().int().min(1)
});

export type TExerciseFromTemplate = z.infer<typeof ZExerciseFromTemplate>;
