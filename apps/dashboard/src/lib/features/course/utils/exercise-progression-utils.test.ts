import { describe, expect, it } from 'vitest';

import type { Question } from '$features/course/types';
import type { SubmissionListItem } from '$features/course/utils/types';
import type { TAssessmentItemMutation } from '@cio/utils/validation/exercise';
import {
  formatExercisePoints,
  getExerciseGradingSummary,
  getManualGradedExerciseQuestions,
  getTotalPossibleExercisePoints,
  groupSubmissionsByStudentAndAttempt,
  orderExerciseItemsBySections,
  projectCanonicalQuestionsAfterMutations,
  roundExercisePointsForDisplay,
  shouldCompleteExerciseFromSubmission
} from './exercise-progression-utils';

function makeQuestion(overrides: Partial<Question>): Question {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? 'Question',
    points: overrides.points ?? 1,
    questionTypeId: overrides.questionTypeId ?? 1,
    questionType: overrides.questionType,
    options: [],
    ...overrides
  } as Question;
}

function makeSubmission(overrides: Partial<SubmissionListItem> & { id: string }): SubmissionListItem {
  return {
    id: overrides.id,
    statusId: overrides.statusId ?? 1,
    gradingState: overrides.gradingState,
    total: overrides.total ?? 0,
    score: overrides.score,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    groupmember: overrides.groupmember ?? {
      profile: {
        id: 'student-1',
        fullname: 'Student One',
        avatarUrl: ''
      }
    },
    answers: overrides.answers ?? []
  } as unknown as SubmissionListItem;
}

function makeAssessmentMutation(params: {
  action: 'create' | 'publish';
  clientMutationId: string;
  questionId?: number;
  title: string;
  maxScore: number;
  gradingMode: 'auto' | 'manual';
}): TAssessmentItemMutation {
  const interaction =
    params.gradingMode === 'auto'
      ? {
          kind: 'choice' as const,
          prompt: { format: 'html' as const, html: 'Choose' },
          required: true,
          maxScore: params.maxScore,
          config: {
            cardinality: 'single' as const,
            presentation: 'list' as const,
            options: [
              { id: 'a', html: 'A' },
              { id: 'b', html: 'B' }
            ],
            correctOptionIds: ['a']
          }
        }
      : {
          kind: 'text' as const,
          prompt: { format: 'html' as const, html: 'Explain' },
          required: true,
          maxScore: params.maxScore,
          config: { format: 'rich' as const }
        };
  const definition = {
    schemaVersion: 1 as const,
    blocks: [{ id: 'interaction-1', kind: 'interaction' as const, interaction }],
    feedback: []
  };

  if (params.action === 'publish') {
    if (params.questionId === undefined) throw new Error('Publish mutation requires a question id');

    return {
      action: 'publish',
      clientMutationId: params.clientMutationId,
      questionId: params.questionId,
      title: params.title,
      expectedRevision: 1,
      definition
    };
  }

  return {
    action: 'create',
    clientMutationId: params.clientMutationId,
    title: params.title,
    exerciseSectionId: null,
    order: 0,
    definition
  };
}

describe('exercise progression helpers', () => {
  it('orders mixed items by section before their section-local question order', () => {
    const items = [
      { id: 'section-b-first', question: { id: 3, order: 0, exerciseSectionId: 'section-b' } },
      { id: 'unsectioned', question: { id: 4, order: 0, exerciseSectionId: null } },
      { id: 'section-a-second', question: { id: 2, order: 1, exerciseSectionId: 'section-a' } },
      { id: 'section-a-first', question: { id: 1, order: 0, exerciseSectionId: 'section-a' } }
    ];
    const sections = [
      { id: 'section-b', order: 1 },
      { id: 'section-a', order: 0 }
    ];

    expect(orderExerciseItemsBySections(items, sections).map((item) => item.id)).toEqual([
      'section-a-first',
      'section-a-second',
      'section-b-first',
      'unsectioned'
    ]);
  });

  it('detects manual-graded questions from question type ids', () => {
    const questions = [
      makeQuestion({ id: 1, questionTypeId: 1 }),
      makeQuestion({ id: 2, questionTypeId: 3 }),
      makeQuestion({ id: 3, questionTypeId: 8 })
    ];

    expect(getManualGradedExerciseQuestions(questions).map((question) => question.id)).toEqual([2, 3]);
  });

  it('calculates total possible points from active questions', () => {
    const questions = [
      makeQuestion({ id: 1, points: 3 }),
      makeQuestion({ id: 2, points: 2 }),
      makeQuestion({ id: 3, points: 20, deletedAt: '2026-01-01' })
    ];

    expect(getTotalPossibleExercisePoints(questions)).toBe(5);
  });

  it('summarizes legacy and canonical questions through one grading policy', () => {
    const questions = [makeQuestion({ id: 1, points: 2, questionTypeId: 1 })];
    const canonicalQuestions = [
      { id: 2, title: 'Automatic item', points: 3, gradingMode: 'auto' as const },
      { id: 3, title: 'Hybrid item', points: 5, gradingMode: 'hybrid' as const }
    ];

    expect(getExerciseGradingSummary(questions, canonicalQuestions)).toEqual({
      questionCount: 3,
      totalPossiblePoints: 10,
      isFullyAutoGradable: false,
      manualCanonicalQuestions: [canonicalQuestions[1]]
    });

    expect(getExerciseGradingSummary(questions, canonicalQuestions.slice(0, 1))).toEqual({
      questionCount: 2,
      totalPossiblePoints: 5,
      isFullyAutoGradable: true,
      manualCanonicalQuestions: []
    });
  });

  it('projects a new canonical question from its pending create mutation', () => {
    const mutation = makeAssessmentMutation({
      action: 'create',
      clientMutationId: 'new-question',
      title: 'New automatic question',
      maxScore: 0,
      gradingMode: 'auto'
    });

    expect(projectCanonicalQuestionsAfterMutations([], [mutation])).toEqual([
      {
        id: 'new-question',
        title: 'New automatic question',
        points: 0,
        gradingMode: 'auto'
      }
    ]);
  });

  it('projects publish mutations over the persisted canonical grading summary', () => {
    const currentQuestions = [{ id: 7, title: 'Manual question', points: 3, gradingMode: 'manual' as const }];
    const mutation = makeAssessmentMutation({
      action: 'publish',
      clientMutationId: 'question-7',
      questionId: 7,
      title: 'Automatic revision',
      maxScore: 4.25,
      gradingMode: 'auto'
    });

    expect(projectCanonicalQuestionsAfterMutations(currentQuestions, [mutation])).toEqual([
      {
        id: 7,
        title: 'Automatic revision',
        points: 4.25,
        gradingMode: 'auto'
      }
    ]);
  });

  it('includes a publish mutation even when the persisted projection is stale', () => {
    const mutation = makeAssessmentMutation({
      action: 'publish',
      clientMutationId: 'question-11',
      questionId: 11,
      title: 'Recovered question',
      maxScore: 2,
      gradingMode: 'manual'
    });

    expect(projectCanonicalQuestionsAfterMutations([], [mutation])).toEqual([
      {
        id: 11,
        title: 'Recovered question',
        points: 2,
        gradingMode: 'manual'
      }
    ]);
  });

  it('decides when a submission completes a passed-policy exercise', () => {
    const passingSubmission = makeSubmission({
      id: 'passing',
      gradingState: 'completed',
      total: 8
    });
    const failingSubmission = makeSubmission({
      id: 'failing',
      gradingState: 'completed',
      total: 6
    });
    const awaitingManualSubmission = makeSubmission({
      id: 'manual',
      gradingState: 'awaiting_manual',
      total: 10
    });

    expect(
      shouldCompleteExerciseFromSubmission({
        completionPolicy: 'passed',
        passThreshold: 70,
        totalPossiblePoints: 10,
        submission: passingSubmission
      })
    ).toBe(true);
    expect(
      shouldCompleteExerciseFromSubmission({
        completionPolicy: 'passed',
        passThreshold: 70,
        totalPossiblePoints: 10,
        submission: failingSubmission
      })
    ).toBe(false);
    expect(
      shouldCompleteExerciseFromSubmission({
        completionPolicy: 'passed',
        passThreshold: 70,
        totalPossiblePoints: 10,
        submission: awaitingManualSubmission
      })
    ).toBe(false);
  });

  it('treats submitted-policy submissions as complete regardless of grading state', () => {
    const submission = makeSubmission({
      id: 'submitted',
      gradingState: 'awaiting_manual',
      total: 0
    });

    expect(
      shouldCompleteExerciseFromSubmission({
        completionPolicy: 'submitted',
        passThreshold: 100,
        totalPossiblePoints: 0,
        submission
      })
    ).toBe(true);
  });

  it('prefers the exact submission score over the rounded legacy total', () => {
    const submission = makeSubmission({
      id: 'exact-score',
      gradingState: 'completed',
      score: 7.5,
      total: 8
    });

    expect(
      shouldCompleteExerciseFromSubmission({
        completionPolicy: 'passed',
        passThreshold: 78,
        totalPossiblePoints: 10,
        submission
      })
    ).toBe(false);
  });

  it('groups submissions by student and orders attempts by submission date', () => {
    const olderAttempt = makeSubmission({
      id: 'attempt-1',
      total: 4,
      createdAt: '2026-01-01T00:00:00.000Z'
    });
    const newerAttempt = makeSubmission({
      id: 'attempt-2',
      total: 9,
      createdAt: '2026-01-02T00:00:00.000Z'
    });

    const groups = groupSubmissionsByStudentAndAttempt([newerAttempt, olderAttempt]);

    expect(groups).toHaveLength(1);
    expect(groups[0].attempts.map((attempt) => attempt.submission.id)).toEqual(['attempt-1', 'attempt-2']);
    expect(groups[0].attempts.map((attempt) => attempt.attemptNumber)).toEqual([1, 2]);
  });
});

describe('exercise point display formatting', () => {
  it('removes floating-point artifacts from summed fractional points', () => {
    expect(formatExercisePoints(0.1 + 0.2)).toBe('0.3');
    expect(roundExercisePointsForDisplay(0.1 + 0.2)).toBe(0.3);
  });

  it('keeps integers without decimal noise', () => {
    expect(formatExercisePoints(5)).toBe('5');
    expect(formatExercisePoints(0)).toBe('0');
    expect(roundExercisePointsForDisplay(10)).toBe(10);
  });

  it('preserves up to two decimals and rounds anything beyond that', () => {
    expect(formatExercisePoints(7.25)).toBe('7.25');
    expect(formatExercisePoints(7.5)).toBe('7.5');
    expect(formatExercisePoints(7.256)).toBe('7.26');
  });

  it('coerces numeric strings the way score payloads arrive', () => {
    expect(formatExercisePoints('7.50')).toBe('7.5');
  });

  it('falls back to zero for non-finite or missing values', () => {
    expect(formatExercisePoints(Number.NaN)).toBe('0');
    expect(formatExercisePoints(Number.POSITIVE_INFINITY)).toBe('0');
    expect(formatExercisePoints('not-a-number')).toBe('0');
    expect(formatExercisePoints(null)).toBe('0');
    expect(formatExercisePoints(undefined)).toBe('0');
    expect(roundExercisePointsForDisplay(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});
