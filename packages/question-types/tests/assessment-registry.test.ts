import { describe, expect, it } from 'vitest';
import {
  ANSWER_CODECS,
  DB_BACKED_QUESTION_TYPE_REGISTRY,
  ENABLED_QUESTION_TYPE_REGISTRY,
  QUESTION_TYPE_BY_KEY,
  QUESTION_TYPE_KEY,
  dbQuestionToExerciseQuestionModel,
  decodeApiPayload,
  decodeStoredAnswerData,
  scoreSubmissionAnswers,
  type ExerciseQuestionModel
} from '../src';

const ASSESSMENT_ITEM_QUESTION: ExerciseQuestionModel = {
  id: 16,
  title: 'Composite item',
  questionType: QUESTION_TYPE_KEY.ASSESSMENT_ITEM,
  points: 10,
  options: [],
  settings: {}
};

describe('ASSESSMENT_ITEM registry identity', () => {
  it('reserves deterministic id 16 with internal, conservative metadata', () => {
    const metadata = QUESTION_TYPE_BY_KEY[QUESTION_TYPE_KEY.ASSESSMENT_ITEM];

    expect(metadata).toMatchObject({
      key: 'ASSESSMENT_ITEM',
      typename: 'ASSESSMENT_ITEM',
      label: 'Composite item',
      id: 16,
      internal: true,
      autoGradable: false,
      supportsPartialCredit: true,
      manualGradingRequired: true
    });
    expect(metadata.disabled).toBeUndefined();
  });

  it('is excluded from the enabled (author-selectable) registry', () => {
    const enabledKeys = ENABLED_QUESTION_TYPE_REGISTRY.map((entry) => entry.key);

    expect(enabledKeys).not.toContain(QUESTION_TYPE_KEY.ASSESSMENT_ITEM);
    expect(enabledKeys).toHaveLength(14);
    expect(enabledKeys).toContain(QUESTION_TYPE_KEY.THUMBS);
  });

  it('is included in the database-backed registry used by seed and migration checks', () => {
    const dbBacked = DB_BACKED_QUESTION_TYPE_REGISTRY.map((entry) => ({ id: entry.id, typename: entry.typename }));

    expect(dbBacked).toContainEqual({ id: 16, typename: 'ASSESSMENT_ITEM' });
    expect(dbBacked).toContainEqual({ id: 17, typename: 'THUMBS' });
    expect(dbBacked).toHaveLength(15);
    expect(dbBacked.map((entry) => entry.typename)).not.toContain('MATCHING');
    expect(dbBacked.map((entry) => entry.typename)).not.toContain('HOTSPOT');
  });
});

describe('legacy payload boundaries reject ASSESSMENT_ITEM until a canonical composer/read path exists', () => {
  it('has an explicit-reject answer codec', () => {
    const decoded = decodeApiPayload(
      QUESTION_TYPE_KEY.ASSESSMENT_ITEM,
      { questionId: 16, answer: '{"anything":true}' },
      ASSESSMENT_ITEM_QUESTION
    );

    expect(decoded.success).toBe(false);
    if (decoded.success) return;

    expect(decoded.reason).toBe('invalid');
    expect(
      ANSWER_CODECS[QUESTION_TYPE_KEY.ASSESSMENT_ITEM].fromApiPayload(
        { questionId: 16, answer: 'x' },
        ASSESSMENT_ITEM_QUESTION
      )
    ).toBeNull();
  });

  it('rejects stored answer decoding for ASSESSMENT_ITEM questions', () => {
    expect(decodeStoredAnswerData({ type: 'ASSESSMENT_ITEM' }, ASSESSMENT_ITEM_QUESTION)).toBeNull();
  });
});

describe('explicit unknown-question-type failure (no RADIO fallback)', () => {
  it('dbQuestionToExerciseQuestionModel throws on unknown ids', () => {
    expect(() =>
      dbQuestionToExerciseQuestionModel({ id: 1, questionTypeId: 999, points: 1, options: [] })
    ).toThrowError(/999/);
  });

  it('scoreSubmissionAnswers throws on unknown ids instead of silently scoring', () => {
    expect(() =>
      scoreSubmissionAnswers([{ id: 1, questionTypeId: 999, points: 1, options: [] }], new Map())
    ).toThrowError(/999/);
  });

  it('scoreSubmissionAnswers still treats ASSESSMENT_ITEM as manually graded (0 auto points)', () => {
    const result = scoreSubmissionAnswers([{ id: 5, questionTypeId: 16, points: 10, options: [] }], new Map());

    expect(result.scores).toEqual([{ questionId: 5, points: 0 }]);
    expect(result.total).toBe(0);
  });
});
