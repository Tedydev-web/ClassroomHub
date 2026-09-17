import { describe, expect, it } from 'vitest';

import {
  NEW_QUESTION_POINTS,
  hasDirtyQuestionnaire,
  isTemporaryId,
  isUntouchedQuestionDraft,
  type QuestionnaireLike
} from './questionnaire-dirty';

/** A saved exercise straight from the server: nothing minted here, nothing touched. */
const clean: QuestionnaireLike = {
  questions: [{ id: 42, options: [{ id: 7 }, { id: 8 }] }],
  sections: [{ id: 's1' }]
};

describe('isTemporaryId', () => {
  it('recognises ids minted in the browser by their -form marker', () => {
    expect(isTemporaryId('1700000000000-form')).toBe(true);
    expect(isTemporaryId('1700000000000-true-form')).toBe(true);
  });

  it('treats a server id — string or number — as saved', () => {
    expect(isTemporaryId('c0ffee')).toBe(false);
    expect(isTemporaryId(42)).toBe(false);
    expect(isTemporaryId(undefined)).toBe(false);
  });
});

describe('hasDirtyQuestionnaire', () => {
  it('is false for a saved exercise nobody has touched', () => {
    expect(hasDirtyQuestionnaire(clean)).toBe(false);
  });

  it('is false for nothing at all, rather than blocking navigation on a missing exercise', () => {
    expect(hasDirtyQuestionnaire(null)).toBe(false);
    expect(hasDirtyQuestionnaire(undefined)).toBe(false);
    expect(hasDirtyQuestionnaire({})).toBe(false);
  });

  it('follows the three exercise-level flags', () => {
    expect(hasDirtyQuestionnaire({ ...clean, isTitleDirty: true })).toBe(true);
    expect(hasDirtyQuestionnaire({ ...clean, isDescriptionDirty: true })).toBe(true);
    expect(hasDirtyQuestionnaire({ ...clean, isDueByDirty: true })).toBe(true);
  });

  it('counts a question that was edited', () => {
    expect(hasDirtyQuestionnaire({ questions: [{ id: 42, isDirty: true }] })).toBe(true);
  });

  it('does not count a newly added question nobody has typed into', () => {
    // The owner's report: the leave dialog appeared on exercises where nothing had been
    // changed. An empty question loses no work when it is left behind.
    expect(hasDirtyQuestionnaire({ questions: [{ id: '1700000000000-form' }] })).toBe(false);
  });

  it('counts a deletion, because the deletion is the change', () => {
    expect(hasDirtyQuestionnaire({ questions: [{ id: 42, deletedAt: '2026-01-01' }] })).toBe(true);
    expect(hasDirtyQuestionnaire({ sections: [{ id: 's1', deletedAt: '2026-01-01' }] })).toBe(true);
  });

  it('counts one edited option of one otherwise untouched question', () => {
    expect(hasDirtyQuestionnaire({ questions: [{ id: 42, options: [{ id: 7 }, { id: 8, isDirty: true }] }] })).toBe(
      true
    );
  });

  it('counts a newly added option the same way', () => {
    expect(hasDirtyQuestionnaire({ questions: [{ id: 42, options: [{ id: '1700000000000-form' }] }] })).toBe(true);
  });

  it('counts an edited section', () => {
    expect(hasDirtyQuestionnaire({ sections: [{ id: 's1', isDirty: true }] })).toBe(true);
  });
});

/** Exactly what `handleAddQuestion` creates: a temporary id, the default point, one empty option. */
const blankDraft = {
  id: '1-form',
  title: '',
  points: NEW_QUESTION_POINTS,
  answers: [],
  settings: {},
  options: [{ id: '1-form', label: '', value: null, isCorrect: false }]
};

describe('isUntouchedQuestionDraft', () => {
  it('recognises the blank question the exercise page adds on its own', () => {
    expect(isUntouchedQuestionDraft(blankDraft)).toBe(true);
  });

  it('treats the new-question default of one point as untouched, not as an edit', () => {
    // Drafts are created with one point, the way upstream does. Counting any non-zero value
    // as an edit made every freshly added draft look touched, so none was ever cleaned up.
    expect(isUntouchedQuestionDraft({ ...blankDraft, points: NEW_QUESTION_POINTS })).toBe(true);
  });

  it('is touched once anything is typed or chosen', () => {
    expect(isUntouchedQuestionDraft({ ...blankDraft, title: 'What is 2 + 2?' })).toBe(false);
    expect(isUntouchedQuestionDraft({ ...blankDraft, points: 3 })).toBe(false);
    expect(isUntouchedQuestionDraft({ ...blankDraft, answers: ['4'] })).toBe(false);
    expect(isUntouchedQuestionDraft({ ...blankDraft, settings: { tolerance: 0 } })).toBe(false);
    expect(isUntouchedQuestionDraft({ ...blankDraft, options: [{ id: '1-form', label: 'Four', value: null }] })).toBe(
      false
    );
    expect(isUntouchedQuestionDraft({ ...blankDraft, options: [{ id: '1-form', label: '', isCorrect: true }] })).toBe(
      false
    );
  });

  it('treats zero as untouched too, for drafts saved to the browser under the old default', () => {
    expect(isUntouchedQuestionDraft({ ...blankDraft, points: 0 })).toBe(true);
  });

  it('is touched when explicitly marked, even if it was emptied again', () => {
    expect(isUntouchedQuestionDraft({ ...blankDraft, isDirty: true })).toBe(false);
  });

  it('is never true for a saved question, however empty', () => {
    expect(isUntouchedQuestionDraft({ ...blankDraft, id: 42 })).toBe(false);
  });
});

describe('hasDirtyQuestionnaire and untouched drafts', () => {
  it('stays clean when the only change is the blank draft the page added itself', () => {
    expect(hasDirtyQuestionnaire({ ...clean, questions: [...(clean.questions ?? []), blankDraft] })).toBe(false);
  });

  it('becomes dirty the moment that draft is given a title', () => {
    expect(hasDirtyQuestionnaire({ questions: [{ ...blankDraft, title: 'Draft' }] })).toBe(true);
  });

  it('still counts a new option added to a saved question', () => {
    expect(hasDirtyQuestionnaire({ questions: [{ id: 42, options: [{ id: '1700000000000-form' }] }] })).toBe(true);
  });
});
