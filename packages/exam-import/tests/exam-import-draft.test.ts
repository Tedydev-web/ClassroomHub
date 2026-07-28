import { describe, expect, it } from 'vitest';
import { examImportDiagnosticSchema, examImportDraftSchema } from '../src/draft/exam-import-draft';
import { buildValidExamImportDraft, sourceSpan } from './fixtures/exam-import-draft-fixture';

describe('ExamImportDraft schema', () => {
  it('accepts a strict typed draft with stable field targets and fractional points', () => {
    expect(examImportDraftSchema.parse(buildValidExamImportDraft())).toEqual(buildValidExamImportDraft());
  });

  it('rejects unknown fields instead of silently discarding future or misspelled data', () => {
    const draft = { ...buildValidExamImportDraft(), unexpected: true };

    expect(examImportDraftSchema.safeParse(draft).success).toBe(false);
  });

  it('rejects an answer key whose shape does not match the question kind', () => {
    const draft = buildValidExamImportDraft();
    const question = draft.sections[0]!.questions[0]!;
    const malformed = {
      ...draft,
      sections: [
        {
          ...draft.sections[0]!,
          questions: [
            {
              ...question,
              answerKey: {
                kind: 'numeric',
                value: 42,
                tolerance: null,
                agreement: 'single_source',
                selectedCandidateIds: ['candidate-1'],
                conflictingCandidateIds: []
              }
            }
          ]
        }
      ]
    };

    expect(examImportDraftSchema.safeParse(malformed).success).toBe(false);
  });

  it('rejects point values with more precision than the assessment kernel can preserve', () => {
    const draft = buildValidExamImportDraft();
    const question = draft.sections[0]!.questions[0]!;
    const malformed = {
      ...draft,
      sections: [
        {
          ...draft.sections[0]!,
          questions: [{ ...question, points: 0.125 }]
        }
      ]
    };

    expect(examImportDraftSchema.safeParse(malformed).success).toBe(false);
  });

  it('keeps assisted diagnostics advisory-only at the schema boundary', () => {
    const malformed = {
      tier: 'assisted',
      severity: 'error',
      blocking: true,
      code: 'AI_CONTENT_CONCERN',
      message: 'The generated content may be inconsistent.',
      messageKey: 'exam_import.diagnostics.ai_content_concern',
      questionId: 'question-1',
      target: null,
      provenance: [sourceSpan]
    };

    expect(examImportDiagnosticSchema.safeParse(malformed).success).toBe(false);
  });
});
