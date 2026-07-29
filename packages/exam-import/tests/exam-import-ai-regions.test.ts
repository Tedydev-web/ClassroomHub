import { describe, expect, it } from 'vitest';

import {
  applyExamImportAiRegionResponse,
  collectExamImportAiRegions,
  examImportAiRegionResponseSchema,
  MAX_EXAM_IMPORT_AI_REGIONS
} from '../src/draft/exam-import-ai-regions';
import type { ExamImportQuestion } from '../src/draft/exam-import-draft';
import type { ExamImportValidationContext } from '../src/draft/exam-import-validation';
import { buildValidExamImportDraft, sourceSpan } from './fixtures/exam-import-draft-fixture';

const validationContext: ExamImportValidationContext = {
  enabledQuestionKinds: new Set(['choice', 'true_false_group', 'short_answer', 'numeric', 'essay']),
  sanitizeHtml: (html) => html
};

function keylessQuestion(): Extract<ExamImportQuestion, { kind: 'choice' }> {
  const draft = buildValidExamImportDraft();
  const question = draft.sections[0]!.questions[0]!;
  if (question.kind !== 'choice') throw new Error('Expected choice fixture');

  return {
    ...structuredClone(question),
    answerCandidates: [],
    answerKey: null,
    confidence: 'none',
    review: 'unresolved'
  };
}

describe('exam import AI regions', () => {
  it('collects only unresolved, missing-key, conflict, and unrecognized-shape questions', () => {
    const draft = buildValidExamImportDraft();
    const cleanQuestion = draft.sections[0]!.questions[0]!;
    const missingKey = { ...keylessQuestion(), id: 'question-2', order: 1 };
    const unresolved: ExamImportQuestion = {
      id: 'question-3',
      kind: 'unresolved',
      order: 2,
      sourceNumber: '3',
      promptHtml: '<p>Unknown shape</p>',
      rawHtml: '<p>Unknown shape</p>',
      points: null,
      cognitiveLevel: null,
      passageId: null,
      answerCandidates: [],
      answerKey: null,
      confidence: 'none',
      review: 'unresolved',
      provenance: [sourceSpan]
    };
    const conflict = {
      ...structuredClone(cleanQuestion),
      id: 'question-4',
      order: 3,
      review: 'needs_attention' as const
    };
    draft.sections[0]!.questions.push(missingKey, unresolved, conflict);
    draft.diagnostics.push(
      {
        tier: 'semantic',
        severity: 'error',
        blocking: true,
        code: 'ANSWER_SOURCE_CONFLICT',
        message: 'Sources disagree',
        messageKey: 'exam_import.diagnostics.answer_source_conflict',
        questionId: conflict.id,
        target: { kind: 'question_field', questionId: conflict.id, field: 'answerKey' },
        provenance: [sourceSpan]
      },
      {
        tier: 'semantic',
        severity: 'error',
        blocking: true,
        code: 'QUESTION_STRUCTURE_UNRESOLVED',
        message: 'Question shape is not recognized',
        messageKey: 'exam_import.diagnostics.question_structure_unresolved',
        questionId: unresolved.id,
        target: { kind: 'question_field', questionId: unresolved.id, field: 'kind' },
        provenance: [sourceSpan]
      }
    );

    expect(collectExamImportAiRegions(draft).map(({ questionId, reasons }) => ({ questionId, reasons }))).toEqual([
      { questionId: 'question-2', reasons: ['missing_answer_key'] },
      { questionId: 'question-3', reasons: ['unresolved_question', 'unrecognized_shape'] },
      { questionId: 'question-4', reasons: ['source_conflict'] }
    ]);
  });

  it('audits every question against source without inventing a missing answer key', () => {
    const draft = buildValidExamImportDraft();
    const question = keylessQuestion();
    draft.sections[0]!.questions = [question];
    draft.fieldStates = draft.fieldStates.filter(
      (fieldState) => !(fieldState.target.kind === 'question_field' && fieldState.target.field === 'answerKey')
    );
    const auditedQuestion = {
      ...structuredClone(question),
      promptHtml: '<p>Prompt restored from source</p>',
      answerCandidates: [
        {
          id: 'candidate-ai',
          kind: 'choice' as const,
          correctOptionIds: ['option-a'],
          source: 'ai' as const,
          provenance: [sourceSpan]
        }
      ],
      answerKey: {
        kind: 'choice' as const,
        correctOptionIds: ['option-a'],
        agreement: 'single_source' as const,
        selectedCandidateIds: ['candidate-ai'],
        conflictingCandidateIds: []
      }
    };

    expect(collectExamImportAiRegions(draft, { includeSourceAudit: true })[0]?.reasons).toEqual([
      'missing_answer_key',
      'source_audit'
    ]);

    const result = applyExamImportAiRegionResponse(
      draft,
      {
        regions: [
          {
            questionId: question.id,
            question: auditedQuestion,
            findings: [
              {
                code: 'SOURCE_CONTENT_MISMATCH',
                severity: 'warning',
                message: 'The prompt was restored from source.'
              },
              {
                code: 'SOURCE_AUTHORING_CONCERN',
                severity: 'warning',
                message: 'The question topic does not match the shared passage.'
              }
            ]
          }
        ]
      },
      validationContext,
      { includeSourceAudit: true, preserveMissingAnswerKeys: true }
    );
    const applied = result.draft?.sections[0]?.questions[0];

    expect(result.accepted).toBe(true);
    expect(applied?.promptHtml).toBe('<p>Prompt restored from source</p>');
    expect(applied?.answerCandidates).toEqual([]);
    expect(applied?.answerKey).toBeNull();
    expect(result.findings.map((finding) => finding.code)).toContain('MISSING_ANSWER_KEY');
    expect(result.draft?.diagnostics).toContainEqual(
      expect.objectContaining({
        tier: 'assisted',
        blocking: false,
        code: 'SOURCE_AUTHORING_CONCERN',
        message: 'The question topic does not match the shared passage.',
        questionId: question.id
      })
    );
    expect(result.draft?.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'SOURCE_CONTENT_MISMATCH',
        message: 'The prompt was restored from source.'
      })
    );
  });

  it('drops a claimed source mismatch when AI made no source-content correction', () => {
    const draft = buildValidExamImportDraft();
    const question = keylessQuestion();
    draft.sections[0]!.questions = [question];

    const result = applyExamImportAiRegionResponse(
      draft,
      {
        regions: [
          {
            questionId: question.id,
            question,
            findings: [
              {
                code: 'SOURCE_CONTENT_MISMATCH',
                severity: 'warning',
                message: 'The source has no answer key.'
              }
            ]
          }
        ]
      },
      validationContext,
      { includeSourceAudit: true, preserveMissingAnswerKeys: true }
    );

    expect(result.accepted).toBe(true);
    expect(result.draft?.diagnostics).toEqual([]);
  });

  it('preserves prompt and options that AI cannot ground in the question source span', () => {
    const draft = buildValidExamImportDraft();
    const question = keylessQuestion();
    draft.sections[0]!.questions = [question];
    const ungroundedQuestion = {
      ...structuredClone(question),
      promptHtml: '<p>Sentence copied from the shared passage.</p>',
      options: [question.options[0]!, { ...question.options[1]!, html: '<p>Invented option</p>' }]
    };

    const result = applyExamImportAiRegionResponse(
      draft,
      {
        regions: [
          {
            questionId: question.id,
            question: ungroundedQuestion,
            findings: [
              {
                code: 'SOURCE_CONTENT_MISMATCH',
                severity: 'warning',
                message: 'Restored content from source.'
              }
            ]
          }
        ]
      },
      validationContext,
      {
        includeSourceAudit: true,
        preserveMissingAnswerKeys: true,
        sourceQuestionText: 'Question 1. Choose the correct answer. A. First B. Second'
      }
    );
    const applied = result.draft?.sections[0]?.questions[0];

    expect(result.accepted).toBe(true);
    expect(applied?.promptHtml).toBe(question.promptHtml);
    expect(applied?.kind === 'choice' ? applied.options : null).toEqual(question.options);
    expect(result.draft?.diagnostics).toEqual([]);
  });

  it('preserves source formatting and equivalent generated fallback prompts', () => {
    const draft = buildValidExamImportDraft();
    const question = keylessQuestion();
    question.promptHtml = '<p><strong>Question 1</strong></p>';
    question.options[0]!.html = '<p><span style="color:#080808">First</span></p>';
    draft.sections[0]!.questions = [question];
    const reformattedQuestion = {
      ...structuredClone(question),
      promptHtml: '<p>Question 1.</p>',
      options: [{ ...question.options[0]!, html: '<p>First</p>' }, question.options[1]!]
    };

    const result = applyExamImportAiRegionResponse(
      draft,
      {
        regions: [
          {
            questionId: question.id,
            question: reformattedQuestion,
            findings: []
          }
        ]
      },
      validationContext,
      {
        includeSourceAudit: true,
        preserveMissingAnswerKeys: true,
        sourceQuestionText: 'Question 1. Choose the correct answer. A. First B. Second'
      }
    );
    const applied = result.draft?.sections[0]?.questions[0];

    expect(result.accepted).toBe(true);
    expect(applied?.promptHtml).toBe(question.promptHtml);
    expect(applied?.kind === 'choice' ? applied.options : null).toEqual(question.options);
  });

  it('rejects unknown fields and responses beyond the region limit', () => {
    expect(examImportAiRegionResponseSchema.safeParse({ regions: [], unexpected: true }).success).toBe(false);
    expect(
      examImportAiRegionResponseSchema.safeParse({
        regions: Array.from({ length: MAX_EXAM_IMPORT_AI_REGIONS + 1 }, (_, index) => ({
          questionId: `question-${index}`,
          question: keylessQuestion(),
          findings: []
        }))
      }).success
    ).toBe(false);
  });

  it('applies a valid AI answer with low confidence and review required, then validates the draft', () => {
    const draft = buildValidExamImportDraft();
    const question = keylessQuestion();
    draft.sections[0]!.questions = [question];
    draft.fieldStates = draft.fieldStates.filter(
      (fieldState) => !(fieldState.target.kind === 'question_field' && fieldState.target.field === 'answerKey')
    );
    const aiQuestion: ExamImportQuestion = {
      ...structuredClone(question),
      promptHtml: '<p>AI must not replace this trusted prompt</p>',
      answerCandidates: [
        {
          id: 'candidate-ai',
          kind: 'choice',
          correctOptionIds: ['option-a'],
          source: 'explicit_line',
          provenance: [sourceSpan]
        }
      ],
      answerKey: {
        kind: 'choice',
        correctOptionIds: ['option-a'],
        agreement: 'single_source',
        selectedCandidateIds: ['candidate-ai'],
        conflictingCandidateIds: []
      },
      confidence: 'high',
      review: 'clean'
    };

    const result = applyExamImportAiRegionResponse(
      draft,
      { regions: [{ questionId: question.id, question: aiQuestion, findings: [] }] },
      validationContext
    );
    const applied = result.draft?.sections[0]?.questions[0];

    expect(result.accepted).toBe(true);
    expect(applied).toMatchObject({ confidence: 'low', review: 'needs_attention' });
    expect(applied?.promptHtml).toBe(question.promptHtml);
    expect(applied?.kind === 'choice' ? applied.answerCandidates[0]?.source : null).toBe('ai');
    const answerKeyState = result.draft?.fieldStates.find(
      (fieldState) =>
        fieldState.target.kind === 'question_field' &&
        fieldState.target.questionId === question.id &&
        fieldState.target.field === 'answerKey'
    );
    expect(answerKeyState).toMatchObject({ origin: 'ai', confidence: 'low' });
    expect(result.findings.map((finding) => finding.code)).toContain('AI_ANSWER_REQUIRES_CONFIRMATION');
  });

  it('discards malformed, duplicate, and non-region responses without changing the draft', () => {
    const draft = buildValidExamImportDraft();
    const question = keylessQuestion();
    draft.sections[0]!.questions = [question];
    const validResolution = { questionId: question.id, question, findings: [] };

    for (const response of [
      { regions: [{ questionId: question.id, question: { ...question, unexpected: true }, findings: [] }] },
      { regions: [validResolution, validResolution] },
      { regions: [{ ...validResolution, questionId: 'question-not-collected' }] }
    ]) {
      const result = applyExamImportAiRegionResponse(draft, response, validationContext);

      expect(result.accepted).toBe(false);
      expect(result.draft).toEqual(draft);
    }
  });

  it('discards a response that introduces a new blocking semantic finding', () => {
    const draft = buildValidExamImportDraft();
    const question = keylessQuestion();
    draft.sections[0]!.questions = [question];
    const invalidQuestion: ExamImportQuestion = {
      ...structuredClone(question),
      answerCandidates: [
        {
          id: 'candidate-ai-invalid',
          kind: 'choice',
          correctOptionIds: ['missing-option'],
          source: 'ai',
          provenance: [sourceSpan]
        }
      ],
      answerKey: {
        kind: 'choice',
        correctOptionIds: ['missing-option'],
        agreement: 'single_source',
        selectedCandidateIds: ['candidate-ai-invalid'],
        conflictingCandidateIds: []
      }
    };

    const result = applyExamImportAiRegionResponse(
      draft,
      { regions: [{ questionId: question.id, question: invalidQuestion, findings: [] }] },
      validationContext
    );

    expect(result.accepted).toBe(false);
    expect(result.draft).toEqual(draft);
  });

  it('discards responses that leave the region unresolved or change a trusted question kind', () => {
    const draft = buildValidExamImportDraft();
    const question = keylessQuestion();
    draft.sections[0]!.questions = [question];
    const essayResponse: ExamImportQuestion = {
      id: question.id,
      kind: 'essay',
      order: question.order,
      sourceNumber: question.sourceNumber,
      promptHtml: question.promptHtml,
      points: question.points,
      cognitiveLevel: question.cognitiveLevel,
      passageId: question.passageId,
      answerCandidates: [],
      answerKey: null,
      confidence: 'low',
      review: 'needs_attention',
      provenance: question.provenance
    };

    for (const responseQuestion of [question, essayResponse]) {
      const result = applyExamImportAiRegionResponse(
        draft,
        { regions: [{ questionId: question.id, question: responseQuestion, findings: [] }] },
        validationContext
      );

      expect(result.accepted).toBe(false);
      expect(result.draft).toEqual(draft);
    }
  });
});
