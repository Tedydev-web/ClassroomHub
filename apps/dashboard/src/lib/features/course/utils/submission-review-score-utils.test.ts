import { describe, expect, it } from 'vitest';
import type { AssessmentDeliveryDefinition, AssessmentResponseEnvelope } from '@cio/question-types';
import {
  getCanonicalAssessmentReviewItems,
  sumAnswerScoresForRenderedQuestions
} from './submission-review-score-utils';

const attemptedDefinition: AssessmentDeliveryDefinition = {
  schemaVersion: 1,
  blocks: [
    {
      id: 'choice-1',
      kind: 'interaction',
      interaction: {
        kind: 'choice',
        prompt: { format: 'html', html: '<p>Attempted revision prompt</p>' },
        required: true,
        maxScore: 2,
        config: {
          cardinality: 'single',
          options: [
            { id: 'option-a', html: 'A' },
            { id: 'option-b', html: 'B' }
          ],
          minChoices: 1,
          maxChoices: 1
        }
      }
    }
  ]
};

const attemptedResponse: AssessmentResponseEnvelope = {
  schemaVersion: 1,
  responses: [{ interactionId: 'choice-1', response: { kind: 'choice', selectedOptionIds: ['option-a'] } }]
};

describe('sumAnswerScoresForRenderedQuestions', () => {
  it('excludes answers whose question is not rendered (archived after the attempt)', () => {
    const renderedQuestions = [{ id: 1 }, { id: 2 }];
    const answers = [
      { questionId: 1, score: 2 },
      { questionId: 2, score: 1 },
      // Archived question: still stored on the submission but no longer rendered.
      { questionId: 99, score: 5 }
    ];

    expect(sumAnswerScoresForRenderedQuestions(renderedQuestions, answers)).toBe(3);
  });

  it('preserves fractional scores', () => {
    const renderedQuestions = [{ id: 1 }, { id: 2 }];
    const answers = [
      { questionId: 1, score: 2.5 },
      { questionId: 2, score: 0.25 }
    ];

    expect(sumAnswerScoresForRenderedQuestions(renderedQuestions, answers)).toBe(2.75);
  });

  it('falls back from score to legacy point and treats missing values as zero', () => {
    const renderedQuestions = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const answers = [
      { questionId: 1, score: null, point: 1.5 },
      { questionId: 2, score: undefined, point: undefined },
      { questionId: 3, score: '2.5' }
    ];

    expect(sumAnswerScoresForRenderedQuestions(renderedQuestions, answers)).toBe(4);
  });

  it('matches string question ids against numeric answer question ids', () => {
    const renderedQuestions = [{ id: '7' }];
    const answers = [{ questionId: 7, score: 4 }];

    expect(sumAnswerScoresForRenderedQuestions(renderedQuestions, answers)).toBe(4);
  });

  it('ignores non-numeric question ids and handles missing answers', () => {
    const renderedQuestions = [{ id: 'draft-question' }];

    expect(sumAnswerScoresForRenderedQuestions(renderedQuestions, [{ questionId: NaN, score: 3 }])).toBe(0);
    expect(sumAnswerScoresForRenderedQuestions(renderedQuestions, null)).toBe(0);
    expect(sumAnswerScoresForRenderedQuestions(renderedQuestions, undefined)).toBe(0);
  });
});

describe('getCanonicalAssessmentReviewItems', () => {
  it('pairs a rendered canonical question with its attempted definition and response', () => {
    const canonicalQuestions = [
      {
        id: 16,
        title: 'Composite question',
        points: 9,
        order: 3,
        exerciseSectionId: null
      }
    ];
    const answers = [
      {
        questionId: 16,
        score: 1.5,
        answerData: { type: 'ASSESSMENT_ITEM' as const, response: attemptedResponse },
        assessmentDefinition: attemptedDefinition
      }
    ];

    expect(getCanonicalAssessmentReviewItems(canonicalQuestions, answers)).toEqual([
      {
        question: canonicalQuestions[0],
        definition: attemptedDefinition,
        response: attemptedResponse,
        score: 1.5,
        maxScore: 2
      }
    ]);
  });

  it('keeps an archived canonical question reviewable from answer metadata', () => {
    const attemptedQuestion = {
      id: 16,
      title: 'Archived composite question',
      order: 3,
      exerciseSectionId: null,
      archivedAt: '2026-07-22T00:00:00.000Z'
    };
    const answers = [
      {
        questionId: 16,
        score: 1.5,
        answerData: { type: 'ASSESSMENT_ITEM' as const, response: attemptedResponse },
        assessmentDefinition: attemptedDefinition,
        attemptedQuestion
      }
    ];

    expect(getCanonicalAssessmentReviewItems([], answers)).toEqual([
      {
        question: attemptedQuestion,
        definition: attemptedDefinition,
        response: attemptedResponse,
        score: 1.5,
        maxScore: 2
      }
    ]);
  });

  it('omits answers that are not canonical or do not carry an attempted definition', () => {
    const canonicalQuestions = [{ id: 16, title: 'Composite question', points: 2 }];

    expect(
      getCanonicalAssessmentReviewItems(canonicalQuestions, [
        { questionId: 16, score: 2, answerData: { type: 'TEXTAREA', text: 'Legacy answer' } },
        { questionId: 16, score: 2, answerData: { type: 'ASSESSMENT_ITEM', response: attemptedResponse } }
      ])
    ).toEqual([]);
  });
});
