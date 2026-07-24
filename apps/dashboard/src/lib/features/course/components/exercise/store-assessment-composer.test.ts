import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

import {
  clearAssessmentComposerRegistry,
  assessmentComposerPreviewItems,
  dirtyAssessmentComposerIds,
  wideAssessmentComposerIds,
  getQuestionPlacementItemsForSection,
  handleAddQuestion,
  handleAddSection,
  handleRemoveSection,
  handleReorderQuestionPlacementItems,
  questionnaire,
  prepareDirtyAssessmentItemMutations,
  reconcileAssessmentItemMutations,
  removeUntouchedLegacyQuestionDrafts,
  removeAssessmentComposerPreviewItem,
  registerAssessmentComposerSaveHandler,
  registerAssessmentComposerMutationHandler,
  saveDirtyAssessmentComposers,
  setAssessmentComposerDirty,
  setAssessmentComposerPreviewItem,
  setAssessmentComposerWide
} from './store';

const sectionOneId = '38b93783-427c-49e2-9c62-5c788fd28839';
const sectionTwoId = '08888548-1123-412e-9a78-58ce0c13785e';

function setSectionedCanonicalQuestionnaire() {
  questionnaire.set({
    questions: [],
    canonicalQuestions: [
      {
        id: 16,
        title: 'Target item',
        points: 1,
        order: 2,
        exerciseSectionId: sectionTwoId,
        gradingMode: 'manual',
        revisionId: 'revision-16',
        revision: 1,
        definition: { schemaVersion: 1, blocks: [] },
        authorDefinition: { schemaVersion: 1, blocks: [], feedback: [] }
      },
      {
        id: 17,
        title: 'Moved item',
        points: 1,
        order: 0,
        exerciseSectionId: sectionOneId,
        gradingMode: 'manual',
        revisionId: 'revision-17',
        revision: 1,
        definition: { schemaVersion: 1, blocks: [] },
        authorDefinition: { schemaVersion: 1, blocks: [], feedback: [] }
      }
    ],
    sections: [
      {
        id: sectionOneId,
        title: 'Section one',
        description: null,
        order: 0,
        colorTheme: 'blue',
        afterBehavior: { action: 'continue' }
      },
      {
        id: sectionTwoId,
        title: 'Section two',
        description: null,
        order: 1,
        colorTheme: 'green',
        afterBehavior: { action: 'go_to_section', exerciseSectionId: sectionOneId }
      }
    ],
    sectionDisplayMode: 'all_questions',
    totalSubmissions: 0
  });
}

describe('assessment composer save registry', () => {
  afterEach(clearAssessmentComposerRegistry);

  it('saves only dirty composers in registration-independent dirty order', async () => {
    const firstSave = vi.fn(async () => true);
    const secondSave = vi.fn(async () => true);
    registerAssessmentComposerSaveHandler('first', firstSave);
    registerAssessmentComposerSaveHandler('second', secondSave);
    setAssessmentComposerDirty('second', true);

    await expect(saveDirtyAssessmentComposers()).resolves.toBe(true);
    expect(firstSave).not.toHaveBeenCalled();
    expect(secondSave).toHaveBeenCalledOnce();
  });

  it('stops after the first failed save and unregisters dirty state', async () => {
    const firstSave = vi.fn(async () => false);
    const secondSave = vi.fn(async () => true);
    const unregisterFirst = registerAssessmentComposerSaveHandler('first', firstSave);
    registerAssessmentComposerSaveHandler('second', secondSave);
    setAssessmentComposerDirty('first', true);
    setAssessmentComposerDirty('second', true);

    await expect(saveDirtyAssessmentComposers()).resolves.toBe(false);
    expect(firstSave).toHaveBeenCalledOnce();
    expect(secondSave).not.toHaveBeenCalled();

    unregisterFirst();
    expect(get(dirtyAssessmentComposerIds).has('first')).toBe(false);
  });

  it('publishes and removes draft snapshots for teacher preview', () => {
    const previewItem = {
      exerciseId: 'exercise-1',
      questionId: 42,
      title: 'Draft assessment',
      points: 0,
      order: 3,
      exerciseSectionId: sectionTwoId,
      gradingMode: 'manual' as const,
      definition: {
        schemaVersion: 1 as const,
        blocks: []
      }
    };

    setAssessmentComposerPreviewItem('exercise-1:42', previewItem);

    expect(get(assessmentComposerPreviewItems)).toEqual({
      'exercise-1:42': previewItem
    });

    removeAssessmentComposerPreviewItem('exercise-1:42');
    expect(get(assessmentComposerPreviewItems)).toEqual({});
  });

  it('tracks composers that require the wide authoring workspace and clears stale registrations', () => {
    setAssessmentComposerWide('passage-1', true);
    setAssessmentComposerWide('passage-2', true);
    setAssessmentComposerWide('passage-1', false);

    expect([...get(wideAssessmentComposerIds)]).toEqual(['passage-2']);

    clearAssessmentComposerRegistry();
    expect(get(wideAssessmentComposerIds).size).toBe(0);
  });

  it('prepares and reconciles dirty assessment mutations by stable client ID', async () => {
    setSectionedCanonicalQuestionnaire();
    const mutation = {
      action: 'publish' as const,
      clientMutationId: 'composer-16',
      questionId: 16,
      title: 'Target item',
      expectedRevision: 1,
      definition: { schemaVersion: 1 as const, blocks: [], feedback: [] }
    };
    const reconcile = vi.fn();
    registerAssessmentComposerMutationHandler('composer-16', {
      prepare: () => mutation,
      reconcile
    });
    setAssessmentComposerDirty('composer-16', true);

    expect(prepareDirtyAssessmentItemMutations()).toEqual({ success: true, mutations: [mutation] });
    const canonicalQuestions = get(questionnaire).canonicalQuestions;
    await expect(
      reconcileAssessmentItemMutations([{ clientMutationId: 'composer-16', questionId: 16 }], canonicalQuestions)
    ).resolves.toBe(true);
    expect(reconcile).toHaveBeenCalledWith(canonicalQuestions[0]);
  });

  it('moves canonical questions to the nearest section with collision-free placement on section deletion', () => {
    setSectionedCanonicalQuestionnaire();

    handleRemoveSection(sectionOneId, sectionTwoId);

    const state = get(questionnaire);
    expect(state.sections.find((section) => section.id === sectionOneId)?.deletedAt).toEqual(expect.any(String));
    expect(state.sections.find((section) => section.id === sectionTwoId)?.afterBehavior).toEqual({
      action: 'continue'
    });
    expect(state.canonicalQuestions).toEqual([
      expect.objectContaining({ id: 16, exerciseSectionId: sectionTwoId, order: 2 }),
      expect.objectContaining({
        id: 17,
        exerciseSectionId: sectionTwoId,
        order: 3,
        isPlacementDirty: true
      })
    ]);
  });

  it('moves unsectioned canonical questions into the initial section group', () => {
    setSectionedCanonicalQuestionnaire();
    questionnaire.update((state) => ({
      ...state,
      canonicalQuestions: state.canonicalQuestions.map((question) => ({
        ...question,
        exerciseSectionId: null
      })),
      sections: []
    }));

    handleAddSection();

    const state = get(questionnaire);
    const initialSection = state.sections[0];
    expect(state.sections).toHaveLength(2);
    expect(initialSection).toBeDefined();
    expect(state.canonicalQuestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exerciseSectionId: initialSection?.id,
          isPlacementDirty: true
        })
      ])
    );
  });

  it('reorders mixed legacy and canonical questions through one placement contract', () => {
    setSectionedCanonicalQuestionnaire();
    questionnaire.update((state) => ({
      ...state,
      questions: [
        {
          id: 1,
          title: 'Legacy item',
          questionTypeId: 1,
          questionType: { id: 1, label: 'Single answer' },
          points: 1,
          order: 1,
          exerciseSectionId: sectionTwoId,
          options: [],
          settings: {}
        }
      ]
    }));

    const beforeReorder = get(questionnaire);
    const mixedItems = getQuestionPlacementItemsForSection(
      beforeReorder.questions,
      beforeReorder.canonicalQuestions,
      sectionTwoId
    );
    const targetItem = mixedItems.find((item) => item.kind === 'canonical' && item.question.id === 16);
    const legacyItem = mixedItems.find((item) => item.kind === 'legacy');
    expect(targetItem).toBeDefined();
    expect(legacyItem).toBeDefined();

    handleReorderQuestionPlacementItems(sectionTwoId, [targetItem!, legacyItem!]);

    const afterReorder = get(questionnaire);
    expect(afterReorder.canonicalQuestions.find((question) => question.id === 16)).toMatchObject({
      order: 0,
      isPlacementDirty: true
    });
    expect(afterReorder.questions[0]).toMatchObject({ order: 1 });
  });

  it('places a new legacy question after the canonical questions in its section', () => {
    setSectionedCanonicalQuestionnaire();

    handleAddQuestion(sectionOneId);

    expect(get(questionnaire).questions).toEqual([
      expect.objectContaining({
        exerciseSectionId: sectionOneId,
        order: 1
      })
    ]);
  });

  it('removes only untouched temporary legacy drafts before canonical authoring', () => {
    setSectionedCanonicalQuestionnaire();
    questionnaire.update((state) => ({
      ...state,
      questions: [
        {
          id: '1-form',
          title: '',
          answers: [],
          points: 0,
          order: 0,
          exerciseSectionId: null,
          questionTypeId: 1,
          questionType: { id: 1, label: 'Single answer' },
          options: [{ id: '1-form', label: '', value: null, isCorrect: false }],
          settings: {}
        }
      ]
    }));

    removeUntouchedLegacyQuestionDrafts();

    expect(get(questionnaire).questions).toEqual([]);
  });

  it('preserves a temporary legacy draft after the author has touched it', () => {
    setSectionedCanonicalQuestionnaire();
    questionnaire.update((state) => ({
      ...state,
      questions: [
        {
          id: '1-form',
          title: 'Keep this question',
          answers: [],
          points: 0,
          order: 0,
          exerciseSectionId: null,
          questionTypeId: 1,
          questionType: { id: 1, label: 'Single answer' },
          options: [{ id: '1-form', label: '', value: null, isCorrect: false }],
          settings: {}
        }
      ]
    }));

    removeUntouchedLegacyQuestionDrafts();

    expect(get(questionnaire).questions).toHaveLength(1);
  });
});
