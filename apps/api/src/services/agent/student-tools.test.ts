import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveViewerExerciseAccess: vi.fn()
}));

vi.mock('@cio/db', () => ({ db: {} }));
vi.mock('@cio/db/queries/exercise', () => ({
  getExercisesByCourseId: vi.fn(),
  resolveViewerExerciseAccess: mocks.resolveViewerExerciseAccess
}));
vi.mock('@cio/core/services/lesson/lesson', () => ({ getLesson: vi.fn() }));
vi.mock('@cio/core/services/agent/lesson-transcript', () => ({ getLessonVideoTranscript: vi.fn() }));
vi.mock('@cio/core/services/exercise/exercise', () => ({ getExercise: vi.fn() }));
vi.mock('@cio/core/services/course/section', () => ({ listCourseSections: vi.fn() }));
vi.mock('@cio/db/queries/group', () => ({ getGroupMemberIdByCourseAndProfile: vi.fn() }));
vi.mock('@cio/db/queries/submission', () => ({ getSubmissionsByCourseIdWithDetails: vi.fn() }));
vi.mock('@cio/core/utils/tinybird', () => ({
  AgentEvent: { TOOL_CALLED: 'tool_called', TOOL_COMPLETED: 'tool_completed' },
  trackAgentEvent: vi.fn()
}));
vi.mock('@cio/core/services/agent/chat-context', () => ({
  verifyExerciseBelongsToCourse: vi.fn(),
  verifyLessonBelongsToCourse: vi.fn()
}));

import { ErrorCodes } from '@api/utils/errors';
import { getExercise } from '@cio/core/services/exercise/exercise';
import { getGroupMemberIdByCourseAndProfile } from '@cio/db/queries/group';
import { getSubmissionsByCourseIdWithDetails } from '@cio/db/queries/submission';
import { verifyExerciseBelongsToCourse } from '@cio/core/services/agent/chat-context';
import { assertStudentExerciseAccess, buildStudentAgentTools } from './student-tools';

describe('assertStudentExerciseAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows an assigned exercise', async () => {
    mocks.resolveViewerExerciseAccess.mockResolvedValue({
      groupMemberId: 'member-a',
      roleId: 3,
      hasAccess: true
    });

    await expect(assertStudentExerciseAccess('course-a', 'exercise-a', 'profile-a')).resolves.toBeUndefined();
  });

  it('rejects an unassigned exercise without exposing its content', async () => {
    mocks.resolveViewerExerciseAccess.mockResolvedValue({
      groupMemberId: 'member-a',
      roleId: 3,
      hasAccess: false
    });

    await expect(assertStudentExerciseAccess('course-a', 'exercise-a', 'profile-a')).rejects.toMatchObject({
      statusCode: 403,
      code: ErrorCodes.EXERCISE_NOT_ASSIGNED
    });
  });
});

const exercise = {
  id: 'exercise-1',
  title: 'TypeScript Special Types Quiz',
  questions: [
    {
      id: 10,
      title: 'Which type accepts any value?',
      points: 2,
      order: 1,
      options: [
        { id: 100, label: 'unknown', isCorrect: false },
        { id: 101, label: 'any', isCorrect: true }
      ]
    },
    {
      id: 11,
      title: 'Which type represents no value?',
      points: 2,
      order: 2,
      options: [
        { id: 110, label: 'void', isCorrect: true },
        { id: 111, label: 'never', isCorrect: false }
      ]
    }
  ]
};

async function readMySubmissions(args: { exerciseId: string; attempt?: number }) {
  const tools = buildStudentAgentTools('org-1', 'profile-1', 'course-1', {} as never);
  const execute = tools.read_my_submissions.execute;
  if (!execute) throw new Error('read_my_submissions has no execute function');

  return execute(args, {} as never);
}

describe('read_my_submissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveViewerExerciseAccess.mockResolvedValue({ groupMemberId: 'member-1', roleId: 3, hasAccess: true });
    vi.mocked(getGroupMemberIdByCourseAndProfile).mockResolvedValue('member-1');
    vi.mocked(getExercise).mockResolvedValue(exercise as Awaited<ReturnType<typeof getExercise>>);
  });

  it('returns the latest graded attempt without answer keys', async () => {
    vi.mocked(getSubmissionsByCourseIdWithDetails).mockResolvedValue([
      {
        id: 'submission-1',
        courseId: 'course-1',
        exerciseId: 'exercise-1',
        submittedBy: 'member-1',
        createdAt: '2026-09-29T10:00:00.000Z',
        updatedAt: '2026-09-29T10:00:00.000Z',
        statusId: 3,
        gradingState: 'completed',
        overallStatus: 'auto_graded',
        total: 2,
        score: null,
        idempotencyKey: null,
        reviewerId: null,
        feedback: null,
        groupmember: null,
        answers: []
      },
      {
        id: 'submission-2',
        courseId: 'course-1',
        exerciseId: 'exercise-1',
        submittedBy: 'member-1',
        createdAt: '2026-09-30T10:00:00.000Z',
        updatedAt: '2026-09-30T10:00:00.000Z',
        statusId: 3,
        gradingState: 'completed',
        overallStatus: 'auto_graded',
        total: 2,
        score: null,
        idempotencyKey: null,
        reviewerId: null,
        feedback: 'Review special return types.',
        groupmember: null,
        answers: [
          {
            id: 1,
            questionId: 10,
            submissionId: 'submission-2',
            groupMemberId: 'member-1',
            answerData: { type: 'RADIO', optionId: 101 },
            answers: null,
            openAnswer: null,
            point: 2,
            score: null,
            attemptedQuestion: null,
            questionRevisionId: null,
            attemptedQuestionTitle: null,
            attemptedQuestionOrder: null,
            attemptedExerciseSectionId: null
          },
          {
            id: 2,
            questionId: 11,
            submissionId: 'submission-2',
            groupMemberId: 'member-1',
            answerData: { type: 'RADIO', optionId: 111 },
            answers: null,
            openAnswer: null,
            point: 0,
            score: null,
            attemptedQuestion: null,
            questionRevisionId: null,
            attemptedQuestionTitle: null,
            attemptedQuestionOrder: null,
            attemptedExerciseSectionId: null
          }
        ]
      }
    ]);

    const result = await readMySubmissions({ exerciseId: 'exercise-1' });

    expect(verifyExerciseBelongsToCourse).toHaveBeenCalledWith('exercise-1', 'course-1');
    expect(getSubmissionsByCourseIdWithDetails).toHaveBeenCalledWith('course-1', 'exercise-1', 'member-1');
    expect(result).toMatchObject({
      attemptCount: 2,
      selectedAttempt: 2,
      submission: {
        id: 'submission-2',
        graded: true,
        score: 2,
        maxScore: 4,
        feedback: 'Review special return types.',
        questions: [
          { id: 10, submittedAnswer: 'any', earnedPoints: 2, maxPoints: 2, result: 'correct' },
          { id: 11, submittedAnswer: 'never', earnedPoints: 0, maxPoints: 2, result: 'incorrect' }
        ]
      }
    });
    expect(JSON.stringify(result)).not.toContain('isCorrect');
  });

  it('withholds scores and feedback while manual grading is pending', async () => {
    vi.mocked(getSubmissionsByCourseIdWithDetails).mockResolvedValue([
      {
        id: 'submission-1',
        courseId: 'course-1',
        exerciseId: 'exercise-1',
        submittedBy: 'member-1',
        createdAt: '2026-09-30T10:00:00.000Z',
        updatedAt: '2026-09-30T10:00:00.000Z',
        statusId: 1,
        gradingState: 'awaiting_manual',
        overallStatus: 'manual_required',
        total: 0,
        score: null,
        idempotencyKey: null,
        reviewerId: null,
        feedback: 'Draft feedback',
        groupmember: null,
        answers: []
      }
    ]);

    const result = await readMySubmissions({ exerciseId: 'exercise-1' });

    expect(result).toMatchObject({
      submission: {
        graded: false,
        score: null,
        maxScore: null,
        feedback: null,
        questions: [
          { earnedPoints: null, maxPoints: null, result: 'ungraded' },
          { earnedPoints: null, maxPoints: null, result: 'ungraded' }
        ]
      }
    });
  });

  it('leaves missing per-question points ungraded after a completed manual review', async () => {
    vi.mocked(getSubmissionsByCourseIdWithDetails).mockResolvedValue([
      {
        id: 'submission-1',
        courseId: 'course-1',
        exerciseId: 'exercise-1',
        submittedBy: 'member-1',
        createdAt: '2026-09-30T10:00:00.000Z',
        updatedAt: '2026-09-30T10:00:00.000Z',
        statusId: 3,
        gradingState: 'completed',
        overallStatus: 'manual_required',
        total: 2,
        score: null,
        idempotencyKey: null,
        reviewerId: null,
        feedback: null,
        groupmember: null,
        answers: [
          {
            id: 1,
            questionId: 10,
            submissionId: 'submission-1',
            groupMemberId: 'member-1',
            answerData: { type: 'RADIO', optionId: 101 },
            answers: null,
            openAnswer: null,
            point: 2,
            score: null,
            attemptedQuestion: null,
            questionRevisionId: null,
            attemptedQuestionTitle: null,
            attemptedQuestionOrder: null,
            attemptedExerciseSectionId: null
          },
          {
            id: 2,
            questionId: 11,
            submissionId: 'submission-1',
            groupMemberId: 'member-1',
            answerData: { type: 'RADIO', optionId: 111 },
            answers: null,
            openAnswer: null,
            point: null,
            score: null,
            attemptedQuestion: null,
            questionRevisionId: null,
            attemptedQuestionTitle: null,
            attemptedQuestionOrder: null,
            attemptedExerciseSectionId: null
          }
        ]
      }
    ]);

    const result = await readMySubmissions({ exerciseId: 'exercise-1' });

    expect(result).toMatchObject({
      submission: {
        questions: [
          { id: 10, earnedPoints: 2, result: 'correct' },
          { id: 11, earnedPoints: null, maxPoints: 2, result: 'ungraded' }
        ]
      }
    });
  });

  it('reports decimal marks stored in score rather than the legacy integer point', async () => {
    vi.mocked(getSubmissionsByCourseIdWithDetails).mockResolvedValue([
      {
        id: 'submission-1',
        courseId: 'course-1',
        exerciseId: 'exercise-1',
        submittedBy: 'member-1',
        createdAt: '2026-09-30T10:00:00.000Z',
        updatedAt: '2026-09-30T10:00:00.000Z',
        statusId: 3,
        gradingState: 'completed',
        overallStatus: 'manual_required',
        total: 1,
        score: 1.5,
        idempotencyKey: null,
        reviewerId: null,
        feedback: null,
        groupmember: null,
        answers: [
          {
            id: 1,
            questionId: 10,
            submissionId: 'submission-1',
            groupMemberId: 'member-1',
            answerData: { type: 'RADIO', optionId: 100 },
            answers: null,
            openAnswer: null,
            point: 1,
            score: 1.5,
            attemptedQuestion: null,
            questionRevisionId: null,
            attemptedQuestionTitle: null,
            attemptedQuestionOrder: null,
            attemptedExerciseSectionId: null
          }
        ]
      }
    ]);

    const result = await readMySubmissions({ exerciseId: 'exercise-1' });

    expect(result).toMatchObject({
      submission: {
        score: 1.5,
        questions: [
          { id: 10, earnedPoints: 1.5, result: 'partially_correct' },
          { id: 11, earnedPoints: null, result: 'ungraded' }
        ]
      }
    });
  });

  it('refuses an exercise that is not assigned to the learner', async () => {
    mocks.resolveViewerExerciseAccess.mockResolvedValue({ groupMemberId: 'member-1', roleId: 3, hasAccess: false });

    await expect(readMySubmissions({ exerciseId: 'exercise-1' })).rejects.toMatchObject({
      statusCode: 403,
      code: ErrorCodes.EXERCISE_NOT_ASSIGNED
    });
    expect(getSubmissionsByCourseIdWithDetails).not.toHaveBeenCalled();
  });
});
