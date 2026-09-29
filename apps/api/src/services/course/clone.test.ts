import { beforeEach, describe, expect, it, vi } from 'vitest';

const txStub = {};

const mocks = vi.hoisted(() => ({
  addGroupMember: vi.fn(),
  createAsset: vi.fn(),
  createAssetUsage: vi.fn(),
  createCourse: vi.fn(),
  createCourseSections: vi.fn(),
  createExerciseSections: vi.fn(),
  createExercises: vi.fn(),
  createGroup: vi.fn(),
  createLessonLanguages: vi.fn(),
  createLessons: vi.fn(),
  createOptions: vi.fn(),
  createQuestions: vi.fn(),
  deleteAssetUsagesByTargetSlots: vi.fn(),
  getActiveAssetBySourceUrl: vi.fn(),
  getAssetsByIds: vi.fn(),
  getCourseById: vi.fn(),
  getCourseOrganizationId: vi.fn(),
  getCourseSectionsByCourseId: vi.fn(),
  getExerciseSectionsByExerciseIds: vi.fn(),
  getExercisesByCourseId: vi.fn(),
  getLessonLanguagesByLessonIds: vi.fn(),
  getLessonsByCourseId: vi.fn(),
  getOptionsByQuestionIds: vi.fn(),
  getQuestionsByExerciseIds: vi.fn(),
  stampCopiedTemplateUnits: vi.fn(),
  syncOptionIdSequence: vi.fn(),
  transaction: vi.fn(),
  updateCourse: vi.fn(),
  updateExerciseSection: vi.fn()
}));

vi.mock('@db/queries', () => ({ ...mocks }));
vi.mock('@db/drizzle', () => ({ db: { transaction: mocks.transaction } }));
vi.mock('@cio/core/utils/redis/org-stats-cache', () => ({ invalidateOrgStats: vi.fn() }));
vi.mock('@cio/core/services/assets/asset-transfer', () => ({
  transferUploadedAsset: vi.fn(),
  withAssetStorageRollback: (run: () => Promise<unknown>) => run()
}));
// `INTERNAL_QUESTION_TYPE_IDS` comes from core exercise utils, whose module graph
// pulls in the real exercise query index; stub it so no DB client is created.
vi.mock('@cio/db/queries/exercise', () => ({
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

import { ErrorCodes } from '@api/utils/errors';
import { cloneCourse } from './clone';

const ASSESSMENT_ITEM_TYPE_ID = 16;

const activeQuestion = {
  id: 1,
  exerciseId: 'exercise-a',
  title: 'Active question',
  questionTypeId: 1,
  points: 1,
  order: 0,
  settings: {},
  exerciseSectionId: null,
  name: null
};

const internalQuestion = {
  ...activeQuestion,
  title: 'Composite',
  questionTypeId: ASSESSMENT_ITEM_TYPE_ID,
  points: 0
};

describe('cloneCourse archived/internal question hardening', () => {
  const cloneOptions = { title: 'Cloned course', userId: 'user-a' };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(txStub));
    mocks.getCourseById.mockResolvedValue([{ id: 'course-a', description: 'Source course', metadata: {} }]);
    mocks.getCourseOrganizationId.mockResolvedValue('org-a');
    mocks.getLessonsByCourseId.mockResolvedValue([{ id: 'lesson-a', title: 'Lesson', sectionId: null }]);
    mocks.getExercisesByCourseId.mockResolvedValue([
      { id: 'exercise-a', title: 'Exercise', description: null, lessonId: 'lesson-a', sectionDisplayMode: 'all' }
    ]);
    mocks.getCourseSectionsByCourseId.mockResolvedValue([]);
    mocks.getLessonLanguagesByLessonIds.mockResolvedValue([]);
    mocks.getExerciseSectionsByExerciseIds.mockResolvedValue([]);
    mocks.getOptionsByQuestionIds.mockResolvedValue([]);
    mocks.getAssetsByIds.mockResolvedValue([]);
    mocks.createGroup.mockResolvedValue([{ id: 'group-b', organizationId: 'org-a' }]);
    mocks.createCourse.mockResolvedValue([{ id: 'course-b' }]);
    mocks.addGroupMember.mockResolvedValue(undefined);
    mocks.createLessons.mockResolvedValue([{ id: 'lesson-b' }]);
    mocks.createExercises.mockResolvedValue([{ id: 'exercise-b' }]);
    mocks.createQuestions.mockResolvedValue([{ id: 11 }]);
  });

  it('rejects a course containing an internal composite item before any write', async () => {
    mocks.getQuestionsByExerciseIds.mockResolvedValue([internalQuestion]);

    await expect(cloneCourse('course-a', cloneOptions)).rejects.toMatchObject({
      code: ErrorCodes.CONFLICT,
      statusCode: 409
    });

    // The check runs on the source reads, so the transaction aborts with nothing written.
    expect(mocks.createGroup).not.toHaveBeenCalled();
    expect(mocks.createCourse).not.toHaveBeenCalled();
    expect(mocks.createLessons).not.toHaveBeenCalled();
    expect(mocks.createQuestions).not.toHaveBeenCalled();
  });

  it('clones only the active question graph (archived rows are excluded at the query level)', async () => {
    mocks.getQuestionsByExerciseIds.mockResolvedValue([activeQuestion]);

    const cloned = await cloneCourse('course-a', cloneOptions);

    expect(cloned).toEqual({ id: 'course-b' });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.getQuestionsByExerciseIds).toHaveBeenCalledTimes(1);
    expect(mocks.getQuestionsByExerciseIds).toHaveBeenCalledWith(['exercise-a'], txStub, { questionScope: 'active' });
    expect(mocks.createQuestions).toHaveBeenCalledWith(
      [expect.objectContaining({ title: 'Active question', questionTypeId: 1, exerciseId: 'exercise-b' })],
      txStub
    );
  });

  it('runs every clone write on the transaction client', async () => {
    mocks.getQuestionsByExerciseIds.mockResolvedValue([activeQuestion]);

    await cloneCourse('course-a', cloneOptions);

    expect(mocks.createGroup).toHaveBeenCalledWith(expect.anything(), txStub);
    expect(mocks.createCourse).toHaveBeenCalledWith(expect.anything(), txStub);
    expect(mocks.addGroupMember).toHaveBeenCalledWith(expect.anything(), txStub);
    expect(mocks.createLessons).toHaveBeenCalledWith(expect.anything(), txStub);
    expect(mocks.createExercises).toHaveBeenCalledWith(expect.anything(), txStub);
    expect(mocks.createQuestions).toHaveBeenCalledWith(expect.anything(), txStub);
  });
});
