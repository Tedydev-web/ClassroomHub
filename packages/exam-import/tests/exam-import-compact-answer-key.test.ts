import { describe, expect, it } from 'vitest';
import {
  ExamImportCompactAnswerKeyError,
  applyExamImportCompactAnswerKey
} from '../src/draft/exam-import-compact-answer-key';
import { validateExamImportDraft } from '../src/draft/exam-import-validation';
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

  it('keeps the answers a partial numbered key does cover, and still blocks publishing', () => {
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
    draft.sections[0]!.questions.push(secondQuestion);
    for (const question of draft.sections[0]!.questions) {
      question.answerCandidates = [];
      question.answerKey = null;
      question.review = 'unresolved';
      question.confidence = 'none';
    }

    const result = applyExamImportCompactAnswerKey(draft, '1B', context);

    expect(result.appliedCount).toBe(1);
    expect(result.draft.sections[0]!.questions[0]!.answerKey).toMatchObject({
      kind: 'choice',
      correctOptionIds: ['option-b']
    });
    expect(result.draft.sections[0]!.questions[1]!.answerKey).toBeNull();
    // The decision was that a partial key blocks. Keeping the entry that parsed does not
    // weaken it: the question still without a key raises its own blocking finding.
    expect(validateExamImportDraft(result.draft, context).publishable).toBe(false);
  });

  it('names the problem when a numbered key covers none of the missing answers', () => {
    // Applying nothing is not a malformed patch, and saying so was how it read: the patch
    // layer rejects an empty operation list with a message about the patch, which tells a
    // teacher nothing about their key.
    // Question 1 already has an answer; question 2 is the one still missing. A key naming
    // only question 1 therefore covers nothing that needs covering.
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

    expect(() => applyExamImportCompactAnswerKey(draft, '1B', context)).toThrowError(
      expect.objectContaining<Partial<ExamImportCompactAnswerKeyError>>({
        code: 'ANSWER_KEY_COUNT_MISMATCH'
      })
    );
  });

  it('rejects an unnumbered key whose length disagrees with the missing answers', () => {
    // Positional keys carry no question numbers, so a short one cannot be applied in part —
    // every answer after the gap would land on the wrong question. Numbers are what make
    // partial application safe, and this path has none. Do not unify it with the one above.
    const draft = buildValidExamImportDraft();
    const question = draft.sections[0]!.questions[0]!;
    const second = structuredClone(question);
    second.id = 'question-2';
    second.order = 1;
    second.sourceNumber = '2';
    second.options = second.options.map((option) => ({
      ...option,
      id: option.id.replace('option-', 'question-2-option-')
    }));
    draft.sections[0]!.questions.push(second);
    for (const candidate of draft.sections[0]!.questions) {
      candidate.answerCandidates = [];
      candidate.answerKey = null;
      candidate.review = 'unresolved';
      candidate.confidence = 'none';
    }

    expect(() => applyExamImportCompactAnswerKey(draft, 'A', context)).toThrowError(
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
