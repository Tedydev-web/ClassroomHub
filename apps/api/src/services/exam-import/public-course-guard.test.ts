import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssessmentItemDefinition } from '@cio/question-types';

const mocks = vi.hoisted(() => ({
  getCourseTypeById: vi.fn()
}));

vi.mock('@cio/db/queries/course', () => ({
  findNonAutoGradableQuestionsInCourse: vi.fn(),
  getCourseTypeById: mocks.getCourseTypeById,
  hasSelectivelyAssignedExercises: vi.fn()
}));

import { guardNonAutoGradableQuestionsForCourseType } from '@cio/core/services/course/public-course-guard';

function definition(format: 'plain' | 'rich'): AssessmentItemDefinition {
  return {
    schemaVersion: 1,
    blocks: [
      {
        id: 'question-1',
        kind: 'interaction',
        interaction: {
          kind: 'text',
          prompt: { format: 'html', html: '<p>Answer the question.</p>' },
          required: true,
          maxScore: 1,
          config: { format }
        }
      }
    ],
    feedback: []
  };
}

describe('public course assessment capability guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a manual canonical assessment item in a public course', async () => {
    mocks.getCourseTypeById.mockResolvedValue('PUBLIC');

    await expect(
      guardNonAutoGradableQuestionsForCourseType({
        courseId: 'course-1',
        questionTypeIds: [],
        assessmentDefinitions: [definition('rich')]
      })
    ).rejects.toMatchObject({
      code: 'QUESTION_TYPE_NOT_ALLOWED_IN_PUBLIC_COURSE'
    });
  });

  it('does not query course type when every canonical item is auto-gradable', async () => {
    await guardNonAutoGradableQuestionsForCourseType({
      courseId: 'course-1',
      questionTypeIds: [],
      assessmentDefinitions: [
        {
          schemaVersion: 1,
          blocks: [
            {
              id: 'question-1',
              kind: 'interaction',
              interaction: {
                kind: 'numeric',
                prompt: { format: 'html', html: '<p>2 + 2</p>' },
                required: true,
                maxScore: 1,
                config: { correctValue: 4, tolerance: 0 }
              }
            }
          ],
          feedback: []
        }
      ]
    });

    expect(mocks.getCourseTypeById).not.toHaveBeenCalled();
  });
});
