import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enqueueNotifyCourseExercise: vi.fn(),
  getCourseById: vi.fn(),
  getCourseWithOrgData: vi.fn(),
  getExerciseById: vi.fn()
}));

vi.mock('@cio/db/queries/course', () => ({
  getCourseById: mocks.getCourseById,
  getCourseWithOrgData: mocks.getCourseWithOrgData
}));
vi.mock('@cio/db/queries/exercise', () => ({ getExerciseById: mocks.getExerciseById }));
vi.mock('@cio/core/config/dashboard-url', () => ({ getDashboardBaseUrl: () => 'https://app.example.com' }));
vi.mock('@cio/email', () => ({
  buildEmailBranding: () => undefined,
  buildEmailFromName: (name: string) => name
}));
vi.mock('@cio/jobs', () => ({
  enqueueNotifyCourseExercise: mocks.enqueueNotifyCourseExercise,
  getQueueJobEnvelope: vi.fn(),
  QUEUE_NAMES: { notifications: 'notifications' }
}));

import { notifyCourseExerciseService } from './notify-exercise';

describe('notifyCourseExerciseService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCourseById.mockResolvedValue([{ id: 'course-a', title: 'Course A', type: 'PRIVATE' }]);
    mocks.getCourseWithOrgData.mockResolvedValue({
      orgId: 'org-a',
      orgName: 'Org A',
      orgSiteName: 'org-a',
      orgCustomDomain: null,
      orgIsCustomDomainVerified: false,
      orgAvatarUrl: null,
      orgTheme: null
    });
    mocks.getExerciseById.mockResolvedValue({ id: 'exercise-a', courseId: 'course-a', title: 'Exercise A' });
    mocks.enqueueNotifyCourseExercise.mockResolvedValue('job-a');
  });

  it('includes the exercise id used by the worker to resolve current recipients', async () => {
    await expect(notifyCourseExerciseService('course-a', 'exercise-a')).resolves.toEqual({ jobId: 'job-a' });
    expect(mocks.enqueueNotifyCourseExercise).toHaveBeenCalledWith(
      expect.objectContaining({ courseId: 'course-a', exerciseId: 'exercise-a' })
    );
  });
});
