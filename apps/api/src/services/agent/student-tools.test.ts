import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveViewerExerciseAccess: vi.fn()
}));

vi.mock('@cio/db/queries/exercise', () => ({
  getExercisesByCourseId: vi.fn(),
  resolveViewerExerciseAccess: mocks.resolveViewerExerciseAccess
}));
vi.mock('@cio/core/services/lesson/lesson', () => ({ getLesson: vi.fn() }));
vi.mock('@cio/core/services/agent/lesson-transcript', () => ({ getLessonVideoTranscript: vi.fn() }));
vi.mock('@cio/core/services/exercise/exercise', () => ({ getExercise: vi.fn() }));
vi.mock('@cio/core/services/course/section', () => ({ listCourseSections: vi.fn() }));
vi.mock('@cio/core/services/agent/chat-context', () => ({
  verifyExerciseBelongsToCourse: vi.fn(),
  verifyLessonBelongsToCourse: vi.fn()
}));
vi.mock('@cio/core/utils/tinybird', () => ({
  AgentEvent: { TOOL_CALLED: 'tool_called', TOOL_COMPLETED: 'tool_completed' },
  trackAgentEvent: vi.fn()
}));

import { ErrorCodes } from '@api/utils/errors';
import { assertStudentExerciseAccess } from './student-tools';

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
