import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildEmailBranding: vi.fn(),
  buildEmailFromName: vi.fn(),
  createAssetUsage: vi.fn(),
  createSubmission: vi.fn(),
  enqueueTransactionalEmail: vi.fn(),
  evaluateCourseCertification: vi.fn(),
  getCourseById: vi.fn(),
  lockAssetById: vi.fn(),
  getCourseOrganizationId: vi.fn(),
  getCourseTeachers: vi.fn(),
  getCourseWithOrgData: vi.fn(),
  getDashboardBaseUrl: vi.fn(),
  getExerciseById: vi.fn(),
  getProfileByGroupMemberId: vi.fn(),
  getCurrentQuestionRevision: vi.fn(),
  getQuestionAnswersBySubmissionId: vi.fn(),
  getQuestionRevisionsByIds: vi.fn(),
  getSubmissionByIdempotencyKey: vi.fn(),
  getExerciseWithRelationsOptimized: vi.fn(),
  insertQuestionAnswersBatch: vi.fn(),
  lockExerciseAssignmentState: vi.fn(),
  resolveGroupMemberExerciseAccess: vi.fn(),
  syncComplianceProgressFromSubmission: vi.fn(),
  transaction: vi.fn(),
  updateSubmissionGrades: vi.fn()
}));

/**
 * Approved contract: `createSubmissionService` materializes/reuses immutable
 * question revisions through the assessment gateway and links every new answer
 * row to the exact attempted revision. The gateway is mocked so this suite pins
 * the service's linkage behavior without a database.
 */
const questionRevisionGatewayMocks = vi.hoisted(() => ({
  materializeLegacyQuestionRevision: vi.fn(),
  publishQuestionRevision: vi.fn(),
  resolveAttemptedQuestionSet: vi.fn()
}));

vi.mock('@cio/core/services/assessment/question-revision', () => questionRevisionGatewayMocks);

vi.mock('@cio/db/drizzle', () => ({ db: { transaction: mocks.transaction } }));
vi.mock('@cio/db/queries/submission', () => ({
  createSubmission: mocks.createSubmission,
  deleteSubmission: vi.fn(),
  getQuestionAnswersBySubmissionId: mocks.getQuestionAnswersBySubmissionId,
  getSubmissionById: vi.fn(),
  getSubmissionByIdempotencyKey: mocks.getSubmissionByIdempotencyKey,
  getSubmissionsByCourseIdWithDetails: vi.fn(),
  getSubmissionsForGrading: vi.fn(),
  hasSubmission: vi.fn(),
  insertQuestionAnswersBatch: mocks.insertQuestionAnswersBatch,
  updateSubmission: vi.fn(),
  updateSubmissionGrades: mocks.updateSubmissionGrades
}));
vi.mock('@cio/db/queries/exercise', () => ({
  getExerciseById: mocks.getExerciseById,
  getExerciseWithRelationsOptimized: mocks.getExerciseWithRelationsOptimized,
  getCurrentQuestionRevision: mocks.getCurrentQuestionRevision,
  getQuestionRevisionsByIds: mocks.getQuestionRevisionsByIds,
  lockExerciseAssignmentState: mocks.lockExerciseAssignmentState,
  resolveGroupMemberExerciseAccess: mocks.resolveGroupMemberExerciseAccess
}));
vi.mock('@cio/db/queries/assets', () => ({
  createAssetUsage: mocks.createAssetUsage,
  deleteAssetUsagesByTarget: vi.fn(),
  lockAssetById: mocks.lockAssetById
}));
vi.mock('@cio/db/queries/course', () => ({
  getCourseById: mocks.getCourseById,
  getCourseWithOrgData: mocks.getCourseWithOrgData
}));
vi.mock('@cio/db/queries/course/people', () => ({
  getCourseTeachers: mocks.getCourseTeachers,
  getProfileByGroupMemberId: mocks.getProfileByGroupMemberId
}));
vi.mock('@cio/db/queries/group', () => ({
  getGroupMemberIdByCourseAndProfile: vi.fn(),
  isCourseTeamMemberOrOrgAdmin: vi.fn()
}));
vi.mock('@cio/db/queries/course/progression', () => ({ isExerciseCompletedForMember: vi.fn() }));
vi.mock('@cio/db/queries/notifications', () => ({ createNotification: vi.fn() }));
vi.mock('@cio/db/queries/tag', () => ({ getCourseOrganizationId: mocks.getCourseOrganizationId }));
vi.mock('@cio/core/config/dashboard-url', () => ({ getDashboardBaseUrl: mocks.getDashboardBaseUrl }));
vi.mock('@cio/core/utils/s3', () => ({
  generateDocumentDownloadPresignedUrls: vi.fn(),
  generateVideoDownloadPresignedUrls: vi.fn()
}));
vi.mock('@cio/email', () => ({
  buildEmailBranding: mocks.buildEmailBranding,
  buildEmailFromName: mocks.buildEmailFromName
}));
vi.mock('@api/services/jobs', () => ({ enqueueTransactionalEmail: mocks.enqueueTransactionalEmail }));
vi.mock('@api/services/course/compliance', () => ({
  syncComplianceProgressFromSubmission: mocks.syncComplianceProgressFromSubmission
}));
vi.mock('@api/services/course/completion', () => ({
  evaluateCourseCertification: mocks.evaluateCourseCertification
}));
vi.mock('@api/services/webhook', () => ({ emitWebhookEvent: vi.fn() }));

import { ErrorCodes } from '@api/utils/errors';
import { createSubmissionService } from './submission';

const courseId = 'course-a';
const exerciseId = 'exercise-a';
const submittedBy = 'member-a';
const question = {
  id: 1,
  exerciseId,
  title: 'Choose one',
  questionTypeId: 1,
  points: 2,
  settings: {},
  questionType: { id: 1, typename: 'RADIO' },
  options: [{ id: 11, questionId: 1, label: 'Correct', value: 'correct', isCorrect: true }]
};
const videoAnswer = {
  type: 'VIDEO_RECORDING',
  assetId: 'asset-a',
  storageKey: 'recordings/answer.webm',
  fileName: 'answer.webm',
  mimeType: 'video/webm',
  size: 1024,
  durationSeconds: 20,
  recordedAt: '2026-07-16T00:00:00.000Z',
  uploadedAt: '2026-07-16T00:00:01.000Z',
  provider: 'cloudflare'
} as const;
const videoQuestion = {
  ...question,
  id: 2,
  title: 'Record an answer',
  questionTypeId: 13,
  settings: { maxDurationSeconds: 60 },
  questionType: { id: 13, typename: 'VIDEO_RECORDING' },
  options: []
};
const fileAnswer = {
  type: 'FILE_UPLOAD',
  assetId: 'asset-file-a',
  fileKey: 'exercise-files/org-a/course-a/exercise-a/4/member-a/answer.pdf',
  fileName: 'answer.pdf',
  mimeType: 'application/pdf',
  size: 2_048
} as const;
const fileQuestion = {
  ...question,
  id: 4,
  title: 'Upload your answer',
  questionTypeId: 8,
  settings: { acceptedTypes: ['application/pdf'], maxSizeMb: 5 },
  questionType: { id: 8, typename: 'FILE_UPLOAD' },
  options: []
};
const manualQuestion = {
  ...question,
  id: 3,
  title: 'Explain your answer',
  questionTypeId: 3,
  points: 3,
  settings: { minCharacters: 3 },
  questionType: { id: 3, typename: 'TEXTAREA' },
  options: []
};
const numericQuestion = {
  ...question,
  id: 5,
  title: 'Enter the answer',
  questionTypeId: 6,
  points: 4,
  settings: { correctValue: 42, tolerance: 0 },
  questionType: { id: 6, typename: 'NUMERIC' },
  options: []
};
const compositeQuestion = {
  ...question,
  id: 6,
  title: 'Composite item',
  questionTypeId: 16,
  points: 4,
  settings: { required: false },
  questionType: { id: 16, typename: 'ASSESSMENT_ITEM' },
  options: []
};
const persistedUnsupportedCompositeQuestion = {
  ...compositeQuestion,
  id: 7,
  title: 'Persisted unsupported composite item'
};

/** Minimal structurally-valid canonical definition with one auto-gradable interaction. */
const autoChoiceDefinition = {
  schemaVersion: 1,
  blocks: [
    {
      id: 'block-1',
      kind: 'interaction',
      interaction: {
        kind: 'choice',
        prompt: { format: 'html', html: 'Choose one' },
        required: true,
        maxScore: 3,
        config: {
          cardinality: 'single',
          presentation: 'list',
          options: [{ id: 'option-1', html: 'Correct' }],
          correctOptionIds: ['option-1']
        }
      }
    }
  ],
  feedback: []
};

/** Minimal structurally-valid canonical definition with one manually graded interaction. */
const manualTextDefinition = {
  schemaVersion: 1,
  blocks: [
    {
      id: 'block-1',
      kind: 'interaction',
      interaction: {
        kind: 'text',
        prompt: { format: 'html', html: 'Explain your answer' },
        required: true,
        maxScore: 3,
        config: { format: 'plain' }
      }
    }
  ],
  feedback: []
};

const hybridCompositeDefinition = {
  ...autoChoiceDefinition,
  blocks: [autoChoiceDefinition.blocks[0], { ...manualTextDefinition.blocks[0], id: 'block-2' }]
};

const trueFalseGroupDefinition = {
  schemaVersion: 1,
  blocks: [
    {
      id: 'block-1',
      kind: 'interaction',
      interaction: {
        kind: 'true_false_group',
        prompt: { format: 'html', html: 'Mark each statement' },
        required: true,
        maxScore: 4,
        config: {
          statements: [
            { id: 'statement-1', html: 'First', correctValue: true },
            { id: 'statement-2', html: 'Second', correctValue: false },
            { id: 'statement-3', html: 'Third', correctValue: true },
            { id: 'statement-4', html: 'Fourth', correctValue: false }
          ],
          scoring: { mode: 'tiered', tiers: [0, 0.1, 0.25, 0.5, 1] }
        }
      }
    }
  ],
  feedback: []
};

const unsupportedHybridDefinition = {
  schemaVersion: 1,
  blocks: [
    {
      id: 'block-1',
      kind: 'interaction',
      interaction: {
        kind: 'numeric',
        prompt: { format: 'html', html: 'Enter the number' },
        required: true,
        maxScore: 3,
        config: { correctValue: 42, tolerance: 0 }
      }
    },
    { ...manualTextDefinition.blocks[0], id: 'block-2' }
  ],
  feedback: []
};

describe('createSubmissionService transaction guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(
      async (callback: (dbClient: object) => Promise<unknown>) => await callback({ transaction: 'test' })
    );
    // Deterministic per-question revision so linkage can be asserted anywhere.
    questionRevisionGatewayMocks.materializeLegacyQuestionRevision.mockImplementation(async (questionId: number) => ({
      id: `revision-${questionId}`,
      questionId,
      revision: 1,
      contentHash: `hash-${questionId}`
    }));
    // Every materialized revision id resolves to a stored definition by
    // default (a lookup miss is a hard 500, pinned below). The RADIO question
    // maps to an auto-gradable definition, everything else to a manual one.
    mocks.getQuestionRevisionsByIds.mockImplementation(async (revisionIds: string[]) =>
      revisionIds.map((revisionId) => {
        const trailingQuestionId = Number(/(\d+)$/.exec(revisionId)?.[1] ?? Number.NaN);
        return {
          id: revisionId,
          questionId: trailingQuestionId,
          definition: trailingQuestionId === question.id ? autoChoiceDefinition : manualTextDefinition
        };
      })
    );
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: {
        id: exerciseId,
        courseId,
        allowMultipleAttempts: true,
        assignmentMode: 'ALL_STUDENTS'
      },
      questions: [question]
    });
    mocks.resolveGroupMemberExerciseAccess.mockResolvedValue({
      groupMemberId: submittedBy,
      roleId: 3,
      hasAccess: true
    });
    mocks.buildEmailBranding.mockReturnValue({ name: 'Organization' });
    mocks.buildEmailFromName.mockReturnValue('Organization (via ClassroomHub)');
    mocks.enqueueTransactionalEmail.mockResolvedValue(undefined);
    mocks.evaluateCourseCertification.mockResolvedValue(undefined);
    mocks.getCourseById.mockResolvedValue(null);
    mocks.getCourseTeachers.mockResolvedValue([]);
    mocks.getCourseWithOrgData.mockResolvedValue(null);
    mocks.getDashboardBaseUrl.mockReturnValue('https://org.example.com');
    mocks.getExerciseById.mockResolvedValue(null);
    mocks.getProfileByGroupMemberId.mockResolvedValue(null);
    mocks.syncComplianceProgressFromSubmission.mockResolvedValue(undefined);
  });

  it('rejects duplicate answer payloads before creating a submission row', async () => {
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);

    await expect(
      createSubmissionService(
        courseId,
        exerciseId,
        submittedBy,
        [
          { questionId: 1, optionId: 11 },
          { questionId: 1, optionId: 11 }
        ],
        '019cdef0-1234-7abc-8def-1234567890ab'
      )
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 });
    expect(mocks.createSubmission).not.toHaveBeenCalled();
    expect(mocks.insertQuestionAnswersBatch).not.toHaveBeenCalled();
    // Payload validation precedes materialization, so an invalid submission
    // leaves no revision writes behind to roll back.
    expect(questionRevisionGatewayMocks.materializeLegacyQuestionRevision).not.toHaveBeenCalled();
  });

  it('rejects an oversized aggregate canonical payload before opening a transaction', async () => {
    const oversizedAnswers = Array.from({ length: 11 }, (_, index) => ({
      questionId: index + 1,
      response: {
        schemaVersion: 1 as const,
        responses: [
          {
            interactionId: `text-${index}`,
            response: { kind: 'text' as const, text: 'x'.repeat(100_000) }
          }
        ]
      }
    }));

    await expect(createSubmissionService(courseId, exerciseId, submittedBy, oversizedAnswers)).rejects.toMatchObject({
      code: ErrorCodes.VALIDATION_ERROR,
      statusCode: 400
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('returns an existing keyed attempt without writing or re-running grading', async () => {
    const existingSubmission = {
      id: 'submission-a',
      courseId,
      exerciseId,
      submittedBy,
      overallStatus: 'auto_graded',
      gradingState: 'completed',
      statusId: 3,
      score: 2,
      total: 2
    };
    const existingAnswers = [
      {
        id: 1,
        submissionId: existingSubmission.id,
        questionId: 1,
        groupMemberId: submittedBy,
        answerData: { type: 'RADIO', optionId: 11 },
        score: 2,
        point: 2
      }
    ];
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(existingSubmission);
    mocks.getQuestionAnswersBySubmissionId.mockResolvedValue(existingAnswers);

    await expect(
      createSubmissionService(
        courseId,
        exerciseId,
        submittedBy,
        [{ questionId: 1, optionId: 11 }],
        '019cdef0-1234-7abc-8def-1234567890ab'
      )
    ).resolves.toMatchObject({ id: existingSubmission.id, answers: existingAnswers });
    expect(mocks.createSubmission).not.toHaveBeenCalled();
    expect(mocks.insertQuestionAnswersBatch).not.toHaveBeenCalled();
    expect(mocks.updateSubmissionGrades).not.toHaveBeenCalled();
  });

  it('returns the committed submission when a post-commit compliance sync fails', async () => {
    const createdSubmission = {
      id: 'submission-new',
      courseId,
      exerciseId,
      submittedBy,
      overallStatus: 'auto_graded',
      gradingState: 'completed',
      statusId: 3,
      score: 0,
      total: 0
    };
    const gradedSubmission = { ...createdSubmission, score: 2, total: 2 };
    const insertedAnswers = [
      {
        id: 1,
        submissionId: createdSubmission.id,
        questionId: 1,
        groupMemberId: submittedBy,
        answerData: { type: 'RADIO', optionId: 11 },
        score: 0,
        point: 0
      }
    ];
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);
    mocks.createSubmission.mockResolvedValue(createdSubmission);
    mocks.insertQuestionAnswersBatch.mockResolvedValue(insertedAnswers);
    mocks.updateSubmissionGrades.mockResolvedValue(gradedSubmission);
    mocks.syncComplianceProgressFromSubmission.mockRejectedValue(new Error('compliance unavailable'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      createSubmissionService(
        courseId,
        exerciseId,
        submittedBy,
        [{ questionId: 1, optionId: 11 }],
        '019cdef0-1234-7abc-8def-1234567890ab'
      )
    ).resolves.toMatchObject({ id: createdSubmission.id, score: 2 });
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to sync compliance after exercise submission:',
        expect.any(Error)
      );
    });
    consoleError.mockRestore();
  });

  it('uses the committed submission id to deduplicate each attempt email independently', async () => {
    const createdSubmission = {
      id: 'submission-email',
      courseId,
      exerciseId,
      submittedBy,
      overallStatus: 'auto_graded',
      gradingState: 'completed',
      statusId: 3,
      score: 0,
      total: 0
    };
    const insertedAnswer = {
      id: 1,
      submissionId: createdSubmission.id,
      questionId: question.id,
      groupMemberId: submittedBy,
      answerData: { type: 'RADIO', optionId: 11 },
      score: 0,
      point: 0
    };
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);
    mocks.createSubmission.mockResolvedValue(createdSubmission);
    mocks.insertQuestionAnswersBatch.mockResolvedValue([insertedAnswer]);
    mocks.updateSubmissionGrades.mockResolvedValue({ ...createdSubmission, score: 2, total: 2 });
    mocks.getCourseById.mockResolvedValue([{ id: courseId }]);
    mocks.getExerciseById.mockResolvedValue({ id: exerciseId, title: 'Assessment' });
    mocks.getProfileByGroupMemberId.mockResolvedValue({
      id: 'profile-a',
      fullname: 'Student',
      username: 'student'
    });
    mocks.getCourseTeachers.mockResolvedValue([{ email: 'teacher@example.com' }]);
    mocks.getCourseWithOrgData.mockResolvedValue({
      orgId: 'org-a',
      orgName: 'Organization',
      orgSiteName: 'organization',
      orgCustomDomain: null,
      orgIsCustomDomainVerified: false,
      orgAvatarUrl: null,
      orgTheme: null
    });

    await createSubmissionService(
      courseId,
      exerciseId,
      submittedBy,
      [{ questionId: question.id, optionId: 11 }],
      '019cdef0-1234-7abc-8def-1234567890b0'
    );

    await vi.waitFor(() => {
      expect(mocks.enqueueTransactionalEmail).toHaveBeenCalledWith(
        'submissionReceived',
        expect.objectContaining({
          idempotencyKey: `exercise-submitted:${courseId}:${exerciseId}:${submittedBy}:${createdSubmission.id}`
        })
      );
    });
  });

  it('auto-scores objective answers while a hybrid submission awaits manual grading', async () => {
    const createdSubmission = {
      id: 'submission-hybrid',
      courseId,
      exerciseId,
      submittedBy,
      overallStatus: 'hybrid',
      gradingState: 'awaiting_manual',
      statusId: 2,
      score: 0,
      total: 0
    };
    const insertedAnswers = [
      {
        id: 1,
        submissionId: createdSubmission.id,
        questionId: question.id,
        groupMemberId: submittedBy,
        answerData: { type: 'RADIO', optionId: 11 },
        score: 0,
        point: 0
      },
      {
        id: 2,
        submissionId: createdSubmission.id,
        questionId: manualQuestion.id,
        groupMemberId: submittedBy,
        answerData: { type: 'TEXTAREA', text: 'Detailed answer' },
        score: 0,
        point: 0
      }
    ];
    const gradedSubmission = { ...createdSubmission, score: 2, total: 2 };
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: {
        id: exerciseId,
        courseId,
        allowMultipleAttempts: true,
        assignmentMode: 'ALL_STUDENTS'
      },
      questions: [question, manualQuestion]
    });
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);
    mocks.createSubmission.mockResolvedValue(createdSubmission);
    mocks.insertQuestionAnswersBatch.mockResolvedValue(insertedAnswers);
    mocks.updateSubmissionGrades.mockResolvedValue(gradedSubmission);

    await expect(
      createSubmissionService(
        courseId,
        exerciseId,
        submittedBy,
        [
          { questionId: question.id, optionId: 11 },
          { questionId: manualQuestion.id, answer: 'Detailed answer' }
        ],
        '019cdef0-1234-7abc-8def-1234567890ae'
      )
    ).resolves.toMatchObject({
      id: createdSubmission.id,
      gradingState: 'awaiting_manual',
      overallStatus: 'hybrid',
      score: 2
    });
    expect(mocks.updateSubmissionGrades).toHaveBeenCalledWith(
      courseId,
      createdSubmission.id,
      expect.objectContaining({
        answers: [
          { questionId: question.id, points: 2 },
          { questionId: manualQuestion.id, points: 0 }
        ],
        gradingState: 'awaiting_manual',
        total: 2
      }),
      expect.any(Object)
    );
  });

  it('auto-scores a legacy numeric question after materializing its revision', async () => {
    const createdSubmission = {
      id: 'submission-legacy-numeric',
      courseId,
      exerciseId,
      submittedBy,
      overallStatus: 'auto_graded',
      gradingState: 'completed',
      statusId: 3,
      score: 0,
      total: 0
    };
    const insertedAnswer = {
      id: 5,
      submissionId: createdSubmission.id,
      questionId: numericQuestion.id,
      groupMemberId: submittedBy,
      answerData: { type: 'NUMERIC', value: 42 },
      score: 0,
      point: 0
    };
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: {
        id: exerciseId,
        courseId,
        allowMultipleAttempts: true,
        assignmentMode: 'ALL_STUDENTS'
      },
      questions: [numericQuestion]
    });
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);
    mocks.createSubmission.mockResolvedValue(createdSubmission);
    mocks.insertQuestionAnswersBatch.mockResolvedValue([insertedAnswer]);
    mocks.updateSubmissionGrades.mockResolvedValue({ ...createdSubmission, score: 4, total: 4 });

    await expect(
      createSubmissionService(
        courseId,
        exerciseId,
        submittedBy,
        [{ questionId: numericQuestion.id, answer: JSON.stringify({ type: 'NUMERIC', value: 42 }) }],
        '019cdef0-1234-7abc-8def-1234567890c0'
      )
    ).resolves.toMatchObject({
      id: createdSubmission.id,
      overallStatus: 'auto_graded',
      gradingState: 'completed',
      score: 4
    });
    expect(questionRevisionGatewayMocks.materializeLegacyQuestionRevision).toHaveBeenCalledWith(
      numericQuestion.id,
      expect.any(Object)
    );
    expect(mocks.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ overallStatus: 'auto_graded', gradingState: 'completed' }),
      expect.any(Object)
    );
    expect(mocks.updateSubmissionGrades).toHaveBeenCalledWith(
      courseId,
      createdSubmission.id,
      expect.objectContaining({
        answers: [{ questionId: numericQuestion.id, points: 4 }],
        gradingState: 'completed',
        total: 4
      }),
      expect.any(Object)
    );
  });

  it('auto-scores the objective interaction inside one hybrid composite item', async () => {
    const createdSubmission = {
      id: 'submission-composite-hybrid',
      courseId,
      exerciseId,
      submittedBy,
      overallStatus: 'hybrid',
      gradingState: 'awaiting_manual',
      statusId: 2,
      score: 0,
      total: 0
    };
    const answerData = {
      type: 'ASSESSMENT_ITEM',
      response: {
        schemaVersion: 1,
        responses: [
          { interactionId: 'block-1', response: { kind: 'choice', selectedOptionIds: ['option-1'] } },
          { interactionId: 'block-2', response: { kind: 'text', text: 'Detailed answer' } }
        ]
      }
    };
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: {
        id: exerciseId,
        courseId,
        allowMultipleAttempts: true,
        assignmentMode: 'ALL_STUDENTS'
      },
      questions: [compositeQuestion]
    });
    mocks.getCurrentQuestionRevision.mockResolvedValue({
      id: `revision-${compositeQuestion.id}`,
      questionId: compositeQuestion.id,
      revision: 1,
      definition: hybridCompositeDefinition
    });
    mocks.getQuestionRevisionsByIds.mockResolvedValue([
      {
        id: `revision-${compositeQuestion.id}`,
        questionId: compositeQuestion.id,
        definition: hybridCompositeDefinition
      }
    ]);
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);
    mocks.createSubmission.mockResolvedValue(createdSubmission);
    mocks.insertQuestionAnswersBatch.mockResolvedValue([
      {
        id: 1,
        submissionId: createdSubmission.id,
        questionId: compositeQuestion.id,
        groupMemberId: submittedBy,
        answerData,
        score: 0,
        point: 0
      }
    ]);
    mocks.updateSubmissionGrades.mockResolvedValue({ ...createdSubmission, score: 3, total: 3 });

    await expect(
      createSubmissionService(
        courseId,
        exerciseId,
        submittedBy,
        [
          {
            questionId: compositeQuestion.id,
            questionRevisionId: `revision-${compositeQuestion.id}`,
            response: answerData.response
          }
        ],
        '019cdef0-1234-7abc-8def-1234567890af'
      )
    ).resolves.toMatchObject({ overallStatus: 'hybrid', gradingState: 'awaiting_manual', score: 3 });
    expect(mocks.updateSubmissionGrades).toHaveBeenCalledWith(
      courseId,
      createdSubmission.id,
      expect.objectContaining({
        answers: [{ questionId: compositeQuestion.id, points: 3 }],
        gradingState: 'awaiting_manual',
        total: 3
      }),
      expect.any(Object)
    );
  });

  it('auto-scores a tiered true-false group against its attempted revision', async () => {
    const createdSubmission = {
      id: 'submission-true-false-group',
      courseId,
      exerciseId,
      submittedBy,
      overallStatus: 'auto_graded',
      gradingState: 'completed',
      statusId: 3,
      score: 0,
      total: 0
    };
    const response = {
      schemaVersion: 1,
      responses: [
        {
          interactionId: 'block-1',
          response: {
            kind: 'true_false_group',
            answers: [
              { statementId: 'statement-1', value: true },
              { statementId: 'statement-2', value: false },
              { statementId: 'statement-3', value: true },
              { statementId: 'statement-4', value: true }
            ]
          }
        }
      ]
    };
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: {
        id: exerciseId,
        courseId,
        allowMultipleAttempts: true,
        assignmentMode: 'ALL_STUDENTS'
      },
      questions: [compositeQuestion]
    });
    mocks.getCurrentQuestionRevision.mockResolvedValue({
      id: `revision-${compositeQuestion.id}`,
      questionId: compositeQuestion.id,
      revision: 1,
      definition: trueFalseGroupDefinition
    });
    mocks.getQuestionRevisionsByIds.mockResolvedValue([
      {
        id: `revision-${compositeQuestion.id}`,
        questionId: compositeQuestion.id,
        definition: trueFalseGroupDefinition
      }
    ]);
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);
    mocks.createSubmission.mockResolvedValue(createdSubmission);
    mocks.insertQuestionAnswersBatch.mockResolvedValue([
      {
        id: 1,
        submissionId: createdSubmission.id,
        questionId: compositeQuestion.id,
        groupMemberId: submittedBy,
        answerData: { type: 'ASSESSMENT_ITEM', response },
        score: 0,
        point: 0
      }
    ]);
    mocks.updateSubmissionGrades.mockResolvedValue({ ...createdSubmission, score: 2, total: 2 });

    await expect(
      createSubmissionService(
        courseId,
        exerciseId,
        submittedBy,
        [
          {
            questionId: compositeQuestion.id,
            questionRevisionId: `revision-${compositeQuestion.id}`,
            response
          }
        ],
        '019cdef0-1234-7abc-8def-1234567890b2'
      )
    ).resolves.toMatchObject({ overallStatus: 'auto_graded', gradingState: 'completed', score: 2, total: 2 });
    expect(mocks.updateSubmissionGrades).toHaveBeenCalledWith(
      courseId,
      createdSubmission.id,
      expect.objectContaining({
        answers: [{ questionId: compositeQuestion.id, points: 2 }],
        gradingState: 'completed',
        total: 2
      }),
      expect.any(Object)
    );
  });

  it('rejects a canonical response when the delivered revision is no longer current', async () => {
    const deliveredRevisionId = '00000000-0000-4000-8000-000000000006';
    const currentRevisionId = '00000000-0000-4000-8000-000000000106';
    const response = {
      schemaVersion: 1 as const,
      responses: [{ interactionId: 'block-1', response: { kind: 'choice' as const, selectedOptionIds: ['option-1'] } }]
    };
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: {
        id: exerciseId,
        courseId,
        allowMultipleAttempts: true,
        assignmentMode: 'ALL_STUDENTS'
      },
      questions: [compositeQuestion]
    });
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);
    mocks.getCurrentQuestionRevision.mockResolvedValue({
      id: currentRevisionId,
      questionId: compositeQuestion.id,
      revision: 2,
      definition: autoChoiceDefinition
    });
    mocks.getQuestionRevisionsByIds.mockResolvedValue([
      {
        id: currentRevisionId,
        questionId: compositeQuestion.id,
        definition: autoChoiceDefinition
      }
    ]);
    mocks.createSubmission.mockResolvedValue({
      id: 'submission-stale-revision',
      courseId,
      exerciseId,
      submittedBy,
      overallStatus: 'auto_graded',
      gradingState: 'completed',
      statusId: 3,
      score: 0,
      total: 0
    });
    mocks.insertQuestionAnswersBatch.mockResolvedValue([]);

    await expect(
      createSubmissionService(
        courseId,
        exerciseId,
        submittedBy,
        [{ questionId: compositeQuestion.id, questionRevisionId: deliveredRevisionId, response }],
        '019cdef0-1234-7abc-8def-1234567890bf'
      )
    ).rejects.toMatchObject({ code: ErrorCodes.CONFLICT, statusCode: 409 });
    expect(mocks.createSubmission).not.toHaveBeenCalled();
    expect(mocks.insertQuestionAnswersBatch).not.toHaveBeenCalled();
  });

  it('keeps a persisted composite with unsupported scoring semantics in manual grading', async () => {
    const createdSubmission = {
      id: 'submission-unsupported-hybrid',
      courseId,
      exerciseId,
      submittedBy,
      overallStatus: 'manual_required',
      gradingState: 'awaiting_manual',
      statusId: 2,
      score: 0,
      total: 0
    };
    const response = {
      schemaVersion: 1,
      responses: [
        { interactionId: 'block-1', response: { kind: 'numeric', value: 42 } },
        { interactionId: 'block-2', response: { kind: 'text', text: 'Detailed answer' } }
      ]
    };
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: {
        id: exerciseId,
        courseId,
        allowMultipleAttempts: true,
        assignmentMode: 'ALL_STUDENTS'
      },
      questions: [compositeQuestion]
    });
    mocks.getCurrentQuestionRevision.mockResolvedValue({
      id: `revision-${compositeQuestion.id}`,
      questionId: compositeQuestion.id,
      revision: 1,
      definition: unsupportedHybridDefinition
    });
    mocks.getQuestionRevisionsByIds.mockResolvedValue([
      {
        id: `revision-${compositeQuestion.id}`,
        questionId: compositeQuestion.id,
        definition: unsupportedHybridDefinition
      }
    ]);
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);
    mocks.createSubmission.mockResolvedValue(createdSubmission);
    mocks.insertQuestionAnswersBatch.mockResolvedValue([
      {
        id: 1,
        submissionId: createdSubmission.id,
        questionId: compositeQuestion.id,
        groupMemberId: submittedBy,
        answerData: { type: 'ASSESSMENT_ITEM', response },
        score: 0,
        point: 0
      }
    ]);

    await expect(
      createSubmissionService(
        courseId,
        exerciseId,
        submittedBy,
        [
          {
            questionId: compositeQuestion.id,
            questionRevisionId: `revision-${compositeQuestion.id}`,
            response
          }
        ],
        '019cdef0-1234-7abc-8def-1234567890b0'
      )
    ).resolves.toMatchObject({ overallStatus: 'manual_required', gradingState: 'awaiting_manual', score: 0 });
    expect(mocks.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ overallStatus: 'manual_required', gradingState: 'awaiting_manual' }),
      expect.any(Object)
    );
    expect(mocks.updateSubmissionGrades).not.toHaveBeenCalled();
  });

  it('scores supported canonical items while keeping an unsupported persisted item manual', async () => {
    const createdSubmission = {
      id: 'submission-mixed-canonical-support',
      courseId,
      exerciseId,
      submittedBy,
      overallStatus: 'hybrid',
      gradingState: 'awaiting_manual',
      statusId: 2,
      score: 0,
      total: 0
    };
    const supportedResponse = {
      schemaVersion: 1,
      responses: [{ interactionId: 'block-1', response: { kind: 'choice', selectedOptionIds: ['option-1'] } }]
    };
    const unsupportedResponse = {
      schemaVersion: 1,
      responses: [
        { interactionId: 'block-1', response: { kind: 'numeric', value: 42 } },
        { interactionId: 'block-2', response: { kind: 'text', text: 'Detailed answer' } }
      ]
    };
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: {
        id: exerciseId,
        courseId,
        allowMultipleAttempts: true,
        assignmentMode: 'ALL_STUDENTS'
      },
      questions: [compositeQuestion, persistedUnsupportedCompositeQuestion]
    });
    mocks.getCurrentQuestionRevision
      .mockResolvedValueOnce({
        id: `revision-${compositeQuestion.id}`,
        questionId: compositeQuestion.id,
        revision: 1,
        definition: autoChoiceDefinition
      })
      .mockResolvedValueOnce({
        id: `revision-${persistedUnsupportedCompositeQuestion.id}`,
        questionId: persistedUnsupportedCompositeQuestion.id,
        revision: 1,
        definition: unsupportedHybridDefinition
      });
    mocks.getQuestionRevisionsByIds.mockResolvedValue([
      {
        id: `revision-${compositeQuestion.id}`,
        questionId: compositeQuestion.id,
        definition: autoChoiceDefinition
      },
      {
        id: `revision-${persistedUnsupportedCompositeQuestion.id}`,
        questionId: persistedUnsupportedCompositeQuestion.id,
        definition: unsupportedHybridDefinition
      }
    ]);
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);
    mocks.createSubmission.mockResolvedValue(createdSubmission);
    mocks.insertQuestionAnswersBatch.mockResolvedValue([
      {
        id: 1,
        submissionId: createdSubmission.id,
        questionId: compositeQuestion.id,
        groupMemberId: submittedBy,
        answerData: { type: 'ASSESSMENT_ITEM', response: supportedResponse },
        score: 0,
        point: 0
      },
      {
        id: 2,
        submissionId: createdSubmission.id,
        questionId: persistedUnsupportedCompositeQuestion.id,
        groupMemberId: submittedBy,
        answerData: { type: 'ASSESSMENT_ITEM', response: unsupportedResponse },
        score: 0,
        point: 0
      }
    ]);
    mocks.updateSubmissionGrades.mockResolvedValue({ ...createdSubmission, score: 3, total: 3 });

    await expect(
      createSubmissionService(
        courseId,
        exerciseId,
        submittedBy,
        [
          {
            questionId: compositeQuestion.id,
            questionRevisionId: `revision-${compositeQuestion.id}`,
            response: supportedResponse
          },
          {
            questionId: persistedUnsupportedCompositeQuestion.id,
            questionRevisionId: `revision-${persistedUnsupportedCompositeQuestion.id}`,
            response: unsupportedResponse
          }
        ],
        '019cdef0-1234-7abc-8def-1234567890b1'
      )
    ).resolves.toMatchObject({ overallStatus: 'hybrid', gradingState: 'awaiting_manual', score: 3 });
    expect(mocks.updateSubmissionGrades).toHaveBeenCalledWith(
      courseId,
      createdSubmission.id,
      expect.objectContaining({
        answers: [
          { questionId: compositeQuestion.id, points: 3 },
          { questionId: persistedUnsupportedCompositeQuestion.id, points: 0 }
        ],
        gradingState: 'awaiting_manual',
        total: 3
      }),
      expect.any(Object)
    );
  });

  it('keeps manual grading when legacy question type metadata has no typename', async () => {
    const legacyManualQuestion = {
      ...manualQuestion,
      questionType: { id: 3, typename: null }
    };
    const createdSubmission = {
      id: 'submission-legacy-manual',
      courseId,
      exerciseId,
      submittedBy,
      overallStatus: 'manual_required',
      gradingState: 'awaiting_manual',
      statusId: 2,
      score: 0,
      total: 0
    };
    const insertedAnswer = {
      id: 3,
      submissionId: createdSubmission.id,
      questionId: legacyManualQuestion.id,
      groupMemberId: submittedBy,
      answerData: { type: 'TEXTAREA', text: 'Detailed answer' },
      score: 0,
      point: 0
    };
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: {
        id: exerciseId,
        courseId,
        allowMultipleAttempts: true,
        assignmentMode: 'ALL_STUDENTS'
      },
      questions: [legacyManualQuestion]
    });
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);
    mocks.createSubmission.mockResolvedValue(createdSubmission);
    mocks.insertQuestionAnswersBatch.mockResolvedValue([insertedAnswer]);

    await expect(
      createSubmissionService(
        courseId,
        exerciseId,
        submittedBy,
        [{ questionId: legacyManualQuestion.id, answer: 'Detailed answer' }],
        '019cdef0-1234-7abc-8def-1234567890af'
      )
    ).resolves.toMatchObject({
      id: createdSubmission.id,
      gradingState: 'awaiting_manual',
      overallStatus: 'manual_required',
      statusId: 2
    });
    expect(mocks.updateSubmissionGrades).not.toHaveBeenCalled();
    // The attempted revision's manual definition decides; null typename
    // metadata never enters the derivation and never crashes the request.
    expect(mocks.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ overallStatus: 'manual_required', gradingState: 'awaiting_manual' }),
      expect.any(Object)
    );
  });

  it('creates video asset retention usage inside the submission transaction', async () => {
    const transactionClient = { transaction: 'test' };
    const createdSubmission = {
      id: 'submission-video',
      courseId,
      exerciseId,
      submittedBy,
      overallStatus: 'manual_required',
      gradingState: 'awaiting_manual',
      statusId: 2,
      score: 0,
      total: 0
    };
    const insertedAnswer = {
      id: 2,
      submissionId: createdSubmission.id,
      questionId: videoQuestion.id,
      groupMemberId: submittedBy,
      answerData: videoAnswer,
      score: 0,
      point: 0
    };
    mocks.transaction.mockImplementation(
      async (callback: (dbClient: object) => Promise<unknown>) => await callback(transactionClient)
    );
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: {
        id: exerciseId,
        courseId,
        allowMultipleAttempts: true,
        assignmentMode: 'ALL_STUDENTS'
      },
      questions: [videoQuestion]
    });
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);
    mocks.createSubmission.mockResolvedValue(createdSubmission);
    mocks.insertQuestionAnswersBatch.mockResolvedValue([insertedAnswer]);
    mocks.getCourseOrganizationId.mockResolvedValue('org-a');
    mocks.lockAssetById.mockResolvedValue({
      id: videoAnswer.assetId,
      organizationId: 'org-a',
      status: 'active',
      kind: 'video',
      title: videoAnswer.fileName,
      storageKey: videoAnswer.storageKey,
      mimeType: videoAnswer.mimeType,
      byteSize: videoAnswer.size,
      durationSeconds: videoAnswer.durationSeconds,
      metadata: {
        source: 'exercise_video_recording',
        courseId,
        exerciseId,
        questionId: videoQuestion.id,
        groupMemberId: submittedBy
      }
    });
    mocks.createAssetUsage.mockResolvedValue({ id: 'usage-a' });

    await createSubmissionService(
      courseId,
      exerciseId,
      submittedBy,
      [{ questionId: videoQuestion.id, answer: JSON.stringify(videoAnswer) }],
      '019cdef0-1234-7abc-8def-1234567890ac'
    );

    expect(mocks.lockAssetById).toHaveBeenCalledWith(videoAnswer.assetId, 'org-a', transactionClient);
    expect(mocks.createAssetUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: videoAnswer.assetId,
        targetId: String(insertedAnswer.id),
        targetType: 'submission_answer'
      }),
      transactionClient
    );
  });

  it('fails the submission transaction when a video asset is invalid', async () => {
    const createdSubmission = {
      id: 'submission-video-invalid',
      courseId,
      exerciseId,
      submittedBy,
      overallStatus: 'manual_required',
      gradingState: 'awaiting_manual',
      statusId: 2,
      score: 0,
      total: 0
    };
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: {
        id: exerciseId,
        courseId,
        allowMultipleAttempts: true,
        assignmentMode: 'ALL_STUDENTS'
      },
      questions: [videoQuestion]
    });
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);
    mocks.createSubmission.mockResolvedValue(createdSubmission);
    mocks.insertQuestionAnswersBatch.mockResolvedValue([
      {
        id: 3,
        submissionId: createdSubmission.id,
        questionId: videoQuestion.id,
        groupMemberId: submittedBy,
        answerData: videoAnswer,
        score: 0,
        point: 0
      }
    ]);
    mocks.getCourseOrganizationId.mockResolvedValue('org-a');
    mocks.lockAssetById.mockResolvedValue(null);

    await expect(
      createSubmissionService(
        courseId,
        exerciseId,
        submittedBy,
        [{ questionId: videoQuestion.id, answer: JSON.stringify(videoAnswer) }],
        '019cdef0-1234-7abc-8def-1234567890ad'
      )
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.createAssetUsage).not.toHaveBeenCalled();
  });

  it('creates file asset retention usage inside the submission transaction', async () => {
    const transactionClient = { transaction: 'test' };
    const createdSubmission = {
      id: 'submission-file',
      courseId,
      exerciseId,
      submittedBy,
      overallStatus: 'manual_required',
      gradingState: 'awaiting_manual',
      statusId: 2,
      score: 0,
      total: 0
    };
    const insertedAnswer = {
      id: 4,
      submissionId: createdSubmission.id,
      questionId: fileQuestion.id,
      groupMemberId: submittedBy,
      answerData: fileAnswer,
      score: 0,
      point: 0
    };
    mocks.transaction.mockImplementation(
      async (callback: (dbClient: object) => Promise<unknown>) => await callback(transactionClient)
    );
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: {
        id: exerciseId,
        courseId,
        allowMultipleAttempts: true,
        assignmentMode: 'ALL_STUDENTS'
      },
      questions: [fileQuestion]
    });
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);
    mocks.createSubmission.mockResolvedValue(createdSubmission);
    mocks.insertQuestionAnswersBatch.mockResolvedValue([insertedAnswer]);
    mocks.getCourseOrganizationId.mockResolvedValue('org-a');
    mocks.lockAssetById.mockResolvedValue({
      id: fileAnswer.assetId,
      organizationId: 'org-a',
      status: 'active',
      kind: 'document',
      title: fileAnswer.fileName,
      storageKey: fileAnswer.fileKey,
      mimeType: fileAnswer.mimeType,
      byteSize: fileAnswer.size,
      metadata: {
        source: 'exercise_file_upload',
        courseId,
        exerciseId,
        questionId: fileQuestion.id,
        groupMemberId: submittedBy
      }
    });
    mocks.createAssetUsage.mockResolvedValue({ id: 'usage-file-a' });

    await createSubmissionService(
      courseId,
      exerciseId,
      submittedBy,
      [{ questionId: fileQuestion.id, answer: JSON.stringify(fileAnswer) }],
      '019cdef0-1234-7abc-8def-1234567890b0'
    );

    expect(mocks.lockAssetById).toHaveBeenCalledWith(fileAnswer.assetId, 'org-a', transactionClient);
    expect(mocks.createAssetUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: fileAnswer.assetId,
        slotType: 'file_upload_answer',
        targetId: String(insertedAnswer.id),
        targetType: 'submission_answer'
      }),
      transactionClient
    );
  });

  it('rejects a file answer that does not resolve to its managed asset', async () => {
    const createdSubmission = {
      id: 'submission-file-invalid',
      courseId,
      exerciseId,
      submittedBy,
      overallStatus: 'manual_required',
      gradingState: 'awaiting_manual',
      statusId: 2,
      score: 0,
      total: 0
    };
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: {
        id: exerciseId,
        courseId,
        allowMultipleAttempts: true,
        assignmentMode: 'ALL_STUDENTS'
      },
      questions: [fileQuestion]
    });
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);
    mocks.createSubmission.mockResolvedValue(createdSubmission);
    mocks.insertQuestionAnswersBatch.mockResolvedValue([
      {
        id: 5,
        submissionId: createdSubmission.id,
        questionId: fileQuestion.id,
        groupMemberId: submittedBy,
        answerData: fileAnswer,
        score: 0,
        point: 0
      }
    ]);
    mocks.getCourseOrganizationId.mockResolvedValue('org-a');
    mocks.lockAssetById.mockResolvedValue(null);

    await expect(
      createSubmissionService(
        courseId,
        exerciseId,
        submittedBy,
        [{ questionId: fileQuestion.id, answer: JSON.stringify(fileAnswer) }],
        '019cdef0-1234-7abc-8def-1234567890b1'
      )
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.createAssetUsage).not.toHaveBeenCalled();
  });

  it('links every inserted answer row to the exact materialized question revision', async () => {
    const revisionIdByQuestionId = new Map<number, string>([
      [question.id, 'revision-question-1'],
      [manualQuestion.id, 'revision-question-3']
    ]);
    // Tolerates positional or object-style gateway signatures without pinning one.
    const resolveQuestionIdFromArgs = (args: readonly unknown[]): number | undefined => {
      for (const arg of args) {
        if (typeof arg === 'number' && Number.isSafeInteger(arg)) return arg;
        if (arg && typeof arg === 'object') {
          const candidate = arg as { questionId?: unknown; id?: unknown };
          if (typeof candidate.questionId === 'number') return candidate.questionId;
          if (typeof candidate.id === 'number') return candidate.id;
        }
      }

      return undefined;
    };
    questionRevisionGatewayMocks.materializeLegacyQuestionRevision.mockImplementation(async (...args: unknown[]) => {
      const questionId = resolveQuestionIdFromArgs(args);
      const revisionId = questionId === undefined ? undefined : revisionIdByQuestionId.get(questionId);
      if (questionId === undefined || !revisionId) {
        throw new Error(`Unexpected materialization arguments: ${JSON.stringify(args)}`);
      }

      return { id: revisionId, questionId, revision: 1, contentHash: `hash-${questionId}` };
    });
    const createdSubmission = {
      id: 'submission-revision-link',
      courseId,
      exerciseId,
      submittedBy,
      overallStatus: 'hybrid',
      gradingState: 'awaiting_manual',
      statusId: 2,
      score: 0,
      total: 0
    };
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: {
        id: exerciseId,
        courseId,
        allowMultipleAttempts: true,
        assignmentMode: 'ALL_STUDENTS'
      },
      questions: [question, manualQuestion]
    });
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);
    mocks.createSubmission.mockResolvedValue(createdSubmission);
    mocks.insertQuestionAnswersBatch.mockImplementation(
      async (rows: Array<{ questionId: number; questionRevisionId?: string }>) =>
        rows.map((row, index) => ({ ...row, id: index + 1, score: 0, point: 0 }))
    );
    mocks.updateSubmissionGrades.mockResolvedValue({ ...createdSubmission, score: 2, total: 2 });

    await createSubmissionService(
      courseId,
      exerciseId,
      submittedBy,
      [
        { questionId: question.id, optionId: 11 },
        { questionId: manualQuestion.id, answer: 'Detailed answer' }
      ],
      '019cdef0-1234-7abc-8def-1234567890b2'
    );

    expect(questionRevisionGatewayMocks.materializeLegacyQuestionRevision).toHaveBeenCalledTimes(2);
    const insertedRows = mocks.insertQuestionAnswersBatch.mock.calls[0]?.[0] as
      | Array<{ questionId: number; questionRevisionId?: string }>
      | undefined;
    expect(insertedRows).toBeDefined();
    if (!insertedRows) throw new Error('insertQuestionAnswersBatch was not called with answer rows');

    expect(insertedRows).toHaveLength(2);
    for (const row of insertedRows) {
      expect(row.questionRevisionId).toBe(revisionIdByQuestionId.get(row.questionId));
    }
  });

  it('does not materialize question revisions when replaying a keyed attempt', async () => {
    const existingSubmission = {
      id: 'submission-replay-revision',
      courseId,
      exerciseId,
      submittedBy,
      overallStatus: 'auto_graded',
      gradingState: 'completed',
      statusId: 3,
      score: 2,
      total: 2
    };
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(existingSubmission);
    mocks.getQuestionAnswersBySubmissionId.mockResolvedValue([
      {
        id: 1,
        submissionId: existingSubmission.id,
        questionId: question.id,
        groupMemberId: submittedBy,
        answerData: { type: 'RADIO', optionId: 11 },
        score: 2,
        point: 2
      }
    ]);

    await expect(
      createSubmissionService(
        courseId,
        exerciseId,
        submittedBy,
        [{ questionId: question.id, optionId: 11 }],
        '019cdef0-1234-7abc-8def-1234567890b3'
      )
    ).resolves.toMatchObject({ id: existingSubmission.id });
    // Replay must stay write-free: no revision materialization, no publish,
    // and no answer inserts for an already-stored keyed attempt.
    expect(questionRevisionGatewayMocks.materializeLegacyQuestionRevision).not.toHaveBeenCalled();
    expect(questionRevisionGatewayMocks.publishQuestionRevision).not.toHaveBeenCalled();
    expect(mocks.insertQuestionAnswersBatch).not.toHaveBeenCalled();
  });

  it('requests the active question scope for new attempts', async () => {
    const transactionClient = { transaction: 'test' };
    mocks.transaction.mockImplementation(
      async (callback: (dbClient: object) => Promise<unknown>) => await callback(transactionClient)
    );
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);
    mocks.createSubmission.mockResolvedValue({
      id: 'submission-scope',
      courseId,
      exerciseId,
      submittedBy,
      overallStatus: 'auto_graded',
      gradingState: 'completed',
      statusId: 3,
      score: 0,
      total: 0
    });
    mocks.insertQuestionAnswersBatch.mockResolvedValue([]);
    mocks.updateSubmissionGrades.mockResolvedValue({ id: 'submission-scope', score: 2, total: 2 });

    await createSubmissionService(
      courseId,
      exerciseId,
      submittedBy,
      [{ questionId: question.id, optionId: 11 }],
      '019cdef0-1234-7abc-8def-1234567890b4'
    );

    expect(mocks.getExerciseWithRelationsOptimized).toHaveBeenCalledWith(exerciseId, transactionClient, {
      questionScope: 'active'
    });
  });

  it('rejects a legacy flat submission when the active set contains a composite item', async () => {
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: {
        id: exerciseId,
        courseId,
        allowMultipleAttempts: true,
        assignmentMode: 'ALL_STUDENTS'
      },
      questions: [question, compositeQuestion]
    });
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);

    // The composite item is omitted from the payload on purpose: the request
    // must still fail so hidden composite content cannot be bypassed.
    await expect(
      createSubmissionService(
        courseId,
        exerciseId,
        submittedBy,
        [{ questionId: question.id, optionId: 11 }],
        '019cdef0-1234-7abc-8def-1234567890b5'
      )
    ).rejects.toMatchObject({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 });
    expect(mocks.createSubmission).not.toHaveBeenCalled();
    expect(mocks.insertQuestionAnswersBatch).not.toHaveBeenCalled();
    expect(questionRevisionGatewayMocks.materializeLegacyQuestionRevision).not.toHaveBeenCalled();
  });

  it('inserts an explicit revision-linked empty row for an omitted optional question', async () => {
    const optionalManualQuestion = {
      ...manualQuestion,
      settings: { required: false }
    };
    const createdSubmission = {
      id: 'submission-missing-row',
      courseId,
      exerciseId,
      submittedBy,
      overallStatus: 'hybrid',
      gradingState: 'awaiting_manual',
      statusId: 2,
      score: 0,
      total: 0
    };
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: {
        id: exerciseId,
        courseId,
        allowMultipleAttempts: true,
        assignmentMode: 'ALL_STUDENTS'
      },
      questions: [question, optionalManualQuestion]
    });
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);
    mocks.createSubmission.mockResolvedValue(createdSubmission);
    mocks.insertQuestionAnswersBatch.mockImplementation(
      async (rows: Array<{ questionId: number; questionRevisionId?: string }>) =>
        rows.map((row, index) => ({ ...row, id: index + 1, score: 0, point: 0 }))
    );
    mocks.updateSubmissionGrades.mockResolvedValue({ ...createdSubmission, score: 2, total: 2 });

    await createSubmissionService(
      courseId,
      exerciseId,
      submittedBy,
      [{ questionId: question.id, optionId: 11 }],
      '019cdef0-1234-7abc-8def-1234567890b6'
    );

    const insertedRows = mocks.insertQuestionAnswersBatch.mock.calls[0]?.[0] as
      | Array<{ questionId: number; answerData: unknown; questionRevisionId?: string }>
      | undefined;
    expect(insertedRows).toBeDefined();
    if (!insertedRows) throw new Error('insertQuestionAnswersBatch was not called with answer rows');

    expect(insertedRows).toHaveLength(2);
    const missingRow = insertedRows.find((row) => row.questionId === optionalManualQuestion.id);
    expect(missingRow).toMatchObject({
      answerData: null,
      questionRevisionId: `revision-${optionalManualQuestion.id}`
    });
  });

  it('derives the overall status from the canonical definition instead of static metadata', async () => {
    const createdSubmission = {
      id: 'submission-canonical',
      courseId,
      exerciseId,
      submittedBy,
      overallStatus: 'auto_graded',
      gradingState: 'completed',
      statusId: 3,
      score: 0,
      total: 0
    };
    // Statically ASSESSMENT_ITEM is manual; the attempted revision definition
    // says the item is fully auto-gradable, and the canonical capability wins.
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: {
        id: exerciseId,
        courseId,
        allowMultipleAttempts: true,
        assignmentMode: 'ALL_STUDENTS'
      },
      questions: [compositeQuestion]
    });
    mocks.getCurrentQuestionRevision.mockResolvedValue({
      id: `revision-${compositeQuestion.id}`,
      questionId: compositeQuestion.id,
      revision: 1,
      definition: autoChoiceDefinition
    });
    mocks.getQuestionRevisionsByIds.mockResolvedValue([
      { id: `revision-${compositeQuestion.id}`, questionId: compositeQuestion.id, definition: autoChoiceDefinition }
    ]);
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);
    mocks.createSubmission.mockResolvedValue(createdSubmission);
    mocks.insertQuestionAnswersBatch.mockResolvedValue([]);
    mocks.updateSubmissionGrades.mockResolvedValue(createdSubmission);

    await createSubmissionService(
      courseId,
      exerciseId,
      submittedBy,
      [
        {
          questionId: compositeQuestion.id,
          questionRevisionId: `revision-${compositeQuestion.id}`,
          response: {
            schemaVersion: 1,
            responses: [
              {
                interactionId: 'block-1',
                response: { kind: 'choice', selectedOptionIds: ['option-1'] }
              }
            ]
          }
        }
      ],
      '019cdef0-1234-7abc-8def-1234567890b7'
    );

    expect(mocks.createSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ overallStatus: 'auto_graded', gradingState: 'completed' }),
      expect.any(Object)
    );
  });

  it('rejects a submission with zero writes when the exercise has no active questions', async () => {
    // Every question archived: nothing is attemptable, so an empty payload
    // must not produce an empty auto-completed submission.
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: {
        id: exerciseId,
        courseId,
        allowMultipleAttempts: true,
        assignmentMode: 'ALL_STUDENTS'
      },
      questions: []
    });
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);

    await expect(
      createSubmissionService(courseId, exerciseId, submittedBy, [], '019cdef0-1234-7abc-8def-1234567890b8')
    ).rejects.toMatchObject({ code: ErrorCodes.CONFLICT, statusCode: 409 });
    expect(questionRevisionGatewayMocks.materializeLegacyQuestionRevision).not.toHaveBeenCalled();
    expect(mocks.createSubmission).not.toHaveBeenCalled();
    expect(mocks.insertQuestionAnswersBatch).not.toHaveBeenCalled();
    expect(mocks.updateSubmissionGrades).not.toHaveBeenCalled();
    expect(mocks.createAssetUsage).not.toHaveBeenCalled();
  });

  it('fails 500 before any write when a materialized revision misses from the batch lookup', async () => {
    // The revision was just materialized inside this transaction, so a batch
    // lookup miss is an integrity failure — never a static capability fallback.
    mocks.getQuestionRevisionsByIds.mockResolvedValue([]);
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);

    await expect(
      createSubmissionService(
        courseId,
        exerciseId,
        submittedBy,
        [{ questionId: question.id, optionId: 11 }],
        '019cdef0-1234-7abc-8def-1234567890b9'
      )
    ).rejects.toMatchObject({ code: ErrorCodes.INTERNAL_ERROR, statusCode: 500 });
    expect(mocks.createSubmission).not.toHaveBeenCalled();
    expect(mocks.insertQuestionAnswersBatch).not.toHaveBeenCalled();
  });

  it('rejects a file answer whose display fileName differs from the locked asset title', async () => {
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: {
        id: exerciseId,
        courseId,
        allowMultipleAttempts: true,
        assignmentMode: 'ALL_STUDENTS'
      },
      questions: [fileQuestion]
    });
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);
    mocks.createSubmission.mockResolvedValue({
      id: 'submission-file-spoofed-name',
      courseId,
      exerciseId,
      submittedBy,
      overallStatus: 'manual_required',
      gradingState: 'awaiting_manual',
      statusId: 2,
      score: 0,
      total: 0
    });
    mocks.insertQuestionAnswersBatch.mockResolvedValue([
      {
        id: 6,
        submissionId: 'submission-file-spoofed-name',
        questionId: fileQuestion.id,
        groupMemberId: submittedBy,
        answerData: { ...fileAnswer, fileName: 'answer-key-approved.pdf' },
        score: 0,
        point: 0
      }
    ]);
    mocks.getCourseOrganizationId.mockResolvedValue('org-a');
    // The locked asset row is fully valid except for the display name pin.
    mocks.lockAssetById.mockResolvedValue({
      id: fileAnswer.assetId,
      organizationId: 'org-a',
      status: 'active',
      kind: 'document',
      title: fileAnswer.fileName,
      storageKey: fileAnswer.fileKey,
      mimeType: fileAnswer.mimeType,
      byteSize: fileAnswer.size,
      metadata: {
        source: 'exercise_file_upload',
        courseId,
        exerciseId,
        questionId: fileQuestion.id,
        groupMemberId: submittedBy
      }
    });

    await expect(
      createSubmissionService(
        courseId,
        exerciseId,
        submittedBy,
        [
          {
            questionId: fileQuestion.id,
            answer: JSON.stringify({ ...fileAnswer, fileName: 'answer-key-approved.pdf' })
          }
        ],
        '019cdef0-1234-7abc-8def-1234567890ba'
      )
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.createAssetUsage).not.toHaveBeenCalled();
  });

  it('rejects a video answer whose display fileName differs from the locked asset title', async () => {
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: {
        id: exerciseId,
        courseId,
        allowMultipleAttempts: true,
        assignmentMode: 'ALL_STUDENTS'
      },
      questions: [videoQuestion]
    });
    mocks.getSubmissionByIdempotencyKey.mockResolvedValue(null);
    mocks.createSubmission.mockResolvedValue({
      id: 'submission-video-spoofed-name',
      courseId,
      exerciseId,
      submittedBy,
      overallStatus: 'manual_required',
      gradingState: 'awaiting_manual',
      statusId: 2,
      score: 0,
      total: 0
    });
    mocks.insertQuestionAnswersBatch.mockResolvedValue([
      {
        id: 7,
        submissionId: 'submission-video-spoofed-name',
        questionId: videoQuestion.id,
        groupMemberId: submittedBy,
        answerData: { ...videoAnswer, fileName: 'graded-reference.webm' },
        score: 0,
        point: 0
      }
    ]);
    mocks.getCourseOrganizationId.mockResolvedValue('org-a');
    mocks.lockAssetById.mockResolvedValue({
      id: videoAnswer.assetId,
      organizationId: 'org-a',
      status: 'active',
      kind: 'video',
      title: videoAnswer.fileName,
      storageKey: videoAnswer.storageKey,
      mimeType: videoAnswer.mimeType,
      byteSize: videoAnswer.size,
      durationSeconds: videoAnswer.durationSeconds,
      metadata: {
        source: 'exercise_video_recording',
        courseId,
        exerciseId,
        questionId: videoQuestion.id,
        groupMemberId: submittedBy
      }
    });

    await expect(
      createSubmissionService(
        courseId,
        exerciseId,
        submittedBy,
        [
          {
            questionId: videoQuestion.id,
            answer: JSON.stringify({ ...videoAnswer, fileName: 'graded-reference.webm' })
          }
        ],
        '019cdef0-1234-7abc-8def-1234567890bb'
      )
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.createAssetUsage).not.toHaveBeenCalled();
  });
});
