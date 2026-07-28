import * as z from 'zod';

import {
  MAX_EXAM_IMPORT_FIELD_STATES,
  MAX_EXAM_IMPORT_TOTAL_QUESTIONS,
  examImportDraftSchema,
  examImportQuestionSchema,
  requiresExamImportAnswerKey,
  type ExamImportDiagnostic,
  type ExamImportDraft,
  type ExamImportFieldState,
  type ExamImportQuestion,
  type ExamImportSourceSpan
} from './exam-import-draft';
import {
  validateExamImportDraft,
  type ExamImportValidationContext,
  type ExamImportValidationResult
} from './exam-import-validation';

const CONFLICT_DIAGNOSTIC_CODES = new Set([
  'ANSWER_SOURCE_CONFLICT',
  'ANSWER_SOURCE_CONFLICT_UNRESOLVED',
  'ANSWER_CONFLICT_REQUIRES_CONFIRMATION',
  'INVALID_CONFLICTING_CANDIDATE'
]);
const UNRECOGNIZED_SHAPE_DIAGNOSTIC_CODES = new Set(['QUESTION_STRUCTURE_UNRESOLVED', 'UNRECOGNIZED_QUESTION_SHAPE']);

export const MAX_EXAM_IMPORT_AI_REGIONS = Math.min(MAX_EXAM_IMPORT_TOTAL_QUESTIONS, 500);

export const examImportAiRegionReasonSchema = z.enum([
  'unresolved_question',
  'missing_answer_key',
  'source_conflict',
  'unrecognized_shape'
]);

export type ExamImportAiRegionReason = z.infer<typeof examImportAiRegionReasonSchema>;

export type ExamImportAiRegion = {
  questionId: string;
  reasons: ExamImportAiRegionReason[];
  question: ExamImportQuestion;
  diagnostics: ExamImportDiagnostic[];
  provenance: ExamImportSourceSpan[];
};

const aiRegionResolutionSchema = z.strictObject({
  questionId: z.string().min(1).max(200),
  question: examImportQuestionSchema
});

export const examImportAiRegionResponseSchema = z.strictObject({
  regions: z.array(aiRegionResolutionSchema).max(MAX_EXAM_IMPORT_AI_REGIONS)
});

export type ExamImportAiRegionResponse = z.infer<typeof examImportAiRegionResponseSchema>;

export type ApplyExamImportAiRegionResponseResult = ExamImportValidationResult & {
  accepted: boolean;
};

function diagnosticReasons(diagnostics: readonly ExamImportDiagnostic[]): ExamImportAiRegionReason[] {
  const reasons: ExamImportAiRegionReason[] = [];

  if (diagnostics.some((diagnostic) => CONFLICT_DIAGNOSTIC_CODES.has(diagnostic.code))) {
    reasons.push('source_conflict');
  }
  if (diagnostics.some((diagnostic) => UNRECOGNIZED_SHAPE_DIAGNOSTIC_CODES.has(diagnostic.code))) {
    reasons.push('unrecognized_shape');
  }

  return reasons;
}

export function collectExamImportAiRegions(draft: ExamImportDraft): ExamImportAiRegion[] {
  const parsedDraft = examImportDraftSchema.parse(draft);
  const regions: ExamImportAiRegion[] = [];

  for (const section of parsedDraft.sections) {
    for (const question of section.questions) {
      const diagnostics = parsedDraft.diagnostics.filter((diagnostic) => diagnostic.questionId === question.id);
      const reasons = diagnosticReasons(diagnostics);

      if (question.kind === 'unresolved') {
        reasons.unshift('unresolved_question');
      } else if (requiresExamImportAnswerKey(question) && question.answerKey === null) {
        reasons.unshift('missing_answer_key');
      }
      if (reasons.length === 0) continue;

      regions.push({
        questionId: question.id,
        reasons: [...new Set(reasons)],
        question: structuredClone(question),
        diagnostics: structuredClone(diagnostics),
        provenance: structuredClone(question.provenance)
      });

      if (regions.length === MAX_EXAM_IMPORT_AI_REGIONS) return regions;
    }
  }

  return regions;
}

function aiQuestionFieldStates(
  question: ExamImportQuestion,
  provenance: ExamImportSourceSpan[]
): ExamImportFieldState[] {
  const fields: Array<Extract<ExamImportFieldState['target'], { kind: 'question_field' }>['field']> = [
    'kind',
    'promptHtml',
    'points',
    'cognitiveLevel',
    'answerKey'
  ];

  if (question.kind === 'choice') fields.push('cardinality');
  if (question.kind === 'true_false_group') fields.push('scoring');

  return fields.map((field) => ({
    target: { kind: 'question_field', questionId: question.id, field },
    confidence: 'low',
    origin: 'ai',
    provenance: structuredClone(provenance)
  }));
}

function normalizeAiQuestion(
  resolution: ExamImportAiRegionResponse['regions'][number],
  region: ExamImportAiRegion
): ExamImportQuestion | null {
  const original = region.question;
  if (resolution.question.id !== resolution.questionId || resolution.question.kind === 'unresolved') return null;

  const mayReplaceQuestion =
    region.reasons.includes('unresolved_question') || region.reasons.includes('unrecognized_shape');
  if (!mayReplaceQuestion && resolution.question.kind !== original.kind) return null;

  const resolvedQuestion = mayReplaceQuestion
    ? structuredClone(resolution.question)
    : {
        ...structuredClone(original),
        answerCandidates: structuredClone(resolution.question.answerCandidates),
        answerKey: structuredClone(resolution.question.answerKey)
      };
  const provenance = structuredClone(original.provenance);
  const normalized = {
    ...resolvedQuestion,
    id: original.id,
    order: original.order,
    sourceNumber: original.sourceNumber,
    passageId: original.passageId,
    confidence: 'low' as const,
    review: 'needs_attention' as const,
    provenance
  };

  if (normalized.kind === 'essay') {
    const parsed = examImportQuestionSchema.safeParse(normalized);

    return parsed.success ? parsed.data : null;
  }

  const answerCandidates = normalized.answerCandidates.map((candidate) => ({
    ...candidate,
    source: 'ai' as const,
    provenance: structuredClone(provenance)
  }));

  const parsed = examImportQuestionSchema.safeParse({ ...normalized, answerCandidates });

  return parsed.success ? parsed.data : null;
}

function replaceQuestion(draft: ExamImportDraft, questionId: string, replacement: ExamImportQuestion): boolean {
  for (const section of draft.sections) {
    const questionIndex = section.questions.findIndex((question) => question.id === questionId);
    if (questionIndex < 0) continue;

    section.questions[questionIndex] = replacement;
    return true;
  }

  return false;
}

function replaceAiFieldStates(
  fieldStates: ExamImportFieldState[],
  question: ExamImportQuestion,
  provenance: ExamImportSourceSpan[],
  replaceWholeQuestion: boolean
): ExamImportFieldState[] | null {
  const retained = fieldStates.filter((fieldState) => {
    if (fieldState.target.kind !== 'question_field' || fieldState.target.questionId !== question.id) return true;

    return replaceWholeQuestion ? false : fieldState.target.field !== 'answerKey';
  });
  const aiStates = replaceWholeQuestion
    ? aiQuestionFieldStates(question, provenance)
    : [
        {
          target: { kind: 'question_field' as const, questionId: question.id, field: 'answerKey' as const },
          confidence: 'low' as const,
          origin: 'ai' as const,
          provenance: structuredClone(provenance)
        }
      ];
  const next = [...retained, ...aiStates];

  return next.length <= MAX_EXAM_IMPORT_FIELD_STATES ? next : null;
}

export function applyExamImportAiRegionResponse(
  draft: ExamImportDraft,
  response: unknown,
  context: ExamImportValidationContext
): ApplyExamImportAiRegionResponseResult {
  const originalValidation = validateExamImportDraft(draft, context);
  const parsedResponse = examImportAiRegionResponseSchema.safeParse(response);
  if (!parsedResponse.success || originalValidation.draft === null) {
    return { ...originalValidation, accepted: false };
  }

  const regions = collectExamImportAiRegions(originalValidation.draft);
  const regionsByQuestionId = new Map(regions.map((region) => [region.questionId, region]));
  const resolvedQuestionIds = new Set<string>();
  const nextDraft = structuredClone(originalValidation.draft);

  for (const resolution of parsedResponse.data.regions) {
    if (resolvedQuestionIds.has(resolution.questionId)) {
      return { ...originalValidation, accepted: false };
    }

    const region = regionsByQuestionId.get(resolution.questionId);
    if (!region) {
      return { ...originalValidation, accepted: false };
    }

    const question = normalizeAiQuestion(resolution, region);
    if (!question || !replaceQuestion(nextDraft, region.questionId, question)) {
      return { ...originalValidation, accepted: false };
    }

    const replaceWholeQuestion =
      region.reasons.includes('unresolved_question') || region.reasons.includes('unrecognized_shape');
    const fieldStates = replaceAiFieldStates(nextDraft.fieldStates, question, region.provenance, replaceWholeQuestion);
    if (!fieldStates) {
      return { ...originalValidation, accepted: false };
    }
    nextDraft.fieldStates = fieldStates;
    resolvedQuestionIds.add(resolution.questionId);
  }

  const validation = validateExamImportDraft(nextDraft, context);
  if (validation.draft === null) {
    return { ...originalValidation, accepted: false };
  }
  const unexpectedBlockingFinding = validation.findings.some(
    (finding) =>
      finding.blocking &&
      finding.code !== 'AI_ANSWER_REQUIRES_CONFIRMATION' &&
      (finding.questionId === null || resolvedQuestionIds.has(finding.questionId))
  );
  if (unexpectedBlockingFinding) {
    return { ...originalValidation, accepted: false };
  }

  return { ...validation, accepted: true };
}
