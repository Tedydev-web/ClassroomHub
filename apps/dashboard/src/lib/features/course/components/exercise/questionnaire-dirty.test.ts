import { describe, expect, it } from 'vitest';

import { hasDirtyQuestionnaire, isTemporaryId, type QuestionnaireLike } from './questionnaire-dirty';

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

  it('counts a newly added question before anything is typed into it', () => {
    expect(hasDirtyQuestionnaire({ questions: [{ id: '1700000000000-form' }] })).toBe(true);
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
