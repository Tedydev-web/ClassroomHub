import { beforeEach, describe, expect, it, vi } from 'vitest';

const txStub = {};

const mocks = vi.hoisted(() => ({
  applyAssessmentItemMutationsForExercise: vi.fn(),
  archiveQuestionsByIds: vi.fn(),
  createQuestions: vi.fn(),
  deleteExerciseSectionsByIds: vi.fn(),
  deleteExercise: vi.fn(),
  deleteOptionsByIds: vi.fn(),
  deleteQuestionsByIds: vi.fn(),
  getAttemptedQuestionIds: vi.fn(),
  getExerciseById: vi.fn(),
  getExerciseSectionsByExerciseId: vi.fn(),
  getExerciseWithRelationsOptimized: vi.fn(),
  getOptionsByQuestionIds: vi.fn(),
  getQuestionRevisionsByIds: vi.fn(),
  getQuestionsByExerciseIds: vi.fn(),
  hasExerciseSubmissions: vi.fn(),
  isCourseTeamMemberOrOrgAdmin: vi.fn(),
  lockExerciseAssignmentState: vi.fn(),
  updateExerciseSection: vi.fn(),
  updateOptions: vi.fn(),
  updateQuestions: vi.fn()
}));

vi.mock('@cio/db/drizzle', () => ({
  db: { transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(txStub)) }
}));
vi.mock('@cio/db/queries/exercise', () => ({
  archiveQuestionsByIds: mocks.archiveQuestionsByIds,
  createExerciseSections: vi.fn(),
  createExercises: vi.fn(),
  createOptions: vi.fn(),
  createQuestions: mocks.createQuestions,
  deleteExercise: mocks.deleteExercise,
  deleteExerciseSectionsByIds: mocks.deleteExerciseSectionsByIds,
  deleteOptionsByIds: mocks.deleteOptionsByIds,
  deleteQuestionsByIds: mocks.deleteQuestionsByIds,
  getAttemptedQuestionIds: mocks.getAttemptedQuestionIds,
  getExerciseById: mocks.getExerciseById,
  getExerciseCompletionByProfile: vi.fn(),
  getExerciseCompletionsByProfile: vi.fn(),
  getExerciseSectionsByExerciseId: mocks.getExerciseSectionsByExerciseId,
  getExerciseWithRelationsOptimized: mocks.getExerciseWithRelationsOptimized,
  getExercisesByCourseId: vi.fn(),
  getLMSExercises: vi.fn(),
  getOptionsByQuestionIds: mocks.getOptionsByQuestionIds,
  getQuestionRevisionsByIds: mocks.getQuestionRevisionsByIds,
  getQuestionTypesByIds: vi.fn(),
  getQuestionsByExerciseIds: mocks.getQuestionsByExerciseIds,
  hasExerciseSubmissions: mocks.hasExerciseSubmissions,
  lockExerciseAssignmentState: mocks.lockExerciseAssignmentState,
  syncOptionIdSequence: vi.fn(),
  syncQuestionIdSequence: vi.fn(),
  updateExercise: vi.fn(),
  updateExerciseSection: mocks.updateExerciseSection,
  updateOptions: mocks.updateOptions,
  updateQuestions: mocks.updateQuestions
}));
vi.mock('@cio/db/queries/lesson', () => ({ getLessonById: vi.fn() }));
vi.mock('@cio/db/queries/group', () => ({
  isCourseTeamMemberOrOrgAdmin: mocks.isCourseTeamMemberOrOrgAdmin
}));
vi.mock('@cio/db/queries/course', () => ({
  findNonAutoGradableQuestionsInCourse: vi.fn(),
  getCourseSectionById: vi.fn(),
  getCourseTypeById: vi.fn(),
  getTakenItemSlugs: vi.fn(),
  hasSelectivelyAssignedExercises: vi.fn(),
  touchCourseUpdatedAt: vi.fn()
}));
vi.mock('@cio/core/services/exercise/assessment-item', () => ({
  applyAssessmentItemMutationsForExercise: mocks.applyAssessmentItemMutationsForExercise
}));

import { ErrorCodes } from '@api/utils/errors';
import {
  deleteExerciseService,
  getExercise,
  getExerciseForCourseService,
  replaceExerciseService,
  updateExerciseService
} from '@cio/core/services/exercise/exercise';

const activeQuestionRow = {
  id: 1,
  exerciseId: 'exercise-a',
  title: 'Active question',
  questionTypeId: 3,
  points: 1,
  order: 0,
  settings: {},
  exerciseSectionId: null,
  archivedAt: null
};

const archivedQuestionRow = {
  ...activeQuestionRow,
  id: 2,
  title: 'Archived question',
  archivedAt: '2026-07-16T00:00:00.000Z'
};

describe('updateExerciseService archived question hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getExerciseById.mockResolvedValue({ id: 'exercise-a', courseId: null, slug: null, title: 'Exercise' });
    mocks.lockExerciseAssignmentState.mockResolvedValue(undefined);
    mocks.getQuestionsByExerciseIds.mockResolvedValue([activeQuestionRow, archivedQuestionRow]);
    mocks.getOptionsByQuestionIds.mockResolvedValue([]);
    mocks.hasExerciseSubmissions.mockResolvedValue(false);
    mocks.isCourseTeamMemberOrOrgAdmin.mockResolvedValue(false);
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: { id: 'exercise-a', courseId: null },
      questions: []
    });
    mocks.getExerciseSectionsByExerciseId.mockResolvedValue([]);
    mocks.getQuestionRevisionsByIds.mockResolvedValue([]);
  });

  it('rejects a stale payload that edits an archived question', async () => {
    await expect(
      updateExerciseService('exercise-a', {
        questions: [{ id: 2, question: 'Edited archived question', points: 2 }]
      })
    ).rejects.toMatchObject({ code: ErrorCodes.CONFLICT, statusCode: 409 });

    expect(mocks.updateQuestions).not.toHaveBeenCalled();
    expect(mocks.createQuestions).not.toHaveBeenCalled();
    expect(mocks.deleteQuestionsByIds).not.toHaveBeenCalled();
    expect(mocks.archiveQuestionsByIds).not.toHaveBeenCalled();
  });

  it('re-archives (never hard-deletes) an already archived question on re-delete', async () => {
    mocks.hasExerciseSubmissions.mockResolvedValue(true);
    mocks.getAttemptedQuestionIds.mockResolvedValue([2]);
    mocks.archiveQuestionsByIds.mockResolvedValue([archivedQuestionRow]);

    await updateExerciseService('exercise-a', {
      questions: [{ id: 2, question: 'Archived question', deletedAt: '2026-07-16T01:00:00.000Z' }]
    });

    expect(mocks.archiveQuestionsByIds).toHaveBeenCalledWith([2], 'exercise-a', txStub);
    expect(mocks.deleteQuestionsByIds).not.toHaveBeenCalled();
    // The update response is the active-delivery read.
    expect(mocks.getExerciseWithRelationsOptimized).toHaveBeenCalledWith('exercise-a', txStub, {
      questionScope: 'active'
    });
  });
});

describe('updateExerciseService canonical question placement', () => {
  const sectionOneId = '38b93783-427c-49e2-9c62-5c788fd28839';
  const sectionTwoId = '08888548-1123-412e-9a78-58ce0c13785e';
  const canonicalQuestionRow = {
    ...activeQuestionRow,
    id: 16,
    title: 'Composite item',
    questionTypeId: 16,
    currentRevisionId: 'revision-16',
    exerciseSectionId: sectionOneId
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getExerciseById.mockResolvedValue({ id: 'exercise-a', courseId: null, slug: null, title: 'Exercise' });
    mocks.lockExerciseAssignmentState.mockResolvedValue(undefined);
    mocks.getQuestionsByExerciseIds.mockResolvedValue([activeQuestionRow, canonicalQuestionRow]);
    mocks.getOptionsByQuestionIds.mockResolvedValue([]);
    mocks.getAttemptedQuestionIds.mockResolvedValue([]);
    mocks.hasExerciseSubmissions.mockResolvedValue(false);
    mocks.isCourseTeamMemberOrOrgAdmin.mockResolvedValue(false);
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: { id: 'exercise-a', courseId: null },
      questions: []
    });
    mocks.getExerciseSectionsByExerciseId.mockResolvedValue([
      {
        id: sectionOneId,
        exerciseId: 'exercise-a',
        title: 'Section one',
        description: null,
        order: 0,
        colorTheme: 'blue',
        afterBehavior: { action: 'continue' }
      },
      {
        id: sectionTwoId,
        exerciseId: 'exercise-a',
        title: 'Section two',
        description: null,
        order: 1,
        colorTheme: 'green',
        afterBehavior: { action: 'continue' }
      }
    ]);
    mocks.getQuestionRevisionsByIds.mockResolvedValue([]);
  });

  it('moves and reorders the complete canonical placement snapshot in the exercise transaction', async () => {
    await updateExerciseService('exercise-a', {
      canonicalQuestionPlacements: [
        {
          id: canonicalQuestionRow.id,
          exerciseSectionId: sectionTwoId,
          order: 2
        }
      ]
    });

    expect(mocks.updateQuestions).toHaveBeenCalledWith(
      [
        {
          id: canonicalQuestionRow.id,
          data: { exerciseSectionId: sectionTwoId, order: 2 }
        }
      ],
      'exercise-a',
      txStub
    );
  });

  it('rejects placements that target a section outside the exercise', async () => {
    await expect(
      updateExerciseService('exercise-a', {
        canonicalQuestionPlacements: [
          {
            id: canonicalQuestionRow.id,
            exerciseSectionId: '8068a3e4-9b5b-42bb-a86f-644f316a78de',
            order: 2
          }
        ]
      })
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 });

    expect(mocks.updateQuestions).not.toHaveBeenCalled();
  });

  it('rejects a partial canonical placement snapshot', async () => {
    mocks.getQuestionsByExerciseIds.mockResolvedValue([
      canonicalQuestionRow,
      { ...canonicalQuestionRow, id: 17, currentRevisionId: 'revision-17' }
    ]);

    await expect(
      updateExerciseService('exercise-a', {
        canonicalQuestionPlacements: [
          {
            id: canonicalQuestionRow.id,
            exerciseSectionId: sectionTwoId,
            order: 2
          }
        ]
      })
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 });

    expect(mocks.updateQuestions).not.toHaveBeenCalled();
  });

  it('rejects deleting a section that contains an attempted canonical question', async () => {
    mocks.getAttemptedQuestionIds.mockResolvedValue([canonicalQuestionRow.id]);

    await expect(
      updateExerciseService('exercise-a', {
        sections: [
          {
            id: sectionTwoId,
            title: 'Section two',
            description: null,
            order: 0,
            colorTheme: 'green',
            afterBehavior: { action: 'continue' }
          }
        ],
        canonicalQuestionPlacements: [
          {
            id: canonicalQuestionRow.id,
            exerciseSectionId: sectionTwoId,
            order: 2
          }
        ]
      })
    ).rejects.toMatchObject({ code: ErrorCodes.CONFLICT, statusCode: 409 });

    expect(mocks.deleteExerciseSectionsByIds).not.toHaveBeenCalled();
    expect(mocks.updateQuestions).not.toHaveBeenCalled();
  });

  it('requires a complete placement snapshot before deleting a section with canonical questions', async () => {
    await expect(
      updateExerciseService('exercise-a', {
        sections: [
          {
            id: sectionTwoId,
            title: 'Section two',
            description: null,
            order: 0,
            colorTheme: 'green',
            afterBehavior: { action: 'continue' }
          }
        ]
      })
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 });

    expect(mocks.deleteExerciseSectionsByIds).not.toHaveBeenCalled();
  });

  it('validates order uniqueness against the final mixed legacy and canonical placement state', async () => {
    const sectionedLegacyQuestion = {
      ...activeQuestionRow,
      exerciseSectionId: sectionTwoId,
      order: 0
    };
    const sectionedCanonicalQuestion = {
      ...canonicalQuestionRow,
      exerciseSectionId: sectionTwoId,
      order: 1
    };
    mocks.getQuestionsByExerciseIds.mockResolvedValue([sectionedLegacyQuestion, sectionedCanonicalQuestion]);

    await updateExerciseService('exercise-a', {
      questions: [
        {
          id: sectionedLegacyQuestion.id,
          question: sectionedLegacyQuestion.title,
          questionTypeId: sectionedLegacyQuestion.questionTypeId,
          exerciseSectionId: sectionTwoId,
          order: 1
        }
      ],
      canonicalQuestionPlacements: [
        {
          id: sectionedCanonicalQuestion.id,
          exerciseSectionId: sectionTwoId,
          order: 0
        }
      ]
    });

    expect(mocks.updateQuestions).toHaveBeenCalledWith(
      [{ id: sectionedCanonicalQuestion.id, data: { exerciseSectionId: sectionTwoId, order: 0 } }],
      'exercise-a',
      txStub
    );
    expect(mocks.updateQuestions).toHaveBeenCalledWith(
      [{ id: sectionedLegacyQuestion.id, data: { order: 1 } }],
      'exercise-a',
      txStub
    );
  });
});

describe('updateExerciseService atomic assessment item mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getExerciseById.mockResolvedValue({ id: 'exercise-a', courseId: 'course-a', slug: null, title: 'Exercise' });
    mocks.lockExerciseAssignmentState.mockResolvedValue(undefined);
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: { id: 'exercise-a', courseId: 'course-a' },
      questions: []
    });
    mocks.getExerciseSectionsByExerciseId.mockResolvedValue([]);
    mocks.getQuestionRevisionsByIds.mockResolvedValue([]);
    mocks.applyAssessmentItemMutationsForExercise.mockResolvedValue([
      { clientMutationId: 'composer-a', questionId: 16 }
    ]);
  });

  it('applies canonical mutations inside the exercise transaction and returns client ID mappings', async () => {
    const assessmentItemMutations = [
      {
        action: 'create' as const,
        clientMutationId: 'composer-a',
        title: 'Composite item',
        exerciseSectionId: null,
        order: 0,
        definition: {
          schemaVersion: 1 as const,
          blocks: [
            {
              id: 'text-1',
              kind: 'interaction' as const,
              interaction: {
                kind: 'text' as const,
                prompt: { format: 'html' as const, html: '<p>Explain.</p>' },
                required: true,
                maxScore: 2,
                config: { format: 'plain' as const }
              }
            }
          ],
          feedback: []
        }
      }
    ];

    const result = await updateExerciseService('exercise-a', { assessmentItemMutations });

    expect(mocks.applyAssessmentItemMutationsForExercise).toHaveBeenCalledWith(
      'course-a',
      'exercise-a',
      assessmentItemMutations,
      txStub
    );
    expect(result.assessmentItemMutationResults).toEqual([{ clientMutationId: 'composer-a', questionId: 16 }]);
  });
});

describe('legacy submission-less answers (orphan answers) freeze the question graph', () => {
  const draftQuestionRow = {
    ...activeQuestionRow,
    id: 3,
    title: 'Unattempted draft question'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getExerciseById.mockResolvedValue({ id: 'exercise-a', courseId: null, slug: null, title: 'Exercise' });
    mocks.lockExerciseAssignmentState.mockResolvedValue(undefined);
    mocks.getQuestionsByExerciseIds.mockResolvedValue([activeQuestionRow, archivedQuestionRow]);
    mocks.getOptionsByQuestionIds.mockResolvedValue([]);
    // No submission row survives, but question 1 still has question_answer rows
    // (legacy data / deleted submission): it must count as attempted everywhere.
    mocks.hasExerciseSubmissions.mockResolvedValue(false);
    mocks.getAttemptedQuestionIds.mockResolvedValue([1]);
    mocks.archiveQuestionsByIds.mockResolvedValue([]);
    mocks.deleteQuestionsByIds.mockResolvedValue([]);
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: { id: 'exercise-a', courseId: null },
      questions: []
    });
    mocks.getExerciseSectionsByExerciseId.mockResolvedValue([]);
    mocks.getQuestionRevisionsByIds.mockResolvedValue([]);
  });

  it('rejects in-place edits of the question graph with 409, never mutating rows', async () => {
    await expect(
      updateExerciseService('exercise-a', {
        questions: [{ id: 1, question: 'Edited attempted question', points: 5 }]
      })
    ).rejects.toMatchObject({ code: ErrorCodes.CONFLICT, statusCode: 409 });

    expect(mocks.updateQuestions).not.toHaveBeenCalled();
    expect(mocks.createQuestions).not.toHaveBeenCalled();
    expect(mocks.deleteQuestionsByIds).not.toHaveBeenCalled();
  });

  it('still allows removals: archives the attempted question, hard-deletes the draft', async () => {
    mocks.getQuestionsByExerciseIds.mockResolvedValue([activeQuestionRow, draftQuestionRow]);

    await updateExerciseService('exercise-a', {
      questions: [
        { id: 1, question: 'Active question', deletedAt: '2026-07-16T01:00:00.000Z' },
        { id: 3, question: 'Unattempted draft question', deletedAt: '2026-07-16T01:00:00.000Z' }
      ]
    });

    expect(mocks.archiveQuestionsByIds).toHaveBeenCalledWith([1], 'exercise-a', txStub);
    expect(mocks.deleteQuestionsByIds).toHaveBeenCalledWith([3], 'exercise-a', txStub);
  });

  it('replaceExerciseService fails with a deliberate 409 instead of an FK-driven 500', async () => {
    await expect(replaceExerciseService('exercise-a', { questions: [] })).rejects.toMatchObject({
      code: ErrorCodes.CONFLICT,
      statusCode: 409
    });

    expect(mocks.deleteQuestionsByIds).not.toHaveBeenCalled();
    expect(mocks.createQuestions).not.toHaveBeenCalled();
  });

  it('deleteExerciseService fails with a deliberate 409 instead of an FK-driven 500', async () => {
    await expect(deleteExerciseService('exercise-a')).rejects.toMatchObject({
      code: ErrorCodes.CONFLICT,
      statusCode: 409
    });

    expect(mocks.deleteExercise).not.toHaveBeenCalled();
  });

  it('replace/delete still proceed when no answers exist at all', async () => {
    mocks.getAttemptedQuestionIds.mockResolvedValue([]);
    mocks.deleteExercise.mockResolvedValue({ id: 'exercise-a', courseId: null });

    await expect(deleteExerciseService('exercise-a')).resolves.toMatchObject({ id: 'exercise-a' });
    expect(mocks.deleteExercise).toHaveBeenCalledWith('exercise-a', txStub);
  });
});

describe('getExercise active read hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isCourseTeamMemberOrOrgAdmin.mockResolvedValue(false);
    mocks.getExerciseSectionsByExerciseId.mockResolvedValue([]);
    mocks.getQuestionRevisionsByIds.mockResolvedValue([]);
  });

  it('reads legacy and internal composite rows through their separate contracts', async () => {
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: { id: 'exercise-a', courseId: 'course-a' },
      questions: [
        {
          ...activeQuestionRow,
          questionTypeId: 1,
          questionType: { id: 1, label: 'Single answer', typename: 'RADIO' },
          options: []
        },
        {
          ...activeQuestionRow,
          id: 3,
          title: 'Composite item',
          questionTypeId: 16,
          currentRevisionId: 'revision-3',
          questionType: { id: 16, label: 'Composite item', typename: 'ASSESSMENT_ITEM' },
          options: []
        }
      ]
    });
    mocks.getQuestionRevisionsByIds.mockResolvedValue([
      {
        id: 'revision-3',
        questionId: 3,
        revision: 1,
        definition: {
          schemaVersion: 1,
          blocks: [
            {
              id: 'choice-1',
              kind: 'interaction',
              interaction: {
                kind: 'choice',
                prompt: { format: 'html', html: '<p>Choose one.</p>' },
                required: true,
                maxScore: 2,
                config: {
                  cardinality: 'single',
                  presentation: 'list',
                  options: [
                    { id: 'a', html: '<p>A</p>' },
                    { id: 'b', html: '<p>B</p>' }
                  ],
                  correctOptionIds: ['a']
                }
              }
            }
          ],
          feedback: []
        }
      }
    ]);

    const exercise = await getExercise('exercise-a');

    expect(mocks.getExerciseWithRelationsOptimized).toHaveBeenCalledWith('exercise-a', undefined, {
      questionScope: 'active'
    });
    expect((exercise.questions ?? []).map((question) => question.id)).toEqual([1]);
    expect(exercise.canonicalQuestions).toEqual([
      {
        id: 3,
        title: 'Composite item',
        points: 1,
        order: 0,
        exerciseSectionId: null,
        gradingMode: 'auto',
        revisionId: 'revision-3',
        revision: 1,
        authorDefinition: null,
        definition: {
          schemaVersion: 1,
          blocks: [
            {
              id: 'choice-1',
              kind: 'interaction',
              interaction: {
                kind: 'choice',
                prompt: { format: 'html', html: '<p>Choose one.</p>' },
                required: true,
                maxScore: 2,
                config: {
                  cardinality: 'single',
                  presentation: 'list',
                  options: [
                    { id: 'a', html: '<p>A</p>' },
                    { id: 'b', html: '<p>B</p>' }
                  ]
                }
              }
            }
          ]
        }
      }
    ]);
  });

  it('returns full canonical definitions only to an authorized course author', async () => {
    mocks.isCourseTeamMemberOrOrgAdmin.mockResolvedValue(true);
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: { id: 'exercise-a', courseId: 'course-a' },
      questions: [
        {
          ...activeQuestionRow,
          id: 3,
          title: 'Composite item',
          questionTypeId: 16,
          currentRevisionId: 'revision-3',
          questionType: { id: 16, label: 'Composite item', typename: 'ASSESSMENT_ITEM' },
          options: []
        }
      ]
    });
    const authorDefinition = {
      schemaVersion: 1 as const,
      blocks: [
        {
          id: 'choice-1',
          kind: 'interaction' as const,
          interaction: {
            kind: 'choice' as const,
            prompt: { format: 'html' as const, html: '<p>Choose one.</p>' },
            required: true,
            maxScore: 2,
            config: {
              cardinality: 'single' as const,
              presentation: 'list' as const,
              options: [{ id: 'a', html: '<p>A</p>' }],
              correctOptionIds: ['a']
            }
          }
        }
      ],
      feedback: []
    };
    mocks.getQuestionRevisionsByIds.mockResolvedValue([
      { id: 'revision-3', questionId: 3, revision: 1, definition: authorDefinition }
    ]);

    const exercise = await getExercise('exercise-a', undefined, 'profile-author');
    const canonicalQuestion = exercise.canonicalQuestions?.[0];

    expect(mocks.isCourseTeamMemberOrOrgAdmin).toHaveBeenCalledWith('course-a', 'profile-author');
    expect(mocks.getQuestionRevisionsByIds).toHaveBeenCalledOnce();
    expect(canonicalQuestion?.authorDefinition).toEqual(authorDefinition);
    expect(JSON.stringify(canonicalQuestion?.definition)).not.toContain('correctOptionIds');
  });

  it('projects legacy questions without answer keys for an enrolled learner', async () => {
    const orderingOptions = [
      { id: 91, questionId: 9, label: 'First', value: 'First', isCorrect: false, settings: {} },
      { id: 92, questionId: 9, label: 'Second', value: 'Second', isCorrect: false, settings: {} },
      { id: 93, questionId: 9, label: 'Third', value: 'Third', isCorrect: false, settings: {} }
    ];
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: { id: 'exercise-a', courseId: 'course-a' },
      questions: [
        {
          ...activeQuestionRow,
          questionTypeId: 1,
          questionType: { id: 1, label: 'Single answer', typename: 'RADIO' },
          settings: { description: 'Visible prompt details', privateMarker: 'must-not-ship' },
          options: [
            {
              id: 11,
              questionId: 1,
              label: 'A',
              value: 'A',
              isCorrect: true,
              settings: { imageUrl: 'https://cdn.test/a.png', privateMarker: 'must-not-ship' }
            },
            { id: 12, questionId: 1, label: 'B', value: 'B', isCorrect: false, settings: {} }
          ]
        },
        {
          ...activeQuestionRow,
          id: 6,
          questionTypeId: 6,
          questionType: { id: 6, label: 'Numeric answer', typename: 'NUMERIC' },
          settings: { correctValue: 42, tolerance: 0.5, imageUrls: ['https://cdn.test/numeric.png'] },
          options: []
        },
        {
          ...activeQuestionRow,
          id: 7,
          questionTypeId: 7,
          questionType: { id: 7, label: 'Fill in the blank', typename: 'FILL_BLANK' },
          settings: { acceptedAnswers: 'secret answer' },
          options: []
        },
        {
          ...activeQuestionRow,
          id: 9,
          questionTypeId: 9,
          questionType: { id: 9, label: 'Ordering', typename: 'ORDERING' },
          settings: { items: ['First', 'Second', 'Third'] },
          options: orderingOptions
        },
        {
          ...activeQuestionRow,
          id: 10,
          questionTypeId: 9,
          questionType: { id: 9, label: 'Ordering', typename: 'ORDERING' },
          settings: { items: ['Alpha', 'Beta', 'Gamma'] },
          options: []
        },
        {
          ...activeQuestionRow,
          id: 11,
          questionTypeId: 11,
          questionType: { id: 11, label: 'Word bank', typename: 'WORD_BANK' },
          settings: {
            template: 'The ___ is blue.',
            correctAnswers: ['sky'],
            distractors: ['sea', 'grass']
          },
          options: []
        },
        {
          ...activeQuestionRow,
          id: 12,
          questionTypeId: 12,
          questionType: { id: 12, label: 'Star rating', typename: 'STAR' },
          settings: { maxStars: 5, correctValue: 4 },
          options: []
        },
        {
          ...activeQuestionRow,
          id: 13,
          questionTypeId: 13,
          questionType: { id: 13, label: 'Video recording', typename: 'VIDEO_RECORDING' },
          settings: { maxDurationSeconds: 90, allowRetakes: true },
          options: []
        }
      ]
    });

    const firstRead = await getExercise('exercise-a', undefined, 'profile-learner');
    const secondRead = await getExercise('exercise-a', undefined, 'profile-learner');
    const learnerPayload = JSON.stringify(firstRead.questions);
    const radioQuestion = firstRead.questions?.find((question) => question.id === 1);
    const orderingQuestion = firstRead.questions?.find((question) => question.id === 9);
    const repeatedOrderingQuestion = secondRead.questions?.find((question) => question.id === 9);
    const settingsOnlyOrderingQuestion = firstRead.questions?.find((question) => question.id === 10);
    const wordBankQuestion = firstRead.questions?.find((question) => question.id === 11);

    expect(mocks.isCourseTeamMemberOrOrgAdmin).toHaveBeenCalledWith('course-a', 'profile-learner');
    expect(learnerPayload).not.toContain('"isCorrect"');
    expect(learnerPayload).not.toContain('"correctValue"');
    expect(learnerPayload).not.toContain('"acceptedAnswers"');
    expect(learnerPayload).not.toContain('"correctAnswers"');
    expect(learnerPayload).not.toContain('"distractors"');
    expect(settingsOnlyOrderingQuestion?.settings).toHaveProperty('items');
    expect(learnerPayload).not.toContain('"privateMarker"');
    expect(radioQuestion?.settings).toEqual({ description: 'Visible prompt details' });
    expect(radioQuestion?.options[0]?.settings).toEqual({ imageUrl: 'https://cdn.test/a.png' });
    expect(firstRead.questions?.find((question) => question.id === 6)?.settings).toEqual({
      imageUrls: ['https://cdn.test/numeric.png']
    });
    expect(firstRead.questions?.find((question) => question.id === 12)?.settings).toEqual({ maxStars: 5 });
    expect(firstRead.questions?.find((question) => question.id === 13)?.settings).toEqual({
      maxDurationSeconds: 90,
      allowRetakes: true
    });
    expect(wordBankQuestion?.settings).toMatchObject({
      template: 'The ___ is blue.',
      bankTokens: expect.arrayContaining(['sky', 'sea', 'grass'])
    });
    expect(repeatedOrderingQuestion?.options.map((option) => option.id)).toEqual(
      orderingQuestion?.options.map((option) => option.id)
    );
    expect(settingsOnlyOrderingQuestion?.options).toEqual([]);
    expect(settingsOnlyOrderingQuestion?.settings?.items).toHaveLength(3);
    expect(new Set(settingsOnlyOrderingQuestion?.settings?.items as string[])).toEqual(
      new Set(['Alpha', 'Beta', 'Gamma'])
    );
  });

  it('keeps full legacy answer keys for an authorized course author', async () => {
    mocks.isCourseTeamMemberOrOrgAdmin.mockResolvedValue(true);
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: { id: 'exercise-a', courseId: 'course-a' },
      questions: [
        {
          ...activeQuestionRow,
          questionTypeId: 1,
          questionType: { id: 1, label: 'Single answer', typename: 'RADIO' },
          settings: { correctValue: 'A' },
          options: [{ id: 11, questionId: 1, label: 'A', value: 'A', isCorrect: true, settings: {} }]
        }
      ]
    });

    const exercise = await getExercise('exercise-a', undefined, 'profile-author');

    expect(exercise.questions?.[0]?.settings).toEqual({ correctValue: 'A' });
    expect(exercise.questions?.[0]?.options[0]?.isCorrect).toBe(true);
  });

  it('rejects an exercise read scoped through a different course', async () => {
    mocks.getExerciseById.mockResolvedValue({
      id: 'exercise-b',
      courseId: 'course-b',
      slug: null,
      title: 'Foreign exercise'
    });

    await expect(getExerciseForCourseService('course-a', 'exercise-b')).rejects.toMatchObject({
      code: ErrorCodes.EXERCISE_NOT_FOUND,
      statusCode: 404
    });
    expect(mocks.getExerciseWithRelationsOptimized).not.toHaveBeenCalled();
  });
});

describe('question graph deletes stay inside the edited exercise', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getExerciseById.mockResolvedValue({ id: 'exercise-a', courseId: null, slug: null, title: 'Exercise' });
    mocks.lockExerciseAssignmentState.mockResolvedValue(undefined);
    mocks.getQuestionsByExerciseIds.mockResolvedValue([activeQuestionRow]);
    mocks.getOptionsByQuestionIds.mockResolvedValue([
      { id: 10, questionId: 1, label: 'A', value: 'A', isCorrect: true, settings: {} }
    ]);
    mocks.hasExerciseSubmissions.mockResolvedValue(false);
    mocks.getAttemptedQuestionIds.mockResolvedValue([]);
    mocks.isCourseTeamMemberOrOrgAdmin.mockResolvedValue(false);
    mocks.deleteQuestionsByIds.mockResolvedValue([]);
    mocks.deleteOptionsByIds.mockResolvedValue([]);
    mocks.archiveQuestionsByIds.mockResolvedValue([]);
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: { id: 'exercise-a', courseId: null },
      questions: []
    });
    mocks.getExerciseSectionsByExerciseId.mockResolvedValue([]);
    mocks.getQuestionRevisionsByIds.mockResolvedValue([]);
  });

  it('rejects a delete for a question id that belongs to another exercise', async () => {
    await expect(
      updateExerciseService('exercise-a', {
        questions: [{ id: 999, question: 'Foreign question', deletedAt: '2026-07-25T00:00:00.000Z' }]
      })
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 });

    expect(mocks.deleteQuestionsByIds).not.toHaveBeenCalled();
    expect(mocks.archiveQuestionsByIds).not.toHaveBeenCalled();
    expect(mocks.createQuestions).not.toHaveBeenCalled();
  });

  it('rejects an update for a question id that belongs to another exercise', async () => {
    await expect(
      updateExerciseService('exercise-a', {
        questions: [{ id: 999, question: 'Foreign question', points: 1 }]
      })
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 });

    expect(mocks.updateQuestions).not.toHaveBeenCalled();
    expect(mocks.createQuestions).not.toHaveBeenCalled();
  });

  it('rejects a delete for an option id that belongs to another question', async () => {
    await expect(
      updateExerciseService('exercise-a', {
        questions: [
          {
            id: 1,
            question: 'Active question',
            options: [{ id: 888, label: 'Foreign option', isCorrect: false, deletedAt: '2026-07-25T00:00:00.000Z' }]
          }
        ]
      })
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 });

    expect(mocks.deleteOptionsByIds).not.toHaveBeenCalled();
  });

  it('passes the owning exercise id to update queries', async () => {
    await updateExerciseService('exercise-a', {
      questions: [
        {
          id: 1,
          question: 'Updated question',
          options: [{ id: 10, label: 'Updated option', isCorrect: true, settings: {} }]
        }
      ]
    });

    expect(mocks.updateQuestions).toHaveBeenCalledWith(expect.any(Array), 'exercise-a', txStub);
    expect(mocks.updateOptions).toHaveBeenCalledWith(expect.any(Array), 'exercise-a', txStub);
  });

  it('passes the owning exercise id to the delete queries', async () => {
    await updateExerciseService('exercise-a', {
      questions: [
        {
          id: 1,
          question: 'Active question',
          options: [{ id: 10, label: 'A', isCorrect: true, deletedAt: '2026-07-25T00:00:00.000Z' }]
        }
      ]
    });

    expect(mocks.deleteOptionsByIds).toHaveBeenCalledWith([10], 'exercise-a', txStub);
  });
});
