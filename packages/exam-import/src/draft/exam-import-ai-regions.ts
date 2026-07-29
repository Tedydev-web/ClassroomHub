import * as z from 'zod';

import { normalizeComparableText } from '../source-run';
import {
  MAX_EXAM_IMPORT_DIAGNOSTICS,
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
  'unrecognized_shape',
  'source_audit'
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
  question: examImportQuestionSchema,
  findings: z
    .array(
      z.strictObject({
        code: z.enum(['SOURCE_CONTENT_MISMATCH', 'SOURCE_AUTHORING_CONCERN']),
        severity: z.enum(['info', 'warning']),
        message: z.string().min(1).max(2_000)
      })
    )
    .max(20)
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

export function collectExamImportAiRegions(
  draft: ExamImportDraft,
  options: { includeSourceAudit?: boolean } = {}
): ExamImportAiRegion[] {
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
      if (options.includeSourceAudit) reasons.push('source_audit');
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
  region: ExamImportAiRegion,
  preserveMissingAnswerKeys: boolean
): ExamImportQuestion | null {
  const original = region.question;
  if (resolution.question.id !== resolution.questionId || resolution.question.kind === 'unresolved') return null;

  const mayReplaceQuestion =
    region.reasons.includes('unresolved_question') ||
    region.reasons.includes('unrecognized_shape') ||
    region.reasons.includes('source_audit');
  const mayChangeKind = region.reasons.includes('unresolved_question') || region.reasons.includes('source_audit');
  if (resolution.question.kind !== original.kind && !mayChangeKind) return null;

  let resolvedQuestion = mayReplaceQuestion
    ? structuredClone(resolution.question)
    : {
        ...structuredClone(original),
        answerCandidates: structuredClone(resolution.question.answerCandidates),
        answerKey: structuredClone(resolution.question.answerKey)
      };
  if (preserveMissingAnswerKeys && original.answerKey === null) {
    resolvedQuestion = {
      ...resolvedQuestion,
      answerCandidates: structuredClone(original.answerCandidates),
      answerKey: null
    };
  }
  const provenance = structuredClone(original.provenance);
  const normalized = {
    ...resolvedQuestion,
    id: original.id,
    order: original.order,
    sourceNumber: original.sourceNumber,
    passageId: original.passageId,
    confidence: 'low' as const,
    review: preserveMissingAnswerKeys && original.answerKey === null ? original.review : ('needs_attention' as const),
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

function comparableQuestionContent(question: ExamImportQuestion): string {
  const {
    answerCandidates: _answerCandidates,
    answerKey: _answerKey,
    confidence: _confidence,
    provenance: _provenance,
    review: _review,
    ...content
  } = question;

  return JSON.stringify(content);
}

function decodeHtmlCodePoint(entity: string, codePoint: string, radix: number): string {
  const value = Number.parseInt(codePoint, radix);

  return Number.isSafeInteger(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity;
}

function visibleHtmlText(html: string): string {
  const decoded = html
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&#(\d+);/gu, (entity, codePoint: string) => decodeHtmlCodePoint(entity, codePoint, 10))
    .replace(/&#x([0-9a-f]+);/giu, (entity, codePoint: string) => decodeHtmlCodePoint(entity, codePoint, 16))
    .replace(/&quot;/gu, '"')
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&');

  return normalizeComparableText(decoded);
}

function htmlListIsGroundedInSource(htmlValues: readonly string[], sourceText: string): boolean {
  const source = normalizeComparableText(sourceText);
  let cursor = 0;

  for (const html of htmlValues) {
    const value = visibleHtmlText(html);
    if (!value) continue;

    const index = source.indexOf(value, cursor);
    if (index < 0) return false;
    cursor = index + value.length;
  }

  return true;
}

function htmlListsHaveSameVisibleText(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((html, index) => visibleHtmlText(html) === visibleHtmlText(right[index]!))
  );
}

function promptsAreEquivalentFallbacks(next: ExamImportQuestion, original: ExamImportQuestion): boolean {
  if (original.sourceNumber === null) return false;
  const fallback = normalizeComparableText(`Question ${original.sourceNumber}`);

  return (
    visibleHtmlText(original.promptHtml) === fallback &&
    visibleHtmlText(next.promptHtml).replace(/[.:)]$/u, '') === fallback
  );
}

function guardSourceAuditContent(
  resolved: ExamImportQuestion,
  original: ExamImportQuestion,
  sourceQuestionText: string
): ExamImportQuestion {
  const next = structuredClone(resolved);
  const promptTextUnchanged =
    visibleHtmlText(next.promptHtml) === visibleHtmlText(original.promptHtml) ||
    promptsAreEquivalentFallbacks(next, original);
  if (promptTextUnchanged || !htmlListIsGroundedInSource([next.promptHtml], sourceQuestionText)) {
    next.promptHtml = original.promptHtml;
  }

  if (
    next.kind === 'choice' &&
    original.kind === 'choice' &&
    (htmlListsHaveSameVisibleText(
      next.options.map((option) => option.html),
      original.options.map((option) => option.html)
    ) ||
      !htmlListIsGroundedInSource(
        next.options.map((option) => option.html),
        sourceQuestionText
      ))
  ) {
    next.options = structuredClone(original.options);
  }
  if (
    next.kind === 'true_false_group' &&
    original.kind === 'true_false_group' &&
    (htmlListsHaveSameVisibleText(
      next.statements.map((statement) => statement.html),
      original.statements.map((statement) => statement.html)
    ) ||
      !htmlListIsGroundedInSource(
        next.statements.map((statement) => statement.html),
        sourceQuestionText
      ))
  ) {
    next.statements = structuredClone(original.statements);
  }

  return next;
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
  context: ExamImportValidationContext,
  options: { includeSourceAudit?: boolean; preserveMissingAnswerKeys?: boolean; sourceQuestionText?: string } = {}
): ApplyExamImportAiRegionResponseResult {
  const originalValidation = validateExamImportDraft(draft, context);
  const parsedResponse = examImportAiRegionResponseSchema.safeParse(response);
  if (!parsedResponse.success || originalValidation.draft === null) {
    return { ...originalValidation, accepted: false };
  }

  const regions = collectExamImportAiRegions(originalValidation.draft, options);
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

    let question = normalizeAiQuestion(resolution, region, options.preserveMissingAnswerKeys === true);
    if (question && options.includeSourceAudit && options.sourceQuestionText) {
      question = guardSourceAuditContent(question, region.question, options.sourceQuestionText);
    }
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
    const contentChanged = comparableQuestionContent(question) !== comparableQuestionContent(region.question);
    const retainedDiagnostics = nextDraft.diagnostics.filter(
      (diagnostic) => diagnostic.tier !== 'assisted' || diagnostic.questionId !== region.questionId
    );
    const assistedDiagnostics: ExamImportDiagnostic[] = resolution.findings
      .filter((finding) => finding.code !== 'SOURCE_CONTENT_MISMATCH' || contentChanged)
      .map((finding) => ({
        tier: 'assisted',
        severity: finding.severity,
        blocking: false,
        code: finding.code,
        message: finding.message,
        messageKey: 'exam_import.diagnostics.ai_source_concern',
        questionId: region.questionId,
        target: null,
        provenance: structuredClone(region.provenance)
      }));
    if (retainedDiagnostics.length + assistedDiagnostics.length > MAX_EXAM_IMPORT_DIAGNOSTICS) {
      return { ...originalValidation, accepted: false };
    }
    nextDraft.diagnostics = [...retainedDiagnostics, ...assistedDiagnostics];
    resolvedQuestionIds.add(resolution.questionId);
  }

  const validation = validateExamImportDraft(nextDraft, context);
  if (validation.draft === null) {
    return { ...originalValidation, accepted: false };
  }
  const originalBlockingFindings = new Set(
    originalValidation.findings
      .filter((finding) => finding.blocking)
      .map((finding) => `${finding.code}:${finding.questionId ?? ''}`)
  );
  const unexpectedBlockingFinding = validation.findings.some(
    (finding) =>
      finding.blocking &&
      finding.code !== 'AI_ANSWER_REQUIRES_CONFIRMATION' &&
      !originalBlockingFindings.has(`${finding.code}:${finding.questionId ?? ''}`) &&
      (finding.questionId === null || resolvedQuestionIds.has(finding.questionId))
  );
  if (unexpectedBlockingFinding) {
    return { ...originalValidation, accepted: false };
  }

  return { ...validation, accepted: true };
}
