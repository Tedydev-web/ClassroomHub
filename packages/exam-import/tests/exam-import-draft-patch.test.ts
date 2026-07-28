import { describe, expect, it } from 'vitest';
import { ExamImportDraftPatchError, applyExamImportDraftPatches } from '../src/draft/exam-import-draft-patch';
import { buildValidExamImportDraft } from './fixtures/exam-import-draft-fixture';

const context = {
  enabledQuestionKinds: new Set(['choice', 'true_false_group', 'short_answer', 'numeric', 'essay'] as const)
};

describe('applyExamImportDraftPatches', () => {
  it('updates only the targeted field, clears its diagnostic, and marks it teacher-confirmed', () => {
    const draft = buildValidExamImportDraft();
    const question = draft.sections[0]!.questions[0]!;
    question.review = 'needs_attention';
    draft.diagnostics.push({
      tier: 'semantic',
      severity: 'error',
      blocking: true,
      code: 'PROMPT_REVIEW_REQUIRED',
      message: 'Review the prompt',
      messageKey: 'exam_import.diagnostics.prompt_review_required',
      questionId: question.id,
      target: { kind: 'question_field', questionId: question.id, field: 'promptHtml' },
      provenance: question.provenance
    });

    const updated = applyExamImportDraftPatches(
      draft,
      [
        {
          target: { kind: 'question_field', questionId: question.id, field: 'promptHtml' },
          value: '<p>Teacher-corrected prompt.</p>'
        }
      ],
      context
    );

    expect(updated.sections[0]!.questions[0]).toMatchObject({
      promptHtml: '<p>Teacher-corrected prompt.</p>',
      review: 'clean'
    });
    expect(updated.diagnostics).toEqual([]);
    expect(
      updated.fieldStates.find(
        (fieldState) =>
          fieldState.target.kind === 'question_field' &&
          fieldState.target.questionId === question.id &&
          fieldState.target.field === 'promptHtml'
      )
    ).toMatchObject({
      confidence: 'teacher_confirmed',
      origin: 'teacher'
    });
    expect(draft.sections[0]!.questions[0]!.promptHtml).toBe('<p>Choose the correct answer.</p>');
  });

  it('creates a teacher answer candidate instead of trusting caller-supplied reconciliation metadata', () => {
    const draft = buildValidExamImportDraft();

    const updated = applyExamImportDraftPatches(
      draft,
      [
        {
          target: { kind: 'question_field', questionId: 'question-1', field: 'answerKey' },
          value: { kind: 'choice', correctOptionIds: ['option-a'] }
        }
      ],
      context
    );
    const question = updated.sections[0]!.questions[0]!;

    expect(question.kind).toBe('choice');
    if (question.kind !== 'choice') throw new Error('Expected choice question');
    expect(question.answerKey).toEqual({
      kind: 'choice',
      correctOptionIds: ['option-a'],
      agreement: 'single_source',
      selectedCandidateIds: ['teacher-answer'],
      conflictingCandidateIds: []
    });
    expect(question.answerCandidates.at(-1)).toMatchObject({
      id: 'teacher-answer',
      source: 'teacher',
      correctOptionIds: ['option-a']
    });
  });

  it('rejects a value that would make the strict draft schema invalid', () => {
    const draft = buildValidExamImportDraft();

    expect(() =>
      applyExamImportDraftPatches(
        draft,
        [
          {
            target: { kind: 'question_field', questionId: 'question-1', field: 'points' },
            value: 0.123
          }
        ],
        context
      )
    ).toThrowError(
      expect.objectContaining<Partial<ExamImportDraftPatchError>>({
        code: 'INVALID_PATCH'
      })
    );
  });

  it('fails explicitly rather than coercing a question kind in place', () => {
    const draft = buildValidExamImportDraft();

    expect(() =>
      applyExamImportDraftPatches(
        draft,
        [
          {
            target: { kind: 'question_field', questionId: 'question-1', field: 'kind' },
            value: 'essay'
          }
        ],
        context
      )
    ).toThrowError(
      expect.objectContaining<Partial<ExamImportDraftPatchError>>({
        code: 'UNSUPPORTED_KIND_CHANGE'
      })
    );
  });

  it('removes an unresolved question and its review metadata without changing sibling questions', () => {
    const draft = buildValidExamImportDraft();
    const originalQuestion = draft.sections[0]!.questions[0]!;
    const unresolvedQuestion = {
      id: 'question-unresolved',
      kind: 'unresolved' as const,
      order: 1,
      sourceNumber: '2',
      promptHtml: '<p>Unresolved source content.</p>',
      points: null,
      cognitiveLevel: null,
      passageId: null,
      provenance: structuredClone(originalQuestion.provenance),
      rawHtml: '<p>Unresolved source content.</p>',
      confidence: 'none' as const,
      review: 'unresolved' as const,
      answerCandidates: [] as [],
      answerKey: null
    };
    draft.sections[0]!.questions.push(unresolvedQuestion);
    draft.diagnostics.push({
      tier: 'semantic',
      severity: 'error',
      blocking: true,
      code: 'UNRESOLVED_QUESTION',
      message: 'Resolve or remove this question',
      messageKey: 'exam_import.diagnostics.unresolved_question',
      questionId: unresolvedQuestion.id,
      target: null,
      provenance: unresolvedQuestion.provenance
    });

    const updated = applyExamImportDraftPatches(
      draft,
      [{ operation: 'remove_question', questionId: unresolvedQuestion.id }],
      context
    );

    expect(updated.sections[0]!.questions.map((question) => question.id)).toEqual([originalQuestion.id]);
    expect(updated.diagnostics).toEqual([]);
    expect(draft.sections[0]!.questions).toHaveLength(2);
  });

  it('requires a resolved answer and records explicit teacher confirmation for an AI-derived question', () => {
    const draft = buildValidExamImportDraft();
    const question = draft.sections[0]!.questions[0]!;
    question.answerCandidates[0]!.source = 'ai';
    question.confidence = 'low';
    question.review = 'needs_attention';
    for (const fieldState of draft.fieldStates) {
      fieldState.confidence = 'low';
      fieldState.origin = 'ai';
    }

    const updated = applyExamImportDraftPatches(
      draft,
      [{ operation: 'confirm_question', questionId: question.id }],
      context
    );

    expect(updated.sections[0]!.questions[0]).toMatchObject({
      confidence: 'teacher_confirmed',
      review: 'clean',
      answerCandidates: [expect.objectContaining({ source: 'ai' })]
    });
    expect(
      updated.fieldStates.filter(
        (fieldState) => fieldState.target.kind === 'question_field' && fieldState.target.questionId === question.id
      )
    ).toEqual([
      expect.objectContaining({ confidence: 'teacher_confirmed', origin: 'teacher' }),
      expect.objectContaining({ confidence: 'teacher_confirmed', origin: 'teacher' })
    ]);

    const unresolved = buildValidExamImportDraft();
    const unresolvedQuestion = unresolved.sections[0]!.questions[0]!;
    if (unresolvedQuestion.kind !== 'choice') throw new Error('Expected choice question');
    unresolvedQuestion.answerKey = null;
    unresolvedQuestion.review = 'unresolved';

    expect(() =>
      applyExamImportDraftPatches(
        unresolved,
        [{ operation: 'confirm_question', questionId: unresolvedQuestion.id }],
        context
      )
    ).toThrowError(
      expect.objectContaining<Partial<ExamImportDraftPatchError>>({
        code: 'QUESTION_NOT_CONFIRMABLE'
      })
    );
  });
});
