import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findNonAutoGradableQuestionsInCourse: vi.fn(),
  hasSelectivelyAssignedExercises: vi.fn()
}));

vi.mock('@cio/db/queries/course', () => ({
  findNonAutoGradableQuestionsInCourse: mocks.findNonAutoGradableQuestionsInCourse,
  getCourseTypeById: vi.fn(),
  hasSelectivelyAssignedExercises: mocks.hasSelectivelyAssignedExercises
}));

import { ErrorCodes } from '@cio/utils/errors';
import { getPublicConversionOffenders } from '@cio/core/services/course/public-course-guard';

describe('getPublicConversionOffenders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findNonAutoGradableQuestionsInCourse.mockResolvedValue([]);
    mocks.hasSelectivelyAssignedExercises.mockResolvedValue(false);
  });

  it('blocks conversion to public while an exercise has selective assignments', async () => {
    mocks.hasSelectivelyAssignedExercises.mockResolvedValue(true);

    await expect(
      getPublicConversionOffenders({ courseId: 'course-a', currentType: 'SELF_PACED', nextType: 'PUBLIC' })
    ).rejects.toMatchObject({ code: ErrorCodes.PUBLIC_COURSE_CONVERSION_BLOCKED, statusCode: 400 });
    expect(mocks.findNonAutoGradableQuestionsInCourse).not.toHaveBeenCalled();
  });
});
