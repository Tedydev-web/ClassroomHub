import { describe, expect, it } from 'vitest';
import { QUESTION_TYPE_KEY, scoreAnswerForQuestion, scoreSubmissionAnswers, type ExerciseQuestionModel } from '../src';

function buildQuestion(overrides: Partial<ExerciseQuestionModel> = {}): ExerciseQuestionModel {
  return {
    id: 1,
    title: 'Question',
    questionType: QUESTION_TYPE_KEY.RADIO,
    points: 10,
    options: [],
    settings: {},
    ...overrides
  };
}

describe('question scoring invariants', () => {
  it('does not let duplicate matching pairs inflate partial credit', () => {
    const question = buildQuestion({
      questionType: QUESTION_TYPE_KEY.MATCHING,
      settings: {
        pairs: [
          { left: 'A', right: '1' },
          { left: 'B', right: '2' }
        ]
      }
    });

    expect(
      scoreAnswerForQuestion(question, {
        type: 'MATCHING',
        pairs: [
          { left: 'A', right: '1' },
          { left: 'A', right: '1' }
        ]
      })
    ).toBe(5);
  });

  it('penalizes extra hotspot coordinates and matches each response at most once', () => {
    const question = buildQuestion({
      questionType: QUESTION_TYPE_KEY.HOTSPOT,
      settings: { hotspots: [{ x: 20, y: 20 }] }
    });

    expect(
      scoreAnswerForQuestion(question, {
        type: 'HOTSPOT',
        coordinates: [
          { x: 20, y: 20 },
          { x: 90, y: 90 }
        ]
      })
    ).toBe(5);
  });

  it('rejects an ordering response that is not an exact permutation', () => {
    const question = buildQuestion({
      questionType: QUESTION_TYPE_KEY.ORDERING,
      options: [
        { id: 11, label: 'One' },
        { id: 12, label: 'Two' },
        { id: 13, label: 'Three' }
      ]
    });

    expect(
      scoreAnswerForQuestion(question, {
        type: 'ORDERING',
        orderedValues: ['11', '11', '13']
      })
    ).toBe(0);
  });

  it('returns zero for non-finite numeric values', () => {
    const question = buildQuestion({
      questionType: QUESTION_TYPE_KEY.NUMERIC,
      settings: { correctValue: 10, tolerance: 1 }
    });

    expect(scoreAnswerForQuestion(question, { type: 'NUMERIC', value: Number.NaN })).toBe(0);
    expect(scoreAnswerForQuestion(question, { type: 'NUMERIC', value: Number.POSITIVE_INFINITY })).toBe(0);
  });

  it('preserves two-decimal partial scores in submission results', () => {
    const result = scoreSubmissionAnswers(
      [
        {
          id: 1,
          title: 'Three blanks',
          questionTypeId: 7,
          points: 10,
          settings: { acceptedAnswers: 'one,two,three' },
          options: []
        }
      ],
      new Map([[1, { type: 'FILL_BLANK' as const, values: ['one', 'wrong', 'wrong'] }]])
    );

    expect(result).toEqual({ scores: [{ questionId: 1, points: 3.33 }], total: 3.33 });
  });

  it('rounds the aggregate total to two decimals', () => {
    const result = scoreSubmissionAnswers(
      [
        {
          id: 1,
          questionTypeId: 7,
          points: 10,
          settings: { acceptedAnswers: 'one,two,three' },
          options: []
        },
        {
          id: 2,
          questionTypeId: 7,
          points: 10,
          settings: { acceptedAnswers: 'one,two,three' },
          options: []
        }
      ],
      new Map([
        [1, { type: 'FILL_BLANK' as const, values: ['one', 'wrong', 'wrong'] }],
        [2, { type: 'FILL_BLANK' as const, values: ['one', 'wrong', 'wrong'] }]
      ])
    );

    expect(result.total).toBe(6.66);
  });
});
