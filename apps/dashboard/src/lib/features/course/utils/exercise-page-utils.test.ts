import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { ZExerciseUpdate } from '@cio/utils/validation/exercise';

import { questionnaire } from '$features/course/components/exercise/store';
import type { Exercise } from '$features/course/utils/types';
import {
  getLearnerSectionQuestionDisplayStorageKey,
  resolveLearnerSectionQuestionDisplay
} from './exercise-section-display-mode';
import { hydrateExercisePageData } from './exercise-page-utils';

vi.mock('$features/course/api', () => ({ exerciseApi: {} }));

describe('section display modes', () => {
  it('accepts every supported policy in the update contract', () => {
    for (const sectionDisplayMode of ['one_question', 'all_questions', 'learner_choice']) {
      expect(ZExerciseUpdate.safeParse({ sectionDisplayMode }).success).toBe(true);
    }
  });

  it('keeps legacy policies fixed and resolves learner_choice locally', () => {
    expect(resolveLearnerSectionQuestionDisplay('one_question', 'all_questions')).toBe('one_question');
    expect(resolveLearnerSectionQuestionDisplay('all_questions', 'one_question')).toBe('all_questions');
    expect(resolveLearnerSectionQuestionDisplay('learner_choice', 'all_questions')).toBe('all_questions');
    expect(getLearnerSectionQuestionDisplayStorageKey('exercise-123')).toBe(
      'exercise-section-question-display:exercise-123'
    );
  });
});

describe('hydrateExercisePageData canonical section recovery', () => {
  it('recovers an unsectioned canonical question into a visible dirty section', () => {
    const exercise = {
      id: 'exercise-a',
      title: 'Exercise',
      sections: [
        {
          id: '38b93783-427c-49e2-9c62-5c788fd28839',
          title: 'Section one',
          description: null,
          order: 0,
          colorTheme: 'blue',
          afterBehavior: { action: 'continue' },
          questions: []
        }
      ],
      questions: [],
      canonicalQuestions: [
        {
          id: 16,
          title: 'Recovered item',
          points: 1,
          order: 0,
          exerciseSectionId: null,
          gradingMode: 'manual',
          revisionId: 'revision-16',
          revision: 1,
          definition: { schemaVersion: 1, blocks: [] },
          authorDefinition: { schemaVersion: 1, blocks: [], feedback: [] }
        }
      ]
    } as unknown as Exercise;

    hydrateExercisePageData(exercise, 'exercise-a');

    const state = get(questionnaire);
    const recoveredQuestion = state.canonicalQuestions[0];
    const recoverySection = state.sections.find((section) => section.id === recoveredQuestion?.exerciseSectionId);
    expect(recoverySection).toMatchObject({ title: 'Untitled section', isDirty: true });
    expect(recoveredQuestion).toMatchObject({ isPlacementDirty: true });
  });
});
