import { AppError, ErrorCodes } from '@api/utils/errors';
import {
  QUESTION_TYPE_ID_TO_KEY,
  QUESTION_TYPE_KEY,
  assessmentResponseEnvelopeSchema,
  decodeApiPayload,
  getVideoRecordingMaxDurationSeconds,
  hasMeaningfulAnswerData,
  validateAssessmentResponseEnvelope,
  validateTextareaAnswer,
  type AssessmentItemDefinition,
  type AnswerData,
  type ExerciseQuestionModel
} from '@cio/question-types';

export type SubmissionAnswerPayload = {
  questionId: number;
  questionRevisionId?: string;
  optionId?: number;
  answer?: string;
  response?: unknown;
};

export type SubmissionQuestionDefinition = {
  id: number;
  title?: string | null;
  questionTypeId: number;
  points?: number | null;
  settings?: unknown;
  options?: Array<{
    id?: number | null;
    label?: string | null;
    value?: string | null;
    isCorrect?: boolean | null;
  }>;
};

export type PreparedSubmissionAnswers = {
  answers: Array<{ questionId: number; answerData: AnswerData }>;
  answerByQuestionId: ReadonlyMap<number, AnswerData>;
  questionById: ReadonlyMap<number, ExerciseQuestionModel>;
};

function toSettings(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toQuestionModel(question: SubmissionQuestionDefinition): ExerciseQuestionModel {
  const questionType = QUESTION_TYPE_ID_TO_KEY[question.questionTypeId];
  if (!questionType) {
    throw new AppError(`Unsupported question type for question ${question.id}`, ErrorCodes.INTERNAL_ERROR, 500);
  }

  return {
    id: question.id,
    title: String(question.title ?? ''),
    questionType,
    points: Number(question.points ?? 0),
    settings: toSettings(question.settings),
    options: (question.options ?? []).map((option) => ({
      id: option.id ?? undefined,
      label: option.label ?? '',
      value: option.value ?? undefined,
      isCorrect: option.isCorrect ?? false
    }))
  };
}

function validatePayloadShape(payload: SubmissionAnswerPayload, question: ExerciseQuestionModel): void {
  if (question.questionType === QUESTION_TYPE_KEY.ASSESSMENT_ITEM) {
    if (
      payload.questionRevisionId === undefined ||
      payload.optionId !== undefined ||
      payload.answer !== undefined ||
      payload.response === undefined
    ) {
      throw new AppError(
        `Question ${payload.questionId} requires a canonical assessment response and delivered revision`,
        ErrorCodes.VALIDATION_ERROR,
        400
      );
    }

    return;
  }

  if (payload.questionRevisionId !== undefined) {
    throw new AppError(
      `Question ${payload.questionId} does not accept a question revision field`,
      ErrorCodes.VALIDATION_ERROR,
      400
    );
  }

  if (question.questionType === QUESTION_TYPE_KEY.RADIO) {
    if (payload.answer !== undefined) {
      throw new AppError(
        `Question ${payload.questionId} does not accept a structured answer field`,
        ErrorCodes.VALIDATION_ERROR,
        400
      );
    }

    return;
  }

  if (payload.optionId !== undefined) {
    throw new AppError(
      `Question ${payload.questionId} does not accept an optionId field`,
      ErrorCodes.VALIDATION_ERROR,
      400
    );
  }
}

function validateAnswerConstraints(answerData: AnswerData, question: ExerciseQuestionModel): void {
  if (answerData.type === QUESTION_TYPE_KEY.TEXTAREA) {
    const validation = validateTextareaAnswer(answerData.text, question);
    if (!validation.isValid) {
      const message =
        validation.minCharacters !== undefined && validation.maxCharacters !== undefined
          ? `Paragraph answer must be between ${validation.minCharacters} and ${validation.maxCharacters} characters`
          : validation.reason === 'below_min' && validation.minCharacters !== undefined
            ? `Paragraph answer must be at least ${validation.minCharacters} characters`
            : `Paragraph answer must be at most ${validation.maxCharacters} characters`;

      throw new AppError(message, ErrorCodes.VALIDATION_ERROR, 400);
    }
  }

  if (answerData.type === QUESTION_TYPE_KEY.VIDEO_RECORDING) {
    const maxDurationSeconds = getVideoRecordingMaxDurationSeconds(question.settings);
    if (answerData.durationSeconds > maxDurationSeconds + 2) {
      throw new AppError('Recording exceeds the configured duration', ErrorCodes.VALIDATION_ERROR, 400);
    }
  }
}

export function prepareSubmissionAnswers(
  questions: readonly SubmissionQuestionDefinition[],
  payloads: readonly SubmissionAnswerPayload[],
  assessmentDefinitionsByQuestionId: ReadonlyMap<number, AssessmentItemDefinition> = new Map()
): PreparedSubmissionAnswers {
  const questionById = new Map<number, ExerciseQuestionModel>(
    questions.map((question) => [question.id, toQuestionModel(question)])
  );
  const answerByQuestionId = new Map<number, AnswerData>();
  const answers: Array<{ questionId: number; answerData: AnswerData }> = [];

  for (const payload of payloads) {
    if (answerByQuestionId.has(payload.questionId)) {
      throw new AppError(
        `Question ${payload.questionId} was answered more than once`,
        ErrorCodes.VALIDATION_ERROR,
        400
      );
    }

    const question = questionById.get(payload.questionId);
    if (!question) {
      throw new AppError(
        `Question ${payload.questionId} does not belong to this exercise`,
        ErrorCodes.VALIDATION_ERROR,
        400
      );
    }

    validatePayloadShape(payload, question);
    if (question.questionType === QUESTION_TYPE_KEY.ASSESSMENT_ITEM) {
      const definition = assessmentDefinitionsByQuestionId.get(payload.questionId);
      if (!definition) {
        throw new AppError(
          `Question ${payload.questionId} has no canonical assessment definition`,
          ErrorCodes.INTERNAL_ERROR,
          500
        );
      }

      const parsedResponse = assessmentResponseEnvelopeSchema.safeParse(payload.response);
      if (!parsedResponse.success) {
        throw new AppError(
          `Invalid assessment response for question ${payload.questionId}`,
          ErrorCodes.VALIDATION_ERROR,
          400
        );
      }

      const validation = validateAssessmentResponseEnvelope(definition, parsedResponse.data);
      if (!validation.success) {
        throw new AppError(
          `Invalid assessment response for question ${payload.questionId}: ${validation.issues[0]?.message ?? 'unknown error'}`,
          ErrorCodes.VALIDATION_ERROR,
          400
        );
      }

      const answerData: AnswerData = { type: QUESTION_TYPE_KEY.ASSESSMENT_ITEM, response: parsedResponse.data };
      answerByQuestionId.set(payload.questionId, answerData);
      answers.push({ questionId: payload.questionId, answerData });
      continue;
    }

    const decoded = decodeApiPayload(question.questionType, payload, question);
    if (!decoded.success) {
      throw new AppError(`${decoded.message} for question ${payload.questionId}`, ErrorCodes.VALIDATION_ERROR, 400);
    }

    const isRequired = toSettings(question.settings).required !== false;
    if (isRequired && !hasMeaningfulAnswerData(decoded.data)) {
      throw new AppError(`Question ${payload.questionId} requires an answer`, ErrorCodes.VALIDATION_ERROR, 400);
    }

    validateAnswerConstraints(decoded.data, question);
    answerByQuestionId.set(payload.questionId, decoded.data);
    answers.push({ questionId: payload.questionId, answerData: decoded.data });
  }

  for (const question of questions) {
    const settings = toSettings(question.settings);
    if (settings.required === false || answerByQuestionId.has(question.id)) continue;

    throw new AppError(`Question ${question.id} requires an answer`, ErrorCodes.VALIDATION_ERROR, 400);
  }

  return { answers, answerByQuestionId, questionById };
}
