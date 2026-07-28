import { MAX_AUTHORED_HTML_LENGTH, MAX_INTERACTION_OPTIONS } from '@cio/question-types';
import * as z from 'zod';
import {
  examImportDraftSchema,
  examImportFieldTargetSchema,
  requiresExamImportAnswerKey,
  type ExamImportDraft,
  type ExamImportFieldState,
  type ExamImportFieldTarget,
  type ExamImportQuestion
} from './exam-import-draft';
import {
  synchronizeExamImportDraftReviewStates,
  type ExamImportSemanticValidationContext
} from './exam-import-validation';

export const MAX_EXAM_IMPORT_DRAFT_PATCH_OPERATIONS = 500;

export const examImportAnswerKeyPatchSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('choice'),
    correctOptionIds: z.array(z.string().min(1)).min(1).max(MAX_INTERACTION_OPTIONS)
  }),
  z.strictObject({
    kind: z.literal('true_false_group'),
    answers: z
      .array(z.strictObject({ statementId: z.string().min(1), correctValue: z.boolean() }))
      .min(2)
      .max(MAX_INTERACTION_OPTIONS)
  }),
  z.strictObject({
    kind: z.literal('short_answer'),
    acceptedAnswers: z.array(z.string().trim().min(1).max(MAX_AUTHORED_HTML_LENGTH)).min(1).max(MAX_INTERACTION_OPTIONS)
  }),
  z.strictObject({
    kind: z.literal('numeric'),
    value: z.number().finite(),
    tolerance: z.number().finite().min(0).nullable()
  })
]);

export type ExamImportAnswerKeyPatch = z.infer<typeof examImportAnswerKeyPatchSchema>;

const examImportSetFieldOperationSchema = z.strictObject({
  target: examImportFieldTargetSchema,
  value: z.unknown()
});

const examImportRemoveQuestionOperationSchema = z.strictObject({
  operation: z.literal('remove_question'),
  questionId: z.string().min(1)
});

const examImportConfirmQuestionOperationSchema = z.strictObject({
  operation: z.literal('confirm_question'),
  questionId: z.string().min(1)
});

export const examImportDraftPatchOperationSchema = z.union([
  examImportSetFieldOperationSchema,
  examImportRemoveQuestionOperationSchema,
  examImportConfirmQuestionOperationSchema
]);

export type ExamImportDraftPatchOperation = z.infer<typeof examImportDraftPatchOperationSchema>;

export type ExamImportDraftPatchErrorCode =
  | 'INVALID_ANSWER_KEY'
  | 'INVALID_PATCH'
  | 'QUESTION_NOT_CONFIRMABLE'
  | 'TARGET_NOT_FOUND'
  | 'UNSUPPORTED_KIND_CHANGE';

export class ExamImportDraftPatchError extends Error {
  constructor(
    readonly code: ExamImportDraftPatchErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ExamImportDraftPatchError';
  }
}

function sameTarget(left: ExamImportFieldTarget, right: ExamImportFieldTarget): boolean {
  if (left.kind !== right.kind) return false;

  switch (left.kind) {
    case 'draft_field':
      return right.kind === left.kind && left.field === right.field;
    case 'shared_content_field':
      return right.kind === left.kind && left.contentId === right.contentId && left.field === right.field;
    case 'section_field':
      return right.kind === left.kind && left.sectionId === right.sectionId && left.field === right.field;
    case 'question_field':
      return right.kind === left.kind && left.questionId === right.questionId && left.field === right.field;
    case 'option_field':
      return (
        right.kind === left.kind &&
        left.questionId === right.questionId &&
        left.optionId === right.optionId &&
        left.field === right.field
      );
    case 'statement_field':
      return (
        right.kind === left.kind &&
        left.questionId === right.questionId &&
        left.statementId === right.statementId &&
        left.field === right.field
      );
  }
}

function questionById(draft: ExamImportDraft, questionId: string): ExamImportQuestion {
  const question = draft.sections
    .flatMap((section) => section.questions)
    .find((candidate) => candidate.id === questionId);
  if (!question) {
    throw new ExamImportDraftPatchError('TARGET_NOT_FOUND', `Question "${questionId}" was not found`);
  }

  return question;
}

function mutableRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function targetBelongsToQuestion(target: ExamImportFieldTarget, questionId: string): boolean {
  switch (target.kind) {
    case 'question_field':
    case 'option_field':
    case 'statement_field':
      return target.questionId === questionId;
    case 'draft_field':
    case 'shared_content_field':
    case 'section_field':
      return false;
  }
}

function applyTeacherAnswerKey(question: ExamImportQuestion, value: unknown): void {
  if (question.kind === 'essay' || question.kind === 'unresolved') {
    throw new ExamImportDraftPatchError(
      'INVALID_ANSWER_KEY',
      `Question "${question.id}" does not accept an answer key`
    );
  }

  const parsed = examImportAnswerKeyPatchSchema.safeParse(value);
  if (!parsed.success || parsed.data.kind !== question.kind) {
    throw new ExamImportDraftPatchError(
      'INVALID_ANSWER_KEY',
      `Answer key does not match question "${question.id}" kind`
    );
  }

  const candidateId = 'teacher-answer';
  const candidateBase = {
    id: candidateId,
    source: 'teacher' as const,
    provenance: question.provenance
  };
  const answerKeyBase = {
    agreement: 'single_source' as const,
    selectedCandidateIds: [candidateId],
    conflictingCandidateIds: []
  };

  switch (question.kind) {
    case 'choice': {
      if (parsed.data.kind !== 'choice') {
        throw new ExamImportDraftPatchError('INVALID_ANSWER_KEY', 'Choice answer key is required');
      }
      question.answerCandidates = [
        ...question.answerCandidates.filter((candidate) => candidate.id !== candidateId),
        {
          ...candidateBase,
          kind: 'choice',
          correctOptionIds: parsed.data.correctOptionIds
        }
      ];
      question.answerKey = {
        ...answerKeyBase,
        kind: 'choice',
        correctOptionIds: parsed.data.correctOptionIds
      };
      return;
    }
    case 'true_false_group': {
      if (parsed.data.kind !== 'true_false_group') {
        throw new ExamImportDraftPatchError('INVALID_ANSWER_KEY', 'True-false group answer key is required');
      }
      question.answerCandidates = [
        ...question.answerCandidates.filter((candidate) => candidate.id !== candidateId),
        {
          ...candidateBase,
          kind: 'true_false_group',
          answers: parsed.data.answers
        }
      ];
      question.answerKey = {
        ...answerKeyBase,
        kind: 'true_false_group',
        answers: parsed.data.answers
      };
      return;
    }
    case 'short_answer': {
      if (parsed.data.kind !== 'short_answer') {
        throw new ExamImportDraftPatchError('INVALID_ANSWER_KEY', 'Short answer key is required');
      }
      question.answerCandidates = [
        ...question.answerCandidates.filter((candidate) => candidate.id !== candidateId),
        {
          ...candidateBase,
          kind: 'short_answer',
          acceptedAnswers: parsed.data.acceptedAnswers
        }
      ];
      question.answerKey = {
        ...answerKeyBase,
        kind: 'short_answer',
        acceptedAnswers: parsed.data.acceptedAnswers
      };
      return;
    }
    case 'numeric': {
      if (parsed.data.kind !== 'numeric') {
        throw new ExamImportDraftPatchError('INVALID_ANSWER_KEY', 'Numeric answer key is required');
      }
      question.answerCandidates = [
        ...question.answerCandidates.filter((candidate) => candidate.id !== candidateId),
        {
          ...candidateBase,
          kind: 'numeric',
          value: parsed.data.value,
          tolerance: parsed.data.tolerance
        }
      ];
      question.answerKey = {
        ...answerKeyBase,
        kind: 'numeric',
        value: parsed.data.value,
        tolerance: parsed.data.tolerance
      };
      return;
    }
  }
}

function applyOperation(draft: ExamImportDraft, operation: ExamImportDraftPatchOperation): void {
  if ('operation' in operation) {
    if (operation.operation === 'confirm_question') {
      const question = questionById(draft, operation.questionId);
      if (question.kind === 'unresolved' || (requiresExamImportAnswerKey(question) && question.answerKey === null)) {
        throw new ExamImportDraftPatchError(
          'QUESTION_NOT_CONFIRMABLE',
          `Question "${operation.questionId}" must be resolved before confirmation`
        );
      }

      question.confidence = 'teacher_confirmed';
      for (const fieldState of draft.fieldStates) {
        if (targetBelongsToQuestion(fieldState.target, operation.questionId)) {
          fieldState.confidence = 'teacher_confirmed';
          fieldState.origin = 'teacher';
        }
      }
      if (requiresExamImportAnswerKey(question)) {
        markTeacherConfirmed(draft, {
          kind: 'question_field',
          questionId: operation.questionId,
          field: 'answerKey'
        });
      }
      return;
    }

    const section = draft.sections.find((candidate) =>
      candidate.questions.some((question) => question.id === operation.questionId)
    );
    if (!section) {
      throw new ExamImportDraftPatchError('TARGET_NOT_FOUND', `Question "${operation.questionId}" was not found`);
    }

    section.questions = section.questions.filter((question) => question.id !== operation.questionId);
    draft.fieldStates = draft.fieldStates.filter((fieldState) => {
      const target = fieldState.target;
      return !(
        (target.kind === 'question_field' || target.kind === 'option_field' || target.kind === 'statement_field') &&
        target.questionId === operation.questionId
      );
    });
    draft.diagnostics = draft.diagnostics.filter((diagnostic) => diagnostic.questionId !== operation.questionId);
    return;
  }

  const { target, value } = operation;

  switch (target.kind) {
    case 'draft_field':
      mutableRecord(draft)[target.field] = structuredClone(value);
      return;
    case 'shared_content_field': {
      const content = draft.sharedContents.find((candidate) => candidate.id === target.contentId);
      if (!content) {
        throw new ExamImportDraftPatchError('TARGET_NOT_FOUND', `Shared content "${target.contentId}" was not found`);
      }
      mutableRecord(content)[target.field] = structuredClone(value);
      return;
    }
    case 'section_field': {
      const section = draft.sections.find((candidate) => candidate.id === target.sectionId);
      if (!section) {
        throw new ExamImportDraftPatchError('TARGET_NOT_FOUND', `Section "${target.sectionId}" was not found`);
      }
      mutableRecord(section)[target.field] = structuredClone(value);
      return;
    }
    case 'question_field': {
      const question = questionById(draft, target.questionId);
      if (target.field === 'kind') {
        throw new ExamImportDraftPatchError(
          'UNSUPPORTED_KIND_CHANGE',
          'Question kind changes require an explicit conversion'
        );
      }
      if (target.field === 'answerKey') {
        applyTeacherAnswerKey(question, value);
        return;
      }
      mutableRecord(question)[target.field] = structuredClone(value);
      return;
    }
    case 'option_field': {
      const question = questionById(draft, target.questionId);
      if (question.kind !== 'choice') {
        throw new ExamImportDraftPatchError('TARGET_NOT_FOUND', `Question "${question.id}" has no choice options`);
      }
      const option = question.options.find((candidate) => candidate.id === target.optionId);
      if (!option) {
        throw new ExamImportDraftPatchError('TARGET_NOT_FOUND', `Option "${target.optionId}" was not found`);
      }
      mutableRecord(option)[target.field] = structuredClone(value);
      return;
    }
    case 'statement_field': {
      const question = questionById(draft, target.questionId);
      if (question.kind !== 'true_false_group') {
        throw new ExamImportDraftPatchError(
          'TARGET_NOT_FOUND',
          `Question "${question.id}" has no true-false statements`
        );
      }
      const statement = question.statements.find((candidate) => candidate.id === target.statementId);
      if (!statement) {
        throw new ExamImportDraftPatchError('TARGET_NOT_FOUND', `Statement "${target.statementId}" was not found`);
      }
      if (target.field === 'correctValue') {
        if (typeof value !== 'boolean' || question.answerKey === null) {
          throw new ExamImportDraftPatchError(
            'INVALID_ANSWER_KEY',
            'A statement answer requires an existing complete true-false answer key'
          );
        }
        const answers = question.answerKey.answers.map((answer) =>
          answer.statementId === target.statementId ? { ...answer, correctValue: value } : answer
        );
        applyTeacherAnswerKey(question, { kind: 'true_false_group', answers });
        return;
      }
      mutableRecord(statement)[target.field] = structuredClone(value);
      return;
    }
  }
}

function markTeacherConfirmed(draft: ExamImportDraft, target: ExamImportFieldTarget): void {
  const existingState = draft.fieldStates.find((fieldState) => sameTarget(fieldState.target, target));
  if (existingState) {
    existingState.confidence = 'teacher_confirmed';
    existingState.origin = 'teacher';
    return;
  }

  let provenance: ExamImportFieldState['provenance'] = [];
  if (target.kind === 'shared_content_field') {
    provenance = draft.sharedContents.find((content) => content.id === target.contentId)?.provenance ?? [];
  } else if (target.kind === 'question_field' || target.kind === 'option_field' || target.kind === 'statement_field') {
    provenance = questionById(draft, target.questionId).provenance;
  }

  draft.fieldStates.push({
    target,
    confidence: 'teacher_confirmed',
    origin: 'teacher',
    provenance
  });
}

export function applyExamImportDraftPatches(
  value: unknown,
  operationsValue: unknown,
  context: ExamImportSemanticValidationContext
): ExamImportDraft {
  const parsedDraft = examImportDraftSchema.safeParse(value);
  const parsedOperations = examImportDraftPatchOperationSchema
    .array()
    .min(1)
    .max(MAX_EXAM_IMPORT_DRAFT_PATCH_OPERATIONS)
    .safeParse(operationsValue);
  if (!parsedDraft.success || !parsedOperations.success) {
    throw new ExamImportDraftPatchError('INVALID_PATCH', 'Exam import draft patch is malformed');
  }

  const next = structuredClone(parsedDraft.data);
  for (const operation of parsedOperations.data) {
    applyOperation(next, operation);
    if ('operation' in operation) continue;

    markTeacherConfirmed(next, operation.target);
    next.diagnostics = next.diagnostics.filter(
      (diagnostic) => diagnostic.target === null || !sameTarget(diagnostic.target, operation.target)
    );
  }

  const reparsed = examImportDraftSchema.safeParse(next);
  if (!reparsed.success) {
    throw new ExamImportDraftPatchError(
      'INVALID_PATCH',
      `Exam import draft patch is invalid: ${reparsed.error.issues.map((issue) => issue.message).join('; ')}`
    );
  }

  return synchronizeExamImportDraftReviewStates(reparsed.data, context);
}
