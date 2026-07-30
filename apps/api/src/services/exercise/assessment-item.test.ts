import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssessmentItemDefinition } from '@cio/question-types';
import { ErrorCodes } from '@cio/utils/errors';
import type { DbOrTxClient } from '@cio/db/drizzle';

const mocks = vi.hoisted(() => ({
  createQuestions: vi.fn(),
  getAttemptedQuestionIds: vi.fn(),
  getCurrentQuestionRevision: vi.fn(),
  getExerciseById: vi.fn(),
  getExerciseSectionsByExerciseId: vi.fn(),
  getQuestionWithOptionsForRevision: vi.fn(),
  getQuestionsByExerciseIds: vi.fn(),
  hasExerciseSubmissions: vi.fn(),
  lockExerciseAssignmentState: vi.fn(),
  publishQuestionRevision: vi.fn(),
  transaction: vi.fn(),
  updateQuestion: vi.fn(),
  updateQuestions: vi.fn()
}));

vi.mock('@cio/db/drizzle', () => ({ db: { transaction: mocks.transaction } }));
vi.mock('@cio/db/queries/exercise', () => ({
  createQuestions: mocks.createQuestions,
  getAttemptedQuestionIds: mocks.getAttemptedQuestionIds,
  getCurrentQuestionRevision: mocks.getCurrentQuestionRevision,
  getExerciseById: mocks.getExerciseById,
  getExerciseSectionsByExerciseId: mocks.getExerciseSectionsByExerciseId,
  getQuestionWithOptionsForRevision: mocks.getQuestionWithOptionsForRevision,
  getQuestionsByExerciseIds: mocks.getQuestionsByExerciseIds,
  hasExerciseSubmissions: mocks.hasExerciseSubmissions,
  lockExerciseAssignmentState: mocks.lockExerciseAssignmentState,
  updateQuestion: mocks.updateQuestion,
  updateQuestions: mocks.updateQuestions
}));
vi.mock('@cio/core/services/assessment/question-revision', () => ({
  publishQuestionRevision: mocks.publishQuestionRevision
}));

import {
  applyAssessmentItemMutationsForExercise,
  createAssessmentItemForCourseService,
  getAssessmentItemForAuthorService,
  getAssessmentItemForLearnerService,
  publishAssessmentItemForCourseService
} from '@cio/core/services/exercise/assessment-item';

const unsupportedDefinition: AssessmentItemDefinition = {
  schemaVersion: 1,
  blocks: [
    {
      id: 'ordering-1',
      kind: 'interaction',
      interaction: {
        kind: 'ordering',
        prompt: { format: 'html', html: '<p>Arrange the steps.</p>' },
        required: true,
        maxScore: 1,
        config: {
          options: [
            { id: 'option-1', html: '<p>First</p>' },
            { id: 'option-2', html: '<p>Second</p>' }
          ],
          correctOrder: ['option-1', 'option-2']
        }
      }
    }
  ],
  feedback: []
};

const supportedDefinition: AssessmentItemDefinition = {
  schemaVersion: 1,
  blocks: [
    {
      id: 'text-1',
      kind: 'interaction',
      interaction: {
        kind: 'text',
        prompt: { format: 'html', html: '<p>Explain.</p>' },
        required: true,
        maxScore: 2,
        config: { format: 'plain' }
      }
    }
  ],
  feedback: []
};

const answerKeyDefinition: AssessmentItemDefinition = {
  schemaVersion: 1,
  blocks: [
    {
      id: 'choice-1',
      kind: 'interaction',
      interaction: {
        kind: 'choice',
        prompt: { format: 'html', html: '<p>Pick one.</p>' },
        required: true,
        maxScore: 1,
        config: {
          cardinality: 'single',
          presentation: 'list',
          options: [
            { id: 'option-a', html: '<p>A</p>' },
            { id: 'option-b', html: '<p>B</p>' }
          ],
          correctOptionIds: ['option-b']
        }
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
      publishAssessmentItemForCourseService('course-a', 'exercise-a', 1, 'Unsupported item', 1, unsupportedDefinition)
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe('assessment item access projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getExerciseById.mockResolvedValue({ id: 'exercise-a', courseId: 'course-a' });
    mocks.getQuestionWithOptionsForRevision.mockResolvedValue({
      id: 16,
      exerciseId: 'exercise-a',
      exerciseSectionId: null,
      questionTypeId: 16,
      title: 'Choice item',
      order: 0
    });
    mocks.getCurrentQuestionRevision.mockResolvedValue({
      id: 'revision-1',
      revision: 1,
      definition: answerKeyDefinition
    });
  });

  it('returns one response shape while exposing authored data only to authors', async () => {
    const authorItem = await getAssessmentItemForAuthorService('course-a', 'exercise-a', 16);
    const learnerItem = await getAssessmentItemForLearnerService('course-a', 'exercise-a', 16);

    expect(Object.keys(authorItem).sort()).toEqual(Object.keys(learnerItem).sort());
    expect(authorItem.authorDefinition).toEqual(answerKeyDefinition);
    expect(learnerItem.authorDefinition).toBeNull();
    expect(JSON.stringify(authorItem.definition)).not.toContain('correctOptionIds');
    expect(JSON.stringify(learnerItem.definition)).not.toContain('correctOptionIds');
  });

  it('rejects a question when the exercise belongs to another course', async () => {
    mocks.getExerciseById.mockResolvedValue({ id: 'exercise-a', courseId: 'course-b' });

    await expect(getAssessmentItemForLearnerService('course-a', 'exercise-a', 16)).rejects.toMatchObject({
      code: ErrorCodes.EXERCISE_NOT_FOUND,
      statusCode: 404
    });
    expect(mocks.getQuestionWithOptionsForRevision).not.toHaveBeenCalled();
  });
});

describe('assessment item exercise-transaction mutations', () => {
  const txStub = {} as DbOrTxClient;
  const sectionId = '38b93783-427c-49e2-9c62-5c788fd28839';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (tx: DbOrTxClient) => Promise<unknown>) => callback(txStub));
    mocks.getExerciseById.mockResolvedValue({ id: 'exercise-a', courseId: 'course-a' });
    mocks.getExerciseSectionsByExerciseId.mockResolvedValue([{ id: sectionId }]);
    mocks.getAttemptedQuestionIds.mockResolvedValue([]);
    mocks.hasExerciseSubmissions.mockResolvedValue(false);
    mocks.getQuestionsByExerciseIds.mockResolvedValue([
      {
        id: 16,
        exerciseId: 'exercise-a',
        exerciseSectionId: sectionId,
        questionTypeId: 16,
        title: 'Existing item',
        order: 0,
        points: 2,
        archivedAt: null
      }
    ]);
    mocks.createQuestions.mockResolvedValue([
      {
        id: 17,
        exerciseId: 'exercise-a',
        exerciseSectionId: sectionId,
        questionTypeId: 16,
        title: 'Created item',
        order: 1,
        points: 2,
        archivedAt: null
      }
    ]);
    mocks.publishQuestionRevision.mockResolvedValue({ id: 'revision', revision: 1 });
  });

  it('creates and publishes canonical items through the caller-owned exercise transaction', async () => {
    const results = await applyAssessmentItemMutationsForExercise(
      'course-a',
      'exercise-a',
      [
        {
          action: 'publish',
          clientMutationId: 'existing-composer',
          questionId: 16,
          title: 'Renamed item',
          expectedRevision: 1,
          definition: supportedDefinition
        },
        {
          action: 'create',
          clientMutationId: 'new-composer',
          title: 'Created item',
          exerciseSectionId: sectionId,
          order: 1,
          definition: supportedDefinition
        }
      ],
      txStub
    );

    expect(mocks.createQuestions).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          exerciseId: 'exercise-a',
          exerciseSectionId: sectionId,
          questionTypeId: 16,
          title: 'Created item',
          order: 1,
          points: 2
        })
      ],
      txStub
    );
    expect(mocks.publishQuestionRevision).toHaveBeenCalledTimes(2);
    expect(mocks.updateQuestions).toHaveBeenCalledWith(
      [{ id: 16, data: { title: 'Renamed item' } }],
      'exercise-a',
      txStub
    );
    expect(results).toEqual([
      { clientMutationId: 'existing-composer', questionId: 16 },
      { clientMutationId: 'new-composer', questionId: 17 }
    ]);
  });

  it('rejects the entire mutation set before writes when a client mutation ID is duplicated', async () => {
    await expect(
      applyAssessmentItemMutationsForExercise(
        'course-a',
        'exercise-a',
        [
          {
            action: 'publish',
            clientMutationId: 'duplicate',
            questionId: 16,
            title: 'First',
            expectedRevision: 1,
            definition: supportedDefinition
          },
          {
            action: 'create',
            clientMutationId: 'duplicate',
            title: 'Second',
            exerciseSectionId: sectionId,
            order: 1,
            definition: supportedDefinition
          }
        ],
        txStub
      )
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 });

    expect(mocks.createQuestions).not.toHaveBeenCalled();
    expect(mocks.publishQuestionRevision).not.toHaveBeenCalled();
    expect(mocks.updateQuestions).not.toHaveBeenCalled();
  });

  it('rejects a create mutation before publishing sibling revisions when the exercise has submissions', async () => {
    mocks.hasExerciseSubmissions.mockResolvedValue(true);

    await expect(
      applyAssessmentItemMutationsForExercise(
        'course-a',
        'exercise-a',
        [
          {
            action: 'publish',
            clientMutationId: 'existing-composer',
            questionId: 16,
            title: 'Renamed item',
            expectedRevision: 1,
            definition: supportedDefinition
          },
          {
            action: 'create',
            clientMutationId: 'new-composer',
            title: 'Created item',
            exerciseSectionId: sectionId,
            order: 1,
            definition: supportedDefinition
          }
        ],
        txStub
      )
    ).rejects.toMatchObject({ code: ErrorCodes.CONFLICT, statusCode: 409 });

    expect(mocks.createQuestions).not.toHaveBeenCalled();
    expect(mocks.publishQuestionRevision).not.toHaveBeenCalled();
    expect(mocks.updateQuestions).not.toHaveBeenCalled();
  });

  it('rejects standalone canonical creation when an answer already freezes the question graph', async () => {
    mocks.transaction.mockImplementation(async (callback: (tx: DbOrTxClient) => Promise<unknown>) => callback(txStub));
    mocks.getAttemptedQuestionIds.mockResolvedValue([16]);

    await expect(
      createAssessmentItemForCourseService('course-a', 'exercise-a', 'Created item', supportedDefinition, sectionId)
    ).rejects.toMatchObject({ code: ErrorCodes.CONFLICT, statusCode: 409 });

    expect(mocks.createQuestions).not.toHaveBeenCalled();
    expect(mocks.publishQuestionRevision).not.toHaveBeenCalled();
  });

  it('rejects standalone canonical creation without a section when the exercise has sections', async () => {
    await expect(
      createAssessmentItemForCourseService('course-a', 'exercise-a', 'Created item', supportedDefinition, null)
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 });

    expect(mocks.createQuestions).not.toHaveBeenCalled();
    expect(mocks.publishQuestionRevision).not.toHaveBeenCalled();
  });

  it('allows standalone canonical creation without a section when the exercise has no sections', async () => {
    mocks.getExerciseSectionsByExerciseId.mockResolvedValue([]);
    mocks.getQuestionsByExerciseIds.mockResolvedValue([]);
    mocks.createQuestions.mockResolvedValue([
      {
        id: 17,
        exerciseId: 'exercise-a',
        exerciseSectionId: null,
        questionTypeId: 16,
        title: 'Created item',
        order: 0,
        points: 2,
        archivedAt: null
      }
    ]);
    mocks.getQuestionWithOptionsForRevision.mockResolvedValue({
      id: 17,
      exerciseId: 'exercise-a',
      exerciseSectionId: null,
      questionTypeId: 16,
      title: 'Created item',
      order: 0,
      points: 2,
      archivedAt: null
    });
    mocks.getCurrentQuestionRevision.mockResolvedValue({
      id: 'revision',
      revision: 1,
      definition: supportedDefinition
    });

    await expect(
      createAssessmentItemForCourseService('course-a', 'exercise-a', 'Created item', supportedDefinition, null)
    ).resolves.toMatchObject({ questionId: 17, exerciseSectionId: null });

    expect(mocks.createQuestions).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          exerciseId: 'exercise-a',
          exerciseSectionId: null,
          order: 0
        })
      ],
      txStub
    );
  });

  it('rejects standalone canonical creation for a section outside the exercise', async () => {
    await expect(
      createAssessmentItemForCourseService(
        'course-a',
        'exercise-a',
        'Created item',
        supportedDefinition,
        '7315fc3f-d45f-45d0-8252-eade6dc813ea'
      )
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 });

    expect(mocks.createQuestions).not.toHaveBeenCalled();
    expect(mocks.publishQuestionRevision).not.toHaveBeenCalled();
  });
});
