import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getHistoricalMaxPointsBySubmissionIds: vi.fn(),
  getStudentSubmissionsForExercise: vi.fn()
}));

vi.mock('@cio/db/queries/course/certification-exercise', () => ({
  getHistoricalMaxPointsBySubmissionIds: mocks.getHistoricalMaxPointsBySubmissionIds,
  getStudentSubmissionsForExercise: mocks.getStudentSubmissionsForExercise
}));
vi.mock('@cio/db/drizzle', () => ({ db: { transaction: vi.fn() } }));
vi.mock('@cio/db/queries/course', () => ({ getCourseById: vi.fn() }));
vi.mock('@cio/db/queries/course/compliance', () => ({
  createCourseCertificateIssue: vi.fn(),
  createCourseCompletionNotificationEvent: vi.fn(),
  createCourseCompletionRecord: vi.fn(),
  getCourseComplianceHistoryRows: vi.fn(),
  getCourseCurrentComplianceRows: vi.fn(),
  getLatestComplianceRecordsByProfiles: vi.fn(),
  getOrgComplianceLearnerRows: vi.fn(),
  getStudentCourseMembersForCompliance: vi.fn(),
  listComplianceRecordsReadyForExpiry: vi.fn(),
  listLatestComplianceRecordsForReminderScan: vi.fn(),
  updateCourseCertificateIssueStatusByRecordId: vi.fn(),
  updateCourseCompletionRecord: vi.fn()
}));
vi.mock('@cio/db/queries/course/people', () => ({ getProfileByGroupMemberId: vi.fn() }));
vi.mock('@cio/db/queries/group/group', () => ({ getUserCourseRole: vi.fn() }));
vi.mock('./completion', () => ({ evaluateCourseCertification: vi.fn() }));

import { getComplianceCompletionSnapshot } from './compliance';

describe('getComplianceCompletionSnapshot historical denominators', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null score and attempts without a required exercise', async () => {
    const snapshot = await getComplianceCompletionSnapshot({
      groupMemberId: 'member-a',
      requiredExerciseId: null
    });

    expect(snapshot).toEqual({ score: null, attempts: null });
    expect(mocks.getStudentSubmissionsForExercise).not.toHaveBeenCalled();
  });

  it('scores each completed submission against its own attempted maximum when maxima diverge', async () => {
    mocks.getStudentSubmissionsForExercise.mockResolvedValue([
      { id: 'sub-1', gradingState: 'completed', score: 2 },
      { id: 'sub-2', gradingState: 'completed', score: 3 },
      { id: 'sub-3', gradingState: 'pending', score: 0 }
    ]);
    mocks.getHistoricalMaxPointsBySubmissionIds.mockResolvedValue(
      new Map([
        ['sub-1', 4],
        ['sub-2', 3]
      ])
    );

    const snapshot = await getComplianceCompletionSnapshot({
      groupMemberId: 'member-a',
      requiredExerciseId: 'exercise-a'
    });

    // Best attempt is sub-2 at 3/3, not 3/4 against another attempt's max.
    expect(snapshot).toEqual({ score: 100, attempts: 3 });
    expect(mocks.getHistoricalMaxPointsBySubmissionIds).toHaveBeenCalledWith(['sub-1', 'sub-2']);
  });

  it('keeps a full score after attempted questions are archived from the live exercise', async () => {
    // The snapshot never consults the live active max: only the historical
    // per-submission denominator is read, so archiving cannot shrink it.
    mocks.getStudentSubmissionsForExercise.mockResolvedValue([{ id: 'sub-1', gradingState: 'completed', score: 3 }]);
    mocks.getHistoricalMaxPointsBySubmissionIds.mockResolvedValue(new Map([['sub-1', 3]]));

    const snapshot = await getComplianceCompletionSnapshot({
      groupMemberId: 'member-a',
      requiredExerciseId: 'exercise-a'
    });

    expect(snapshot).toEqual({ score: 100, attempts: 1 });
  });

  it('skips completed submissions whose attempted max is 0 and returns null when none remain', async () => {
    mocks.getStudentSubmissionsForExercise.mockResolvedValue([{ id: 'sub-1', gradingState: 'completed', score: 0 }]);
    mocks.getHistoricalMaxPointsBySubmissionIds.mockResolvedValue(new Map([['sub-1', 0]]));

    const snapshot = await getComplianceCompletionSnapshot({
      groupMemberId: 'member-a',
      requiredExerciseId: 'exercise-a'
    });

    expect(snapshot).toEqual({ score: null, attempts: 1 });
  });

  it('ignores a 0-max attempt while scoring the remaining attempts normally', async () => {
    mocks.getStudentSubmissionsForExercise.mockResolvedValue([
      { id: 'sub-1', gradingState: 'completed', score: 0 },
      { id: 'sub-2', gradingState: 'completed', score: 1.5 }
    ]);
    mocks.getHistoricalMaxPointsBySubmissionIds.mockResolvedValue(
      new Map([
        ['sub-1', 0],
        ['sub-2', 3]
      ])
    );

    const snapshot = await getComplianceCompletionSnapshot({
      groupMemberId: 'member-a',
      requiredExerciseId: 'exercise-a'
    });

    expect(snapshot).toEqual({ score: 50, attempts: 2 });
  });

  it('returns null score with attempt count when no submission is completed', async () => {
    mocks.getStudentSubmissionsForExercise.mockResolvedValue([{ id: 'sub-1', gradingState: 'pending', score: 0 }]);

    const snapshot = await getComplianceCompletionSnapshot({
      groupMemberId: 'member-a',
      requiredExerciseId: 'exercise-a'
    });

    expect(snapshot).toEqual({ score: null, attempts: 1 });
    expect(mocks.getHistoricalMaxPointsBySubmissionIds).not.toHaveBeenCalled();
  });
});
