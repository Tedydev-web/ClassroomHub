import { describe, expect, it } from 'vitest';
import {
  getExpectedOrderingValues,
  QUESTION_TYPE_KEY,
  scoreAnswerForQuestion,
  scoreSubmissionAnswers,
  type ExerciseQuestionModel
} from '../src';

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

describe('ordering steps that read the same', () => {
  // Two steps in a procedure can legitimately carry identical text — "Stir",
  // "Bake", "Stir". Expected values were keyed by label, so duplicates
  // collapsed onto one option and the answer key became unorderable.
  const question: ExerciseQuestionModel = {
    id: 1,
    title: 'Arrange the steps',
    questionType: QUESTION_TYPE_KEY.ORDERING,
    points: 10,
    options: [
      { id: 31, label: 'Mix' },
      { id: 32, label: 'Bake' },
      { id: 33, label: 'Mix' }
    ],
    settings: { items: ['Mix', 'Bake', 'Mix'] }
  };

  it('maps each repeated label to a distinct option', () => {
    expect(getExpectedOrderingValues(question)).toEqual(['31', '32', '33']);
  });

  it('awards full marks for the correct order', () => {
    expect(scoreAnswerForQuestion(question, { type: 'ORDERING', orderedValues: ['31', '32', '33'] })).toBe(10);
  });

  it('still credits only the steps left in the right place', () => {
    // Ordering scores partially by default: only "Mix" (33) is in position.
    expect(scoreAnswerForQuestion(question, { type: 'ORDERING', orderedValues: ['32', '31', '33'] })).toBe(3.33);
  });

  it('awards nothing when no step is in the right place', () => {
    expect(scoreAnswerForQuestion(question, { type: 'ORDERING', orderedValues: ['33', '31', '32'] })).toBe(0);
  });

  it('leaves questions with unique labels behaving exactly as before', () => {
    const unique: ExerciseQuestionModel = {
      ...question,
      options: [
        { id: 41, label: 'First' },
        { id: 42, label: 'Second' }
      ],
      settings: { items: ['Second', 'First'] }
    };

    expect(getExpectedOrderingValues(unique)).toEqual(['42', '41']);
    expect(scoreAnswerForQuestion(unique, { type: 'ORDERING', orderedValues: ['42', '41'] })).toBe(10);
  });

  it('falls back to the raw label when no option carries it', () => {
    const mismatched: ExerciseQuestionModel = {
      ...question,
      options: [{ id: 51, label: 'Known' }],
      settings: { items: ['Known', 'Absent'] }
    };

    expect(getExpectedOrderingValues(mismatched)).toEqual(['51', 'Absent']);
  });
});
