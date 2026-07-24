import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getExerciseSectionsByExerciseId: vi.fn(),
  getExerciseWithRelationsOptimized: vi.fn(),
  getPublicCourseItem: vi.fn()
}));

vi.mock('@cio/core/utils/s3', () => ({
  generateTranscriptVttPresignedUrl: vi.fn(),
  generateVideoDownloadPresignedUrls: vi.fn(),
  TRANSCRIPT_VTT_PRESIGN_SECONDS: 300
}));
vi.mock('@cio/core/services/assets/assets', () => ({ mintHlsToken: vi.fn() }));
vi.mock('@cio/db/queries', () => ({ getMediaTranscriptByAsset: vi.fn() }));
vi.mock('@cio/db/queries/assets', () => ({ getAssetsByIds: vi.fn() }));
vi.mock('@cio/db/queries/course', () => ({
  getCourseRowBySlug: vi.fn(),
  getPublicCourseItem: mocks.getPublicCourseItem,
  getPublicCourseTreeBySlug: vi.fn()
}));
vi.mock('@cio/db/queries/exercise', () => ({
  createOptions: vi.fn(),
  createQuestions: vi.fn(),
  deleteOptionsByIds: vi.fn(),
  deleteQuestionsByIds: vi.fn(),
  getExerciseWithRelationsOptimized: mocks.getExerciseWithRelationsOptimized,
  getOptionsByQuestionIds: vi.fn(),
  getQuestionTypesByIds: vi.fn(),
  getQuestionsByExerciseIds: vi.fn(),
  updateOptions: vi.fn(),
  updateQuestions: vi.fn()
}));
vi.mock('@cio/db/queries/exercise/exercise-section', () => ({
  getExerciseSectionsByExerciseId: mocks.getExerciseSectionsByExerciseId
}));

import { getPublicCourseItemService } from './public-course';

describe('getPublicCourseItemService exercise payload hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPublicCourseItem.mockResolvedValue({
      kind: 'exercise',
      id: 'exercise-a',
      isUnlocked: true,
      title: 'Public exercise'
    });
    mocks.getExerciseSectionsByExerciseId.mockResolvedValue([]);
  });

  it('excludes internal composite items and reads only active questions', async () => {
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: { id: 'exercise-a' },
      questions: [
        {
          id: 1,
          exerciseId: 'exercise-a',
          title: 'Radio question',
          questionTypeId: 1,
          points: 1,
          order: 0,
          settings: {},
          exerciseSectionId: null,
          name: null,
          questionType: { id: 1, label: 'Single answer', typename: 'RADIO' },
          options: [{ id: 21, questionId: 1, label: 'Option A', value: 'a', isCorrect: true, settings: {} }]
        },
        {
          id: 2,
          exerciseId: 'exercise-a',
          title: 'Composite item',
          questionTypeId: 16,
          points: 0,
          order: 1,
          settings: {},
          exerciseSectionId: null,
          name: null,
          questionType: { id: 16, label: 'Composite item', typename: 'ASSESSMENT_ITEM' },
          options: []
        }
      ]
    });

    const item = await getPublicCourseItemService('course-slug', 'exercise-slug');

    // Public delivery must exclude archived rows at the query level.
    expect(mocks.getExerciseWithRelationsOptimized).toHaveBeenCalledWith('exercise-a', undefined, {
      questionScope: 'active'
    });

    if (!item || item.kind !== 'exercise') {
      throw new Error('Expected an exercise item');
    }

    // The internal composite item never ships to the browser.
    expect(item.questions.unsectioned.map((question) => question.id)).toEqual([1]);
    expect(item.questions.unsectioned[0]).toMatchObject({
      questionTypeId: 1,
      questionTypeKey: 'RADIO',
      options: [expect.objectContaining({ isCorrect: true })]
    });
    expect(item.questions.sections).toEqual([]);
  });
});
