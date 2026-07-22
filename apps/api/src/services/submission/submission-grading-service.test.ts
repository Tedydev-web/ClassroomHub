import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createNotification: vi.fn(),
  enqueueTransactionalEmail: vi.fn(),
  evaluateCourseCertification: vi.fn(),
  getCourseById: vi.fn(),
  getCourseWithOrgData: vi.fn(),
  getExerciseById: vi.fn(),
  getExerciseWithRelationsOptimized: vi.fn(),
  getProfileByGroupMemberId: vi.fn(),
  getQuestionAnswersBySubmissionId: vi.fn(),
  getQuestionRevisionsByIds: vi.fn(),
  getSubmissionById: vi.fn(),
  getSubmissionsByCourseIdWithDetails: vi.fn(),
  getSubmissionsForGrading: vi.fn(),
  getCourseSubmissionOrThrow: vi.fn(),
  lockCourseSubmissionOrThrow: vi.fn(),
  lockExerciseAssignmentState: vi.fn(),
  syncComplianceProgressFromSubmission: vi.fn(),
  transaction: vi.fn(),
  updateSubmission: vi.fn(),
  updateSubmissionGrades: vi.fn(),
  isExerciseCompletedForMember: vi.fn()
}));

/**
 * The grading paths resolve the attempted question set (archived questions
 * included) through the assessment gateway; capability and maximum always come
 * from the exact attempted revision, never from the live question row.
 */
const questionRevisionGatewayMocks = vi.hoisted(() => ({
  materializeLegacyQuestionRevision: vi.fn(),
  publishQuestionRevision: vi.fn(),
  resolveAttemptedQuestionSet: vi.fn()
}));

vi.mock('@cio/core/services/assessment/question-revision', () => questionRevisionGatewayMocks);

vi.mock('@cio/db/drizzle', () => ({ db: { transaction: mocks.transaction } }));
vi.mock('@cio/db/queries/submission', () => ({
  createSubmission: vi.fn(),
  deleteSubmission: vi.fn(),
  getQuestionAnswersBySubmissionId: mocks.getQuestionAnswersBySubmissionId,
  getSubmissionById: mocks.getSubmissionById,
  getSubmissionByIdempotencyKey: vi.fn(),
  getSubmissionsByCourseIdWithDetails: mocks.getSubmissionsByCourseIdWithDetails,
  getSubmissionsForGrading: mocks.getSubmissionsForGrading,
  hasSubmission: vi.fn(),
  insertQuestionAnswersBatch: vi.fn(),
  updateSubmission: mocks.updateSubmission,
  updateSubmissionGrades: mocks.updateSubmissionGrades
}));
vi.mock('@cio/db/queries/exercise', () => ({
  getExerciseById: mocks.getExerciseById,
  getExerciseWithRelationsOptimized: mocks.getExerciseWithRelationsOptimized,
  getQuestionRevisionsByIds: mocks.getQuestionRevisionsByIds,
  lockExerciseAssignmentState: mocks.lockExerciseAssignmentState,
  resolveGroupMemberExerciseAccess: vi.fn()
}));
vi.mock('@cio/db/queries/assets', () => ({
  createAssetUsage: vi.fn(),
  deleteAssetUsagesByTarget: vi.fn(),
  lockAssetById: vi.fn()
}));
vi.mock('@cio/db/queries/course', () => ({
  getCourseById: mocks.getCourseById,
  getCourseWithOrgData: mocks.getCourseWithOrgData
}));
vi.mock('@cio/db/queries/course/people', () => ({
  getCourseTeachers: vi.fn(),
  getProfileByGroupMemberId: mocks.getProfileByGroupMemberId
}));
vi.mock('@cio/db/queries/group', () => ({
  getGroupMemberIdByCourseAndProfile: vi.fn(),
  isCourseTeamMemberOrOrgAdmin: vi.fn()
}));
vi.mock('@cio/db/queries/course/progression', () => ({
  isExerciseCompletedForMember: mocks.isExerciseCompletedForMember
}));
vi.mock('@cio/db/queries/notifications', () => ({ createNotification: mocks.createNotification }));
vi.mock('@cio/db/queries/tag', () => ({ getCourseOrganizationId: vi.fn() }));
vi.mock('@cio/core/config/dashboard-url', () => ({ getDashboardBaseUrl: vi.fn() }));
vi.mock('@cio/core/utils/s3', () => ({
  generateDocumentDownloadPresignedUrls: vi.fn(),
  generateVideoDownloadPresignedUrls: vi.fn()
}));
vi.mock('@cio/email', () => ({ buildEmailBranding: vi.fn(), buildEmailFromName: vi.fn() }));
vi.mock('@api/services/jobs', () => ({ enqueueTransactionalEmail: mocks.enqueueTransactionalEmail }));
vi.mock('@api/services/course/compliance', () => ({
  syncComplianceProgressFromSubmission: mocks.syncComplianceProgressFromSubmission
}));
vi.mock('@api/services/course/completion', () => ({
  evaluateCourseCertification: mocks.evaluateCourseCertification
}));
vi.mock('@api/services/webhook', () => ({ emitWebhookEvent: vi.fn() }));
vi.mock('./submission-ownership', () => ({
  getCourseSubmissionOrThrow: mocks.getCourseSubmissionOrThrow,
  lockCourseSubmissionOrThrow: mocks.lockCourseSubmissionOrThrow
}));

import {
  listSubmissionsForGrading,
  listSubmissionsByExercise,
  updateSubmissionAnswer,
  updateSubmissionGradesBatch,
  updateSubmissionService
} from './submission';

const courseId = 'course-a';
const exerciseId = 'exercise-a';
const submissionId = 'submission-a';
const transactionClient = { transaction: 'test' };
const storedAnswer = {
  id: 1,
  submissionId,
  questionId: 11,
  groupMemberId: 'member-a',
  answerData: { type: 'TEXTAREA', text: 'Answer' },
  score: 0,
  point: 0
};
const submission = {
  id: submissionId,
  courseId,
  exerciseId,
  submittedBy: 'member-a',
  gradingState: 'awaiting_manual',
  overallStatus: 'manual_required',
  statusId: 2,
  score: 0,
  total: 0
};
const manualCapabilities = {
  gradingMode: 'manual',
  autoGradable: false,
  supportsPartialCredit: false,
  manualGradingRequired: true,
  requiresManagedAssets: false
} as const;
const autoCapabilities = {
  gradingMode: 'auto',
  autoGradable: true,
  supportsPartialCredit: false,
  manualGradingRequired: false,
  requiresManagedAssets: false
} as const;
const attemptedEntry = {
  questionId: 11,
  questionRevisionId: 'revision-11',
  archivedAt: null,
  definition: { schemaVersion: 1, blocks: [], feedback: [] },
  maxScore: 2.5,
  capabilities: manualCapabilities
};

describe('submission grading transaction locks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(
      async (callback: (dbClient: object) => Promise<unknown>) => await callback(transactionClient)
    );
    mocks.lockCourseSubmissionOrThrow.mockResolvedValue(submission);
    mocks.getCourseSubmissionOrThrow.mockResolvedValue(submission);
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: { id: exerciseId, courseId },
      questions: [{ id: 11, points: 2.5, questionTypeId: 3 }]
    });
    mocks.getQuestionAnswersBySubmissionId.mockResolvedValue([storedAnswer]);
    mocks.updateSubmissionGrades.mockResolvedValue({ ...submission, gradingState: 'completed', statusId: 3 });
    mocks.updateSubmission.mockResolvedValue({ ...submission, feedback: 'Reviewed' });
    mocks.syncComplianceProgressFromSubmission.mockResolvedValue(undefined);
    mocks.getExerciseById.mockResolvedValue({ id: exerciseId, completionPolicy: 'submitted' });
    mocks.getProfileByGroupMemberId.mockResolvedValue({ id: 'profile-a' });
    mocks.isExerciseCompletedForMember.mockResolvedValue(true);
    mocks.evaluateCourseCertification.mockResolvedValue(undefined);
    mocks.getSubmissionById.mockResolvedValue(null);
    mocks.getSubmissionsByCourseIdWithDetails.mockResolvedValue([]);
    mocks.getSubmissionsForGrading.mockResolvedValue([]);
    mocks.getCourseById.mockResolvedValue([]);
    mocks.getCourseWithOrgData.mockResolvedValue(null);
    questionRevisionGatewayMocks.resolveAttemptedQuestionSet.mockResolvedValue([attemptedEntry]);
  });

  it('locks the exercise before validating and updating one answer score', async () => {
    await updateSubmissionAnswer(courseId, submissionId, 11, { questionId: 11, points: 1.25 });

    expect(mocks.lockCourseSubmissionOrThrow).toHaveBeenCalledWith(courseId, submissionId, transactionClient);
    expect(mocks.lockExerciseAssignmentState).toHaveBeenCalledWith(exerciseId, transactionClient);
    expect(mocks.lockExerciseAssignmentState.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getExerciseWithRelationsOptimized.mock.invocationCallOrder[0]
    );
  });

  it('rejects single-answer grading after the submission is completed', async () => {
    mocks.lockCourseSubmissionOrThrow.mockResolvedValue({ ...submission, gradingState: 'completed', statusId: 3 });

    await expect(
      updateSubmissionAnswer(courseId, submissionId, 11, { questionId: 11, points: 1.25 })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.updateSubmissionGrades).not.toHaveBeenCalled();
  });

  it('rejects manual grading when the attempted revision is auto-gradable', async () => {
    questionRevisionGatewayMocks.resolveAttemptedQuestionSet.mockResolvedValue([
      { ...attemptedEntry, capabilities: autoCapabilities }
    ]);

    await expect(
      updateSubmissionAnswer(courseId, submissionId, 11, { questionId: 11, points: 1.25 })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.updateSubmissionGrades).not.toHaveBeenCalled();
  });

  it('grades an archived question through its attempted revision, not the live graph', async () => {
    // The question no longer exists in active delivery at all; only the
    // attempted set (which includes archived questions) can resolve it.
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: { id: exerciseId, courseId },
      questions: []
    });
    questionRevisionGatewayMocks.resolveAttemptedQuestionSet.mockResolvedValue([
      { ...attemptedEntry, archivedAt: '2026-07-16T00:00:00.000Z' }
    ]);

    await updateSubmissionAnswer(courseId, submissionId, 11, { questionId: 11, points: 1.25 });

    expect(mocks.updateSubmissionGrades).toHaveBeenCalledWith(
      courseId,
      submissionId,
      expect.objectContaining({ answers: [{ questionId: 11, points: 1.25 }], total: 1.25 }),
      transactionClient
    );
  });

  it('caps a manual score at the attempted revision maximum, never live points', async () => {
    // Live question says 100 points; the attempted revision maximum is 1.
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: { id: exerciseId, courseId },
      questions: [{ id: 11, points: 100, questionTypeId: 3 }]
    });
    questionRevisionGatewayMocks.resolveAttemptedQuestionSet.mockResolvedValue([{ ...attemptedEntry, maxScore: 1 }]);

    await expect(
      updateSubmissionAnswer(courseId, submissionId, 11, { questionId: 11, points: 2 })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.updateSubmissionGrades).not.toHaveBeenCalled();
  });

  it('locks the exercise before validating and updating a complete grade batch', async () => {
    await updateSubmissionGradesBatch(courseId, submissionId, {
      answers: [{ questionId: 11, points: 1.25 }],
      total: 1.25
    });

    expect(mocks.lockCourseSubmissionOrThrow).toHaveBeenCalledWith(courseId, submissionId, transactionClient);
    expect(mocks.lockExerciseAssignmentState).toHaveBeenCalledWith(exerciseId, transactionClient);
    expect(mocks.lockExerciseAssignmentState.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getExerciseWithRelationsOptimized.mock.invocationCallOrder[0]
    );
    await vi.waitFor(() => {
      expect(mocks.evaluateCourseCertification).toHaveBeenCalledWith(courseId, 'profile-a');
    });
  });

  it('completes a batch grade for an archived question using attempted maxima', async () => {
    mocks.getExerciseWithRelationsOptimized.mockResolvedValue({
      exercise: { id: exerciseId, courseId },
      questions: []
    });
    questionRevisionGatewayMocks.resolveAttemptedQuestionSet.mockResolvedValue([
      { ...attemptedEntry, archivedAt: '2026-07-16T00:00:00.000Z' }
    ]);

    await updateSubmissionGradesBatch(courseId, submissionId, {
      answers: [{ questionId: 11, points: 2.5 }],
      total: 2.5
    });

    expect(mocks.updateSubmissionGrades).toHaveBeenCalledWith(
      courseId,
      submissionId,
      expect.objectContaining({ answers: [{ questionId: 11, points: 2.5 }], total: 2.5 }),
      transactionClient
    );
  });

  it('uses the attempted maxima, not live points, as the graded email denominator', async () => {
    const gradedAnswer = { ...storedAnswer, score: 1.25, point: 1 };
    mocks.getSubmissionById.mockResolvedValue({ id: submissionId, courseId });
    mocks.getSubmissionsForGrading.mockResolvedValue([
      {
        id: submissionId,
        courseId,
        feedback: null,
        groupmember: { profile: { id: 'profile-a', email: 'student@example.com', fullname: 'Student' } },
        // Live points (100) must never leak into the historical denominator.
        exercise: { id: exerciseId, title: 'Assessment', questions: [{ id: 11, points: 100 }] },
        lesson: null,
        answers: [gradedAnswer]
      }
    ]);
    mocks.getCourseById.mockResolvedValue([{ id: courseId, title: 'Course' }]);
    mocks.getCourseWithOrgData.mockResolvedValue({
      orgId: 'org-a',
      orgName: 'Organization',
      orgSiteName: 'organization',
      orgCustomDomain: null,
      orgIsCustomDomainVerified: false,
      orgAvatarUrl: null,
      orgTheme: null
    });

    await updateSubmissionGradesBatch(courseId, submissionId, {
      answers: [{ questionId: 11, points: 1.25 }],
      total: 1.25
    });

    await vi.waitFor(() => {
      expect(mocks.enqueueTransactionalEmail).toHaveBeenCalledWith(
        'submissionGraded',
        expect.objectContaining({
          fields: expect.objectContaining({ score: '1.25/2.5' })
        })
      );
    });
  });

  it('rounds the graded email numerator to two decimals', async () => {
    // Two numeric(12,2) scores summed as floats: 0.1 + 0.2 must render as
    // "0.3", never "0.30000000000000004".
    const secondStoredAnswer = { ...storedAnswer, id: 2, questionId: 12 };
    mocks.getQuestionAnswersBySubmissionId.mockResolvedValue([storedAnswer, secondStoredAnswer]);
    questionRevisionGatewayMocks.resolveAttemptedQuestionSet.mockResolvedValue([
      { ...attemptedEntry, maxScore: 1.25 },
      { ...attemptedEntry, questionId: 12, questionRevisionId: 'revision-12', maxScore: 1.25 }
    ]);
    mocks.getSubmissionById.mockResolvedValue({ id: submissionId, courseId });
    mocks.getSubmissionsForGrading.mockResolvedValue([
      {
        id: submissionId,
        courseId,
        feedback: null,
        groupmember: { profile: { id: 'profile-a', email: 'student@example.com', fullname: 'Student' } },
        exercise: { id: exerciseId, title: 'Assessment', questions: [] },
        lesson: null,
        answers: [
          { ...storedAnswer, score: 0.1, point: 0 },
          { ...secondStoredAnswer, score: 0.2, point: 0 }
        ]
      }
    ]);
    mocks.getCourseById.mockResolvedValue([{ id: courseId, title: 'Course' }]);
    mocks.getCourseWithOrgData.mockResolvedValue({
      orgId: 'org-a',
      orgName: 'Organization',
      orgSiteName: 'organization',
      orgCustomDomain: null,
      orgIsCustomDomainVerified: false,
      orgAvatarUrl: null,
      orgTheme: null
    });

    await updateSubmissionGradesBatch(courseId, submissionId, {
      answers: [
        { questionId: 11, points: 0.1 },
        { questionId: 12, points: 0.2 }
      ],
      total: 0.3
    });

    await vi.waitFor(() => {
      expect(mocks.enqueueTransactionalEmail).toHaveBeenCalledWith(
        'submissionGraded',
        expect.objectContaining({
          fields: expect.objectContaining({ score: '0.3/2.5' })
        })
      );
    });
  });

  it('locks the submission while validating a generic workflow update', async () => {
    await updateSubmissionService(courseId, submissionId, { feedback: 'Reviewed' });

    expect(mocks.lockCourseSubmissionOrThrow).toHaveBeenCalledWith(courseId, submissionId, transactionClient);
    expect(mocks.updateSubmission).toHaveBeenCalledWith(
      courseId,
      submissionId,
      expect.objectContaining({ feedback: 'Reviewed' }),
      transactionClient
    );
  });

  it('requires the authoritative grading endpoint to complete a manual submission', async () => {
    await expect(updateSubmissionService(courseId, submissionId, { statusId: 3 })).rejects.toMatchObject({
      statusCode: 400
    });

    expect(mocks.updateSubmission).not.toHaveBeenCalled();
  });

  it('renders historical canonical answers from the attempted safe revision projection', async () => {
    const canonicalAnswer = {
      ...storedAnswer,
      answerData: {
        type: 'ASSESSMENT_ITEM' as const,
        response: {
          schemaVersion: 1,
          responses: [{ interactionId: 'choice-1', response: { kind: 'choice', selectedOptionIds: ['option-a'] } }]
        }
      },
      questionRevisionId: 'revision-canonical'
    };
    mocks.getSubmissionsByCourseIdWithDetails.mockResolvedValue([
      { ...submission, createdAt: '2026-07-22T00:00:00.000Z', answers: [canonicalAnswer], groupmember: null }
    ]);
    mocks.getQuestionRevisionsByIds.mockResolvedValue([
      {
        id: 'revision-canonical',
        definition: {
          schemaVersion: 1,
          blocks: [
            {
              id: 'choice-1',
              kind: 'interaction',
              interaction: {
                kind: 'choice',
                prompt: { format: 'html', html: '<p>Choose the correct answer.</p>' },
                required: true,
                maxScore: 2,
                config: {
                  cardinality: 'single',
                  presentation: 'list',
                  options: [{ id: 'option-a', html: '<p>A</p>' }],
                  correctOptionIds: ['option-a']
                }
              }
            }
          ],
          feedback: [{ id: 'feedback-1', scope: 'item', html: '<p>Feedback</p>', visibility: 'after_grading' }]
        }
      }
    ]);

    const [listedSubmission] = await listSubmissionsByExercise(courseId, exerciseId, 'member-a');
    const assessmentDefinition = listedSubmission?.answers[0]?.assessmentDefinition;

    expect(mocks.getQuestionRevisionsByIds).toHaveBeenCalledWith(['revision-canonical']);
    expect(assessmentDefinition).toEqual({
      schemaVersion: 1,
      blocks: [
        {
          id: 'choice-1',
          kind: 'interaction',
          interaction: {
            kind: 'choice',
            prompt: { format: 'html', html: '<p>Choose the correct answer.</p>' },
            required: true,
            maxScore: 2,
            config: {
              cardinality: 'single',
              presentation: 'list',
              options: [{ id: 'option-a', html: '<p>A</p>' }]
            }
          }
        }
      ]
    });
    expect(JSON.stringify(assessmentDefinition)).not.toContain('correctOptionIds');
    expect(JSON.stringify(assessmentDefinition)).not.toContain('Feedback');
  });

  it('provides attempted canonical questions to the manual grading modal without answer keys', async () => {
    const canonicalAnswer = {
      ...storedAnswer,
      answerData: {
        type: 'ASSESSMENT_ITEM' as const,
        response: {
          schemaVersion: 1,
          responses: [{ interactionId: 'text-1', response: { kind: 'text', text: 'Answer' } }]
        }
      },
      questionRevisionId: 'revision-text'
    };
    mocks.getSubmissionsForGrading.mockResolvedValue([
      {
        ...submission,
        createdAt: '2026-07-22T00:00:00.000Z',
        feedback: null,
        exercise: { id: exerciseId, title: 'Assessment', dueBy: null, questions: [] },
        lesson: null,
        groupmember: { profile: { id: 'profile-a', email: 'student@example.com', fullname: 'Student' } },
        answers: [canonicalAnswer]
      }
    ]);
    mocks.getQuestionRevisionsByIds.mockResolvedValue([
      {
        id: 'revision-text',
        definition: {
          schemaVersion: 1,
          blocks: [
            {
              id: 'text-1',
              kind: 'interaction',
              interaction: {
                kind: 'text',
                prompt: { format: 'html', html: '<p>Explain your reasoning.</p>' },
                required: true,
                maxScore: 3,
                config: { format: 'rich', instructions: 'Use complete sentences.' }
              }
            }
          ],
          feedback: []
        }
      }
    ]);

    const result = await listSubmissionsForGrading(courseId);
    const canonicalQuestion = result.submissionIdData[submissionId]?.canonicalQuestions[0];

    expect(canonicalQuestion).toEqual({
      id: 11,
      definition: {
        schemaVersion: 1,
        blocks: [
          {
            id: 'text-1',
            kind: 'interaction',
            interaction: {
              kind: 'text',
              prompt: { format: 'html', html: '<p>Explain your reasoning.</p>' },
              required: true,
              maxScore: 3,
              config: { format: 'rich', instructions: 'Use complete sentences.' }
            }
          }
        ]
      }
    });
    expect(JSON.stringify(canonicalQuestion)).not.toContain('correctOptionIds');
  });
});
