import { describe, expect, it } from 'vitest';
import { QUESTION_TYPE_KEY } from '@cio/question-types';

import {
  applyQuestionTypeChange,
  makeDefaultOption,
  makeThumbsOptions,
  makeTrueFalseOptions,
  type QuestionOption
} from './question-type-transition';

const NOW = 1_700_000_000_000;

const option = (id: string, label: string, extra: Record<string, unknown> = {}): QuestionOption =>
  ({ id, label, value: label, isCorrect: false, ...extra }) as QuestionOption;

const from = (options: QuestionOption[] = [], settings: Record<string, unknown> = {}) =>
  ({ options, settings }) as never;

describe('option factories', () => {
  it('stamps ids with the given time so a new option is distinguishable from a saved one', () => {
    expect(makeDefaultOption(NOW).id).toBe(`${NOW}-form`);
    expect(makeTrueFalseOptions(true, NOW).map((entry) => entry.id)).toEqual([`${NOW}-true-form`, `${NOW}-false-form`]);
    expect(makeThumbsOptions(NOW).map((entry) => entry.id)).toEqual([`${NOW}-yes-form`, `${NOW}-no-form`]);
  });

  it('puts the correct flag on the side that was asked for', () => {
    expect(makeTrueFalseOptions(true, NOW).map((entry) => entry.isCorrect)).toEqual([true, false]);
    expect(makeTrueFalseOptions(false, NOW).map((entry) => entry.isCorrect)).toEqual([false, true]);
  });

  it('gives thumbs no correct side at all — it is a reaction, not a question with a key', () => {
    expect(makeThumbsOptions(NOW).every((entry) => entry.isCorrect === false)).toBe(true);
  });
});

describe('applyQuestionTypeChange', () => {
  it('replaces options with a fresh pair for true/false, keeping which side was correct', () => {
    const result = applyQuestionTypeChange(
      from([option('a', 'Paris')], { correctValue: false }),
      QUESTION_TYPE_KEY.TRUE_FALSE,
      NOW
    );

    expect(result.options.map((entry) => entry.label)).toEqual(['True', 'False']);
    expect(result.options.map((entry) => entry.isCorrect)).toEqual([false, true]);
    expect((result.settings as { correctValue?: boolean }).correctValue).toBe(false);
  });

  it('defaults true/false to true when nothing said otherwise', () => {
    const result = applyQuestionTypeChange(from(), QUESTION_TYPE_KEY.TRUE_FALSE, NOW);

    expect((result.settings as { correctValue?: boolean }).correctValue).toBe(true);
  });

  it('keeps options a teacher already typed when moving between option-taking types', () => {
    const existing = [option('a', 'Paris'), option('b', 'Rome')];
    const result = applyQuestionTypeChange(from(existing), QUESTION_TYPE_KEY.CHECKBOX, NOW);

    expect(result.options).toEqual(existing);
  });

  it('adds one empty option only when every existing option is deleted', () => {
    const result = applyQuestionTypeChange(
      from([option('a', 'Paris', { deletedAt: '2026-01-01' })]),
      QUESTION_TYPE_KEY.CHECKBOX,
      NOW
    );

    expect(result.options).toHaveLength(2);
    expect(result.options[1]?.id).toBe(`${NOW}-form`);
  });

  it('discards options for a type that cannot show them', () => {
    const result = applyQuestionTypeChange(from([option('a', 'Paris')]), QUESTION_TYPE_KEY.TEXTAREA, NOW);

    expect(result.options).toEqual([]);
  });

  it('adds the video recording defaults on top of whatever the branch decided', () => {
    const result = applyQuestionTypeChange(from([option('a', 'Paris')]), QUESTION_TYPE_KEY.VIDEO_RECORDING, NOW);

    expect(result.settings).toMatchObject({ maxDurationSeconds: 60, allowRetakes: true });
    expect(result.options).toEqual([]);
  });

  it('does not mutate the settings it was given', () => {
    const settings = { correctValue: true };
    applyQuestionTypeChange(from([], settings), QUESTION_TYPE_KEY.VIDEO_RECORDING, NOW);

    expect(settings).toEqual({ correctValue: true });
  });
});
