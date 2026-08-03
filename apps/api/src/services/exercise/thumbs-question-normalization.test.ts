import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createOptions: vi.fn(),
  createQuestions: vi.fn(),
  deleteOptionsByIds: vi.fn(),
  deleteQuestionsByIds: vi.fn(),
  getOptionsByQuestionIds: vi.fn(),
  getQuestionTypesByIds: vi.fn(),
  getQuestionsByExerciseIds: vi.fn(),
  updateOptions: vi.fn(),
  updateQuestions: vi.fn()
}));

vi.mock('@cio/db/queries/exercise', () => ({
  createOptions: mocks.createOptions,
  createQuestions: mocks.createQuestions,
  deleteOptionsByIds: mocks.deleteOptionsByIds,
  deleteQuestionsByIds: mocks.deleteQuestionsByIds,
  getOptionsByQuestionIds: mocks.getOptionsByQuestionIds,
  getQuestionTypesByIds: mocks.getQuestionTypesByIds,
  getQuestionsByExerciseIds: mocks.getQuestionsByExerciseIds,
  updateOptions: mocks.updateOptions,
  updateQuestions: mocks.updateQuestions
}));

import { computeExerciseDiff, createNewQuestionsWithOptions } from '@cio/core/services/exercise/utils';

const transaction = {};
const thumbsQuestion = {
  question: 'Would you recommend this lesson?',
  questionTypeId: 17,
  settings: { correctValue: true },
  options: [
    { label: 'Yes', isCorrect: true },
    { label: 'No', isCorrect: true }
  ]
};

describe('THUMBS core payload normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createQuestions.mockResolvedValue([{ id: 1 }]);
    mocks.createOptions.mockResolvedValue([]);
  });

  it('strips answer keys from a new question supplied by an agent or MCP path', async () => {
    await createNewQuestionsWithOptions('exercise-a', [thumbsQuestion], transaction as never);

    expect(mocks.createQuestions).toHaveBeenCalledWith(
      [expect.objectContaining({ questionTypeId: 17, settings: {} })],
      transaction
    );
    expect(mocks.createOptions).toHaveBeenCalledWith(
      [
        expect.objectContaining({ label: 'Yes', isCorrect: false }),
        expect.objectContaining({ label: 'No', isCorrect: false })
      ],
      transaction
    );
  });

  it('strips answer keys from an existing THUMBS question update', () => {
    const currentQuestion = {
      id: 1,
      exerciseId: 'exercise-a',
      title: thumbsQuestion.question,
      questionTypeId: 17,
      points: 1,
      order: 0,
      settings: { correctValue: true },
      options: [
        { id: 1, questionId: 1, label: 'Yes', isCorrect: true, settings: {} },
        { id: 2, questionId: 1, label: 'No', isCorrect: true, settings: {} }
      ]
    };
    const update = {
      ...thumbsQuestion,
      id: 1,
      points: 1,
      order: 0,
      options: thumbsQuestion.options.map((option, index) => ({ ...option, id: index + 1 }))
    };

    const diff = computeExerciseDiff([currentQuestion], [update]);

    expect(diff.questions.updates).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ settings: {} }) })
    ]);
    expect(diff.options.updates).toEqual([
      expect.objectContaining({ id: 1, data: { isCorrect: false } }),
      expect.objectContaining({ id: 2, data: { isCorrect: false } })
    ]);
  });
});
