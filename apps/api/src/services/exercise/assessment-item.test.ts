import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssessmentItemDefinition } from '@cio/question-types';
import { ErrorCodes } from '@cio/utils/errors';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn()
}));

vi.mock('@cio/db/drizzle', () => ({ db: { transaction: mocks.transaction } }));

import {
  createAssessmentItemForCourseService,
  publishAssessmentItemForCourseService
} from '@cio/core/services/exercise/assessment-item';

const unsupportedDefinition: AssessmentItemDefinition = {
  schemaVersion: 1,
  blocks: [
    {
      id: 'numeric-1',
      kind: 'interaction',
      interaction: {
        kind: 'numeric',
        prompt: { format: 'html', html: '<p>Enter the number.</p>' },
        required: true,
        maxScore: 1,
        config: { correctValue: 42, tolerance: 0 }
      }
    }
  ],
  feedback: []
};

describe('assessment item Phase 3 interaction boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockRejectedValue(new Error('The transaction boundary must not be entered'));
  });

  it('rejects unsupported interactions before creating an assessment item', async () => {
    await expect(
      createAssessmentItemForCourseService('course-a', 'exercise-a', 'Unsupported item', unsupportedDefinition)
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects unsupported interactions before publishing a revision', async () => {
    await expect(
      publishAssessmentItemForCourseService('course-a', 'exercise-a', 1, 1, unsupportedDefinition)
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
