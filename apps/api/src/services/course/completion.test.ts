import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  calcCourseProgressPercent: vi.fn(),
  claimMemberCertificateEarned: vi.fn(),
  exerciseBelongsToCourse: vi.fn(),
  getActiveOrganizationPlan: vi.fn(),
  getCourseById: vi.fn(),
  getCourseCertificationRow: vi.fn(),
  getCourseProgress: vi.fn(),
  getExerciseTitleAndMaxPoints: vi.fn(),
  getHistoricalMaxPointsBySubmissionIds: vi.fn(),
  getStudentSubmissionsForExercise: vi.fn(),
  isBeforeOrEqualDeadline: vi.fn(),
  scheduleCertificationCompletionWork: vi.fn(),
  trackServerEvent: vi.fn()
}));

vi.mock('@api/utils/course-completion', () => ({
  calcCourseProgressPercent: mocks.calcCourseProgressPercent,
  isBeforeOrEqualDeadline: mocks.isBeforeOrEqualDeadline,
  scheduleCertificationCompletionWork: mocks.scheduleCertificationCompletionWork
}));
vi.mock('@cio/db/queries/course/certification-exercise', () => ({
  exerciseBelongsToCourse: mocks.exerciseBelongsToCourse,
  getExerciseTitleAndMaxPoints: mocks.getExerciseTitleAndMaxPoints,
  getHistoricalMaxPointsBySubmissionIds: mocks.getHistoricalMaxPointsBySubmissionIds,
  getStudentSubmissionsForExercise: mocks.getStudentSubmissionsForExercise
}));
vi.mock('@cio/db/queries/course/course', () => ({
  getCourseById: mocks.getCourseById,
  getCourseCertificationRow: mocks.getCourseCertificationRow,
  getCourseProgress: mocks.getCourseProgress
}));
vi.mock('@cio/db/queries/course/people', () => ({
  claimMemberCertificateEarned: mocks.claimMemberCertificateEarned
}));
vi.mock('@cio/db/queries/organization', () => ({
  getActiveOrganizationPlan: mocks.getActiveOrganizationPlan
}));
vi.mock('@cio/core/config/deployment', () => ({
  hasFullProductEntitlements: false
}));
vi.mock('@cio/analytics', () => ({
  SERVER_EVENTS: {
    COURSE_COMPLETED: 'course_completed',
    CERTIFICATE_ISSUED: 'certificate_issued'
  },
  trackServerEvent: mocks.trackServerEvent
}));

import { evaluateCourseCertification } from './completion';

describe('evaluateCourseCertification final exercise threshold', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calcCourseProgressPercent.mockReturnValue(100);
    mocks.isBeforeOrEqualDeadline.mockReturnValue(true);
    mocks.exerciseBelongsToCourse.mockResolvedValue(true);
    mocks.getExerciseTitleAndMaxPoints.mockResolvedValue({ title: 'Final assessment', maxPoints: 3 });
    mocks.getCourseProgress.mockResolvedValue({
      lessonsCount: 1,
      lessonsCompleted: 1,
      exercisesCount: 1,
      exercisesCompleted: 1,
      groupMemberId: 'member-a',
      roleId: 3,
      certificateEarnedAt: null,
      certificationEmailSentAt: null
    });
    mocks.getCourseCertificationRow.mockResolvedValue({
      type: 'STANDARD',
      compliance: null,
      certificate: {
        threshold: 100,
        requiredExerciseId: 'exercise-a',
        exerciseMinScorePercent: 100
      },
      title: 'Course',
      orgId: 'org-a',
      orgSiteName: 'org-a',
      orgCustomDomain: null,
      orgIsCustomDomainVerified: false,
      orgName: 'Organization',
      orgAvatarUrl: null,
      orgTheme: null
    });
  });

  it('does not round a fractional score up to the passing threshold', async () => {
    mocks.getStudentSubmissionsForExercise.mockResolvedValue([
      {
        id: 'sub-1',
        gradingState: 'completed',
        score: '2.99'
      }
    ]);
    mocks.getHistoricalMaxPointsBySubmissionIds.mockResolvedValue(new Map([['sub-1', 3]]));

    const result = await evaluateCourseCertification('course-a', 'profile-a');

    expect(result.eligibleForCertificate).toBe(false);
    expect(result.meetsFinalExerciseRule).toBe(false);
    expect(result.blockers).toContainEqual({
      code: 'CERT_FINAL_EXERCISE_SCORE',
      params: {
        exerciseTitle: 'Final assessment',
        bestPercent: 99.67,
        requiredPercent: 100
      }
    });
    expect(mocks.claimMemberCertificateEarned).not.toHaveBeenCalled();
  });

  it('scores each completed submission against its own attempted maximum when maxima diverge', async () => {
    // Live active max is 8.5, but sub-2 was attempted against a 3-point set:
    // 3/3 = 100% passes even though 3/8.5 would fail against the active max.
    mocks.getExerciseTitleAndMaxPoints.mockResolvedValue({ title: 'Final assessment', maxPoints: 8.5 });
    mocks.getStudentSubmissionsForExercise.mockResolvedValue([
      { id: 'sub-1', gradingState: 'completed', score: '2' },
      { id: 'sub-2', gradingState: 'completed', score: '3' },
      { id: 'sub-3', gradingState: 'pending', score: '8.5' }
    ]);
    mocks.getHistoricalMaxPointsBySubmissionIds.mockResolvedValue(
      new Map([
        ['sub-1', 8.5],
        ['sub-2', 3]
      ])
    );

    const result = await evaluateCourseCertification('course-a', 'profile-a');

    expect(result.meetsFinalExerciseRule).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(mocks.getHistoricalMaxPointsBySubmissionIds).toHaveBeenCalledWith(['sub-1', 'sub-2']);
  });

  it('keeps certification passing after every attempted question is archived (active max 0)', async () => {
    mocks.getExerciseTitleAndMaxPoints.mockResolvedValue({ title: 'Final assessment', maxPoints: 0 });
    mocks.getStudentSubmissionsForExercise.mockResolvedValue([{ id: 'sub-1', gradingState: 'completed', score: '3' }]);
    mocks.getHistoricalMaxPointsBySubmissionIds.mockResolvedValue(new Map([['sub-1', 3]]));

    const result = await evaluateCourseCertification('course-a', 'profile-a');

    expect(result.meetsFinalExerciseRule).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('treats a completed submission with attempted max 0 as 0 percent instead of passing', async () => {
    mocks.getStudentSubmissionsForExercise.mockResolvedValue([{ id: 'sub-1', gradingState: 'completed', score: '0' }]);
    mocks.getHistoricalMaxPointsBySubmissionIds.mockResolvedValue(new Map([['sub-1', 0]]));

    const result = await evaluateCourseCertification('course-a', 'profile-a');

    expect(result.meetsFinalExerciseRule).toBe(false);
    expect(result.blockers).toContainEqual({
      code: 'CERT_FINAL_EXERCISE_SCORE',
      params: {
        exerciseTitle: 'Final assessment',
        bestPercent: 0,
        requiredPercent: 100
      }
    });
  });

  it('still reports misconfiguration when active max is 0 and no attempt is completed', async () => {
    mocks.getExerciseTitleAndMaxPoints.mockResolvedValue({ title: 'Final assessment', maxPoints: 0 });
    mocks.getStudentSubmissionsForExercise.mockResolvedValue([]);

    const result = await evaluateCourseCertification('course-a', 'profile-a');

    expect(result.meetsFinalExerciseRule).toBe(false);
    expect(result.blockers).toContainEqual({
      code: 'CERT_FINAL_EXERCISE_MISCONFIGURED',
      params: { exerciseTitle: 'Final assessment' }
    });
    expect(mocks.getHistoricalMaxPointsBySubmissionIds).not.toHaveBeenCalled();
  });
});
