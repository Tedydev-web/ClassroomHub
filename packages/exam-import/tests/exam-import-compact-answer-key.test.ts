import { describe, expect, it } from 'vitest';
import {
  ExamImportCompactAnswerKeyError,
  applyExamImportCompactAnswerKey
} from '../src/draft/exam-import-compact-answer-key';
import { buildValidExamImportDraft } from './fixtures/exam-import-draft-fixture';

const context = {
  enabledQuestionKinds: new Set(['choice', 'true_false_group', 'short_answer', 'numeric', 'essay'] as const)
};

describe('applyExamImportCompactAnswerKey', () => {
  it('fills missing answers by global question order and preserves existing answers', () => {
    const draft = buildValidExamImportDraft();
    const firstQuestion = draft.sections[0]!.questions[0]!;
    const secondQuestion = structuredClone(firstQuestion);
    secondQuestion.id = 'question-2';
    secondQuestion.order = 1;
    secondQuestion.sourceNumber = '2';
    secondQuestion.options = secondQuestion.options.map((option) => ({
      ...option,
      id: option.id.replace('option-', 'question-2-option-')
    }));
    secondQuestion.answerCandidates = [];
    secondQuestion.answerKey = null;
    secondQuestion.review = 'unresolved';
    secondQuestion.confidence = 'none';
    draft.sections[0]!.questions.push(secondQuestion);

    const result = applyExamImportCompactAnswerKey(draft, '1B 2A', context);
    const questions = result.draft.sections[0]!.questions;

    expect(result.appliedCount).toBe(1);
    expect(questions[0]!.answerKey).toEqual(firstQuestion.answerKey);
    expect(questions[1]!.answerKey).toMatchObject({
      kind: 'choice',
      correctOptionIds: ['question-2-option-a'],
      selectedCandidateIds: ['teacher-answer']
    });
  });

  it('rejects a key that does not cover every missing answer', () => {
    const draft = buildValidExamImportDraft();
    const question = draft.sections[0]!.questions[0]!;
    question.answerCandidates = [];
    question.answerKey = null;
    question.review = 'unresolved';
    question.confidence = 'none';

    expect(() => applyExamImportCompactAnswerKey(draft, '2A', context)).toThrowError(
      expect.objectContaining<Partial<ExamImportCompactAnswerKeyError>>({
        code: 'ANSWER_KEY_COUNT_MISMATCH'
      })
    );
  });

  it('accepts one unnumbered answer per line for missing questions', () => {
    const draft = buildValidExamImportDraft();
    const question = draft.sections[0]!.questions[0]!;
    question.answerCandidates = [];
    question.answerKey = null;
    question.review = 'unresolved';
    question.confidence = 'none';

    const result = applyExamImportCompactAnswerKey(draft, 'A', context);

    expect(result.appliedCount).toBe(1);
    expect(result.draft.sections[0]!.questions[0]!.answerKey).toMatchObject({
      kind: 'choice',
      correctOptionIds: ['option-a']
    });
  });

  it('does not require a compact answer for a manual short-answer question', () => {
    const draft = buildValidExamImportDraft();
    draft.sections[0]!.questions[0] = {
      id: 'question-1',
      kind: 'short_answer',
      order: 0,
      sourceNumber: '1',
      promptHtml: '<p>Explain your answer.</p>',
      points: 1,
      cognitiveLevel: null,
      passageId: null,
      answerCandidates: [],
      answerKey: null,
      confidence: 'none',
      review: 'unresolved',
      provenance: []
    };

    const result = applyExamImportCompactAnswerKey(draft, 'A', context);

    expect(result.appliedCount).toBe(0);
    expect(result.draft.sections[0]!.questions[0]!.answerKey).toBeNull();
  });
});
