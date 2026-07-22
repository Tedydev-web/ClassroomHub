import { describe, expect, it } from 'vitest';

import { QUESTION_TYPE_KEY, type ExerciseQuestionModel } from '@cio/question-types';

import { parseExerciseAutosave, shouldHydrateHistoricalSubmission } from './exercise-autosave-utils';

const question: ExerciseQuestionModel = {
  id: 41,
  key: 'question-contract-key',
  title: 'Choose one',
  questionType: QUESTION_TYPE_KEY.RADIO,
  points: 2,
  options: [
    { id: 1, label: 'One', isCorrect: true },
    { id: 2, label: 'Two', isCorrect: false }
  ]
};

function createSerializedAutosave(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    answers: {
      'question-contract-key': { type: 'RADIO', optionId: 1 }
    },
    scores: {},
    grades: {},
    totalPossibleGrade: 2,
    finalTotalGrade: 0,
    currentQuestionIndex: 1,
    isFinished: false,
    progressValue: 0,
    status: 1,
    comment: '',
    exerciseId: null,
    currentSectionIndex: 0,
    sectionPhase: 'questions',
    ...overrides
  });
}

describe('parseExerciseAutosave', () => {
  it('restores answers by their canonical contract key', () => {
    const parsed = parseExerciseAutosave({
      serializedValue: createSerializedAutosave(),
      exerciseId: 'exercise-1',
      questions: [question],
      sectionCount: 0
    });

    expect(parsed?.answers).toEqual({
      'question-contract-key': { type: 'RADIO', optionId: 1 }
    });
  });

  it('drops stale and malformed answers without trusting stored shapes', () => {
    const parsed = parseExerciseAutosave({
      serializedValue: createSerializedAutosave({
        answers: {
          'question-contract-key': { type: 'RADIO', optionId: 999 },
          'removed-question': { type: 'TEXTAREA', text: 'stale' }
        }
      }),
      exerciseId: 'exercise-1',
      questions: [question],
      sectionCount: 0
    });

    expect(parsed?.answers).toEqual({});
  });

  it('restores only schema-valid canonical responses for current canonical questions', () => {
    const parsed = parseExerciseAutosave({
      serializedValue: createSerializedAutosave({
        canonicalAnswers: {
          'assessment-question': {
            schemaVersion: 1,
            responses: [{ interactionId: 'choice-1', response: { kind: 'choice', selectedOptionIds: ['one'] } }]
          },
          'removed-assessment-question': {
            schemaVersion: 1,
            responses: [{ interactionId: 'choice-1', response: { kind: 'choice', selectedOptionIds: ['one'] } }]
          },
          malformed: { schemaVersion: 2, responses: [] }
        }
      }),
      exerciseId: 'exercise-1',
      questions: [question],
      sectionCount: 0,
      canonicalQuestionIds: new Set(['assessment-question'])
    });

    expect(parsed?.canonicalAnswers).toEqual({
      'assessment-question': {
        schemaVersion: 1,
        responses: [{ interactionId: 'choice-1', response: { kind: 'choice', selectedOptionIds: ['one'] } }]
      }
    });
  });

  it('accepts autosaves created before section metadata was introduced', () => {
    const legacyMetadata = JSON.parse(createSerializedAutosave()) as Record<string, unknown>;
    delete legacyMetadata.currentSectionIndex;
    delete legacyMetadata.sectionPhase;

    const parsed = parseExerciseAutosave({
      serializedValue: JSON.stringify(legacyMetadata),
      exerciseId: 'exercise-1',
      questions: [question],
      sectionCount: 0
    });

    expect(parsed?.currentSectionIndex).toBe(0);
    expect(parsed?.sectionPhase).toBe('questions');
  });

  it('rejects metadata belonging to a different exercise', () => {
    const parsed = parseExerciseAutosave({
      serializedValue: createSerializedAutosave({ exerciseId: 'exercise-2' }),
      exerciseId: 'exercise-1',
      questions: [question],
      sectionCount: 0
    });

    expect(parsed).toBeNull();
  });

  it('rejects out-of-range navigation and non-finite numeric records', () => {
    const outOfRange = parseExerciseAutosave({
      serializedValue: createSerializedAutosave({ currentQuestionIndex: 3 }),
      exerciseId: 'exercise-1',
      questions: [question],
      sectionCount: 0
    });
    const nonFiniteScore = parseExerciseAutosave({
      serializedValue: createSerializedAutosave({ scores: { 41: 'NaN' } }),
      exerciseId: 'exercise-1',
      questions: [question],
      sectionCount: 0
    });
    const outOfRangeSection = parseExerciseAutosave({
      serializedValue: createSerializedAutosave({ currentSectionIndex: 2 }),
      exerciseId: 'exercise-1',
      questions: [question],
      sectionCount: 2
    });

    expect(outOfRange).toBeNull();
    expect(nonFiniteScore).toBeNull();
    expect(outOfRangeSection).toBeNull();
  });
});

describe('shouldHydrateHistoricalSubmission', () => {
  const readyState = {
    hasRestoredUnfinishedDraft: false,
    skipHydration: false,
    isExerciseLoaded: true,
    hasSubmissions: true,
    isFinished: false
  };

  it('hydrates the latest submission when no unfinished draft takes precedence', () => {
    expect(shouldHydrateHistoricalSubmission(readyState)).toBe(true);
  });

  it('keeps a restored unfinished draft instead of replacing it with submission history', () => {
    expect(
      shouldHydrateHistoricalSubmission({
        ...readyState,
        hasRestoredUnfinishedDraft: true
      })
    ).toBe(false);
  });

  it('honors the current-session retry guard', () => {
    expect(
      shouldHydrateHistoricalSubmission({
        ...readyState,
        skipHydration: true
      })
    ).toBe(false);
  });
});
