import { describe, expect, it } from 'vitest';
import {
  collectExamImportSemanticFindings,
  validateExamImportAssistedFindings,
  validateExamImportDraft,
  validateExamImportDraftStructure,
  type ExamImportValidationContext
} from '../src/draft/exam-import-validation';
import { buildValidExamImportDraft } from './fixtures/exam-import-draft-fixture';

const allEnabledKinds = new Set(['choice', 'true_false_group', 'short_answer', 'numeric', 'essay'] as const);
const sanitizeHtml = (html: string): string =>
  html.replace(/\s+on\w+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/javascript:/gi, '');
const validationContext: ExamImportValidationContext = {
  enabledQuestionKinds: allEnabledKinds,
  sanitizeHtml
};

function findingCodes(value: ReturnType<typeof validateExamImportDraft>): string[] {
  return value.findings.map((finding) => finding.code);
}

describe('ExamImportDraft validation', () => {
  it('validates assisted findings independently without allowing them to block', () => {
    const accepted = validateExamImportAssistedFindings([
      {
        tier: 'assisted',
        severity: 'warning',
        blocking: false,
        code: 'CONTENT_COHERENCE_REVIEW',
        message: 'The prompt may not align with the available options.',
        messageKey: 'exam_import.diagnostics.content_coherence_review',
        questionId: null,
        target: null,
        provenance: []
      }
    ]);
    const rejected = validateExamImportAssistedFindings([
      {
        tier: 'assisted',
        severity: 'error',
        blocking: true,
        code: 'INVALID_ASSISTED_BLOCKER',
        message: 'This must not block.',
        messageKey: 'exam_import.diagnostics.invalid_assisted_blocker',
        questionId: null,
        target: null,
        provenance: []
      }
    ]);

    expect(accepted).toMatchObject({ accepted: true, findings: [{ blocking: false }] });
    expect(rejected).toMatchObject({
      accepted: false,
      findings: [{ tier: 'assisted', blocking: false, code: 'ASSISTED_VALIDATION_INVALID' }]
    });
  });

  it('accepts a valid draft and reports it as publishable', () => {
    const result = validateExamImportDraft(buildValidExamImportDraft(), validationContext);

    expect(result.draft).not.toBeNull();
    expect(result.findings).toEqual([]);
    expect(result.publishable).toBe(true);
  });

  it('rejects a dangling shared-content reference', () => {
    const draft = buildValidExamImportDraft();
    draft.sections[0]!.questions[0]!.passageId = 'missing-passage';

    const result = validateExamImportDraft(draft, validationContext);

    expect(findingCodes(result)).toContain('DANGLING_SHARED_CONTENT');
    expect(result.publishable).toBe(false);
  });

  it('blocks a fallback question label when no shared passage supplies the missing prompt', () => {
    const draft = buildValidExamImportDraft();
    const question = draft.sections[0]!.questions[0]!;
    question.promptHtml = `<p>Question ${question.sourceNumber}</p>`;
    question.passageId = null;

    const result = validateExamImportDraft(draft, validationContext);

    expect(findingCodes(result)).toContain('PLACEHOLDER_QUESTION_PROMPT');
    expect(result.publishable).toBe(false);
  });

  it('rejects a field state whose ID-scoped target no longer exists', () => {
    const draft = buildValidExamImportDraft();
    draft.fieldStates.push({
      target: { kind: 'option_field', questionId: 'question-1', optionId: 'missing-option', field: 'html' },
      confidence: 'high',
      origin: 'deterministic',
      provenance: draft.sections[0]!.questions[0]!.provenance
    });

    const result = validateExamImportDraft(draft, validationContext);

    expect(findingCodes(result)).toContain('DANGLING_FIELD_TARGET');
    expect(result.publishable).toBe(false);
  });

  it('rejects answer keys that reference a missing candidate or option', () => {
    const draft = buildValidExamImportDraft();
    const question = draft.sections[0]!.questions[0]!;
    if (question.kind !== 'choice' || question.answerKey === null) throw new Error('Expected choice fixture');
    question.answerKey.selectedCandidateIds = ['missing-candidate'];
    question.answerKey.correctOptionIds = ['missing-option'];

    const result = validateExamImportDraft(draft, validationContext);

    expect(findingCodes(result)).toEqual(
      expect.arrayContaining(['DANGLING_ANSWER_CANDIDATE', 'ANSWER_OPTION_NOT_FOUND'])
    );
    expect(result.publishable).toBe(false);
  });

  it('rejects duplicate normalized option text that would make the answer ambiguous', () => {
    const draft = buildValidExamImportDraft();
    const question = draft.sections[0]!.questions[0]!;
    if (question.kind !== 'choice') throw new Error('Expected choice fixture');
    question.options[1]!.html = '<p> FIRST </p>';

    const result = validateExamImportDraft(draft, validationContext);

    expect(findingCodes(result)).toContain('DUPLICATE_OPTION_TEXT');
    expect(result.publishable).toBe(false);
  });

  it('rejects duplicate option source labels before answer mapping', () => {
    const draft = buildValidExamImportDraft();
    const question = draft.sections[0]!.questions[0]!;
    if (question.kind !== 'choice') throw new Error('Expected choice fixture');
    question.options[1]!.sourceLabel = question.options[0]!.sourceLabel;

    const result = validateExamImportDraft(draft, validationContext);

    expect(findingCodes(result)).toContain('DUPLICATE_OPTION_SOURCE_LABEL');
    expect(result.publishable).toBe(false);
  });

  it('rejects dangling candidate answers even before a key is reconciled', () => {
    const draft = buildValidExamImportDraft();
    const question = draft.sections[0]!.questions[0]!;
    if (question.kind !== 'choice') throw new Error('Expected choice fixture');
    question.answerKey = null;
    question.answerCandidates[0]!.correctOptionIds = ['missing-option'];

    const result = validateExamImportDraft(draft, validationContext);

    expect(findingCodes(result)).toContain('ANSWER_OPTION_NOT_FOUND');
    expect(result.publishable).toBe(false);
  });

  it('keeps unresolved source content but requires a blocking diagnostic', () => {
    const draft = buildValidExamImportDraft();
    const question = draft.sections[0]!.questions[0]!;
    draft.sections[0]!.questions = [
      {
        id: question.id,
        kind: 'unresolved',
        order: question.order,
        sourceNumber: question.sourceNumber,
        promptHtml: question.promptHtml,
        rawHtml: '<p>Unclassified source fragment</p>',
        points: null,
        cognitiveLevel: null,
        passageId: null,
        answerCandidates: [],
        answerKey: null,
        confidence: 'none',
        review: 'unresolved',
        provenance: question.provenance
      }
    ];

    const result = validateExamImportDraft(draft, validationContext);

    expect(findingCodes(result)).toContain('UNRESOLVED_QUESTION_NOT_BLOCKED');
    expect(result.publishable).toBe(false);
  });

  it('blocks a draft question whose publish kind is disabled by the caller', () => {
    const result = validateExamImportDraft(buildValidExamImportDraft(), {
      ...validationContext,
      enabledQuestionKinds: new Set(['essay'])
    });

    expect(findingCodes(result)).toContain('QUESTION_KIND_DISABLED');
    expect(result.publishable).toBe(false);
  });

  it('reports malformed input as structural findings without returning a partial typed draft', () => {
    const result = validateExamImportDraft({ schemaVersion: 2 }, validationContext);

    expect(result.draft).toBeNull();
    expect(findingCodes(result)).toContain('STRUCTURAL_SCHEMA_INVALID');
    expect(result.publishable).toBe(false);
  });

  it('rejects a reconciled key whose value differs from its selected candidate', () => {
    const draft = buildValidExamImportDraft();
    const question = draft.sections[0]!.questions[0]!;
    if (question.kind !== 'choice' || question.answerKey === null) throw new Error('Expected choice fixture');
    question.answerKey.correctOptionIds = ['option-a'];

    const result = validateExamImportDraft(draft, validationContext);

    expect(findingCodes(result)).toContain('ANSWER_KEY_CANDIDATE_MISMATCH');
    expect(result.publishable).toBe(false);
  });

  it('keeps a keyless auto-gradable question reviewable but not publishable', () => {
    const draft = buildValidExamImportDraft();
    const question = draft.sections[0]!.questions[0]!;
    if (question.kind !== 'choice') throw new Error('Expected choice fixture');
    question.answerKey = null;
    question.answerCandidates = [];
    question.confidence = 'none';
    question.review = 'unresolved';
    draft.fieldStates = draft.fieldStates.filter(
      (fieldState) => !(fieldState.target.kind === 'question_field' && fieldState.target.field === 'answerKey')
    );

    const result = validateExamImportDraft(draft, validationContext);

    expect(result.draft).not.toBeNull();
    expect(findingCodes(result)).toContain('MISSING_ANSWER_KEY');
    expect(result.publishable).toBe(false);
  });

  it('does not duplicate a reconciled missing-answer diagnostic during validation', () => {
    const draft = buildValidExamImportDraft();
    const question = draft.sections[0]!.questions[0]!;
    if (question.kind !== 'choice') throw new Error('Expected choice fixture');
    question.answerKey = null;
    question.answerCandidates = [];
    question.confidence = 'none';
    question.review = 'unresolved';
    draft.fieldStates = draft.fieldStates.filter(
      (fieldState) => !(fieldState.target.kind === 'question_field' && fieldState.target.field === 'answerKey')
    );
    draft.diagnostics.push({
      tier: 'semantic',
      severity: 'error',
      blocking: true,
      code: 'ANSWER_KEY_MISSING',
      message: 'No answer-key source was found',
      messageKey: 'exam_import.diagnostics.answer_key_missing',
      questionId: question.id,
      target: { kind: 'question_field', questionId: question.id, field: 'answerKey' },
      provenance: question.provenance
    });

    const result = validateExamImportDraft(draft, validationContext);
    const missingAnswerFindings = result.findings.filter(
      (finding) => finding.code === 'ANSWER_KEY_MISSING' || finding.code === 'MISSING_ANSWER_KEY'
    );

    expect(missingAnswerFindings).toHaveLength(1);
    expect(missingAnswerFindings[0]?.code).toBe('ANSWER_KEY_MISSING');
    expect(result.publishable).toBe(false);
  });

  it('allows a keyless short-answer question because the published interaction is manually graded', () => {
    const draft = buildValidExamImportDraft();
    const question = draft.sections[0]!.questions[0]!;
    draft.sections[0]!.questions = [
      {
        id: question.id,
        kind: 'short_answer',
        order: question.order,
        sourceNumber: question.sourceNumber,
        promptHtml: question.promptHtml,
        points: question.points,
        cognitiveLevel: question.cognitiveLevel,
        passageId: question.passageId,
        answerCandidates: [],
        answerKey: null,
        confidence: 'medium',
        review: 'clean',
        provenance: question.provenance
      }
    ];
    draft.fieldStates = draft.fieldStates.filter(
      (fieldState) => !(fieldState.target.kind === 'question_field' && fieldState.target.field === 'answerKey')
    );

    const result = validateExamImportDraft(draft, validationContext);

    expect(findingCodes(result)).not.toContain('MISSING_ANSWER_KEY');
    expect(result.publishable).toBe(true);
  });

  it('requires teacher confirmation before an AI-selected answer can publish', () => {
    const draft = buildValidExamImportDraft();
    const question = draft.sections[0]!.questions[0]!;
    if (question.kind !== 'choice') throw new Error('Expected choice fixture');
    question.answerCandidates[0]!.source = 'ai';
    question.confidence = 'low';
    question.review = 'needs_attention';
    const answerFieldState = draft.fieldStates.find(
      (fieldState) => fieldState.target.kind === 'question_field' && fieldState.target.field === 'answerKey'
    );
    if (!answerFieldState) throw new Error('Expected answer field state');
    answerFieldState.origin = 'ai';
    answerFieldState.confidence = 'low';

    const result = validateExamImportDraft(draft, validationContext);

    expect(findingCodes(result)).toContain('AI_ANSWER_REQUIRES_CONFIRMATION');
    expect(result.publishable).toBe(false);
  });

  it('rejects duplicate answer candidate IDs before resolving candidate references', () => {
    const draft = buildValidExamImportDraft();
    const question = draft.sections[0]!.questions[0]!;
    if (question.kind !== 'choice') throw new Error('Expected choice fixture');
    question.answerCandidates.push({
      ...question.answerCandidates[0]!,
      correctOptionIds: ['option-a']
    });

    const result = validateExamImportDraft(draft, validationContext);

    expect(findingCodes(result)).toContain('DUPLICATE_ANSWER_CANDIDATE_ID');
    expect(result.publishable).toBe(false);
  });

  it('rejects a question diagnostic that targets a field owned by another question', () => {
    const draft = buildValidExamImportDraft();
    const question = draft.sections[0]!.questions[0]!;
    draft.sections[0]!.questions.push({ ...structuredClone(question), id: 'question-2', order: 1 });
    draft.diagnostics.push({
      tier: 'semantic',
      severity: 'error',
      blocking: true,
      code: 'QUESTION_REVIEW_REQUIRED',
      message: 'Review this question.',
      messageKey: 'exam_import.diagnostics.question_review_required',
      questionId: 'question-1',
      target: { kind: 'question_field', questionId: 'question-2', field: 'promptHtml' },
      provenance: question.provenance
    });

    const result = validateExamImportDraft(draft, validationContext);

    expect(findingCodes(result)).toContain('DIAGNOSTIC_TARGET_OWNERSHIP_MISMATCH');
    expect(result.publishable).toBe(false);
  });

  it('requires tiered true/false scoring to start at zero and end at one', () => {
    const draft = buildValidExamImportDraft();
    const question = draft.sections[0]!.questions[0]!;
    draft.sections[0]!.questions = [
      {
        id: question.id,
        kind: 'true_false_group',
        order: question.order,
        sourceNumber: question.sourceNumber,
        promptHtml: question.promptHtml,
        points: 1,
        cognitiveLevel: null,
        passageId: null,
        statements: [
          { id: 'statement-a', sourceLabel: 'a', html: '<p>First statement</p>', order: 0 },
          { id: 'statement-b', sourceLabel: 'b', html: '<p>Second statement</p>', order: 1 }
        ],
        scoring: { mode: 'tiered', tiers: [0.5, 0.5, 0.5] },
        answerCandidates: [],
        answerKey: null,
        confidence: 'none',
        review: 'unresolved',
        provenance: question.provenance
      }
    ];
    draft.fieldStates = [];

    const result = validateExamImportDraft(draft, validationContext);

    expect(findingCodes(result)).toContain('INVALID_TRUE_FALSE_SCORING');
    expect(result.publishable).toBe(false);
  });

  it('sanitizes every authored HTML field before returning a typed draft', () => {
    const draft = buildValidExamImportDraft();
    const question = draft.sections[0]!.questions[0]!;
    question.promptHtml = '<img src="x" onerror="alert(1)"><p>Question</p>';
    draft.sharedContents[0]!.html = '<a href="javascript:alert(1)">Passage</a>';

    const result = validateExamImportDraft(draft, validationContext);

    expect(result.draft?.sections[0]?.questions[0]?.promptHtml).not.toContain('onerror');
    expect(result.draft?.sharedContents[0]?.html).not.toContain('javascript:');
  });

  it('exposes structural and semantic validation as independent tiers', () => {
    const structural = validateExamImportDraftStructure(buildValidExamImportDraft(), sanitizeHtml);
    expect(structural.draft).not.toBeNull();
    expect(structural.findings).toEqual([]);
    if (!structural.draft) throw new Error('Expected structurally valid draft');

    const semantic = collectExamImportSemanticFindings(structural.draft, {
      enabledQuestionKinds: allEnabledKinds
    });
    expect(semantic).toEqual([]);
  });
});
