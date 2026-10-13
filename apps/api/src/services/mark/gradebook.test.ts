import { describe, expect, it } from 'vitest';
import { ContentType } from '@cio/utils/constants';
import type { Mark } from '@cio/db/queries/mark';
import { buildExercises, buildStudentMarksByExerciseId } from './gradebook';
import type { CourseContentItem } from '@api/services/course/utils';

function makeMark(overrides: Partial<Mark>): Mark {
  return {
    courseId: 'course-1',
    exerciseId: 'exercise-1',
    exerciseTitle: 'Exercise 1',
    exercisePoints: 0,
    activeExercisePoints: 0,
    submissionId: null,
    submissionCreatedAt: null,
    gradingState: null,
    statusId: null,
    totalPointsGotten: null,
    groupmemberId: null,
    ...overrides
  };
}

function makeExerciseContentItem(id: string, title: string): CourseContentItem {
  return {
    id,
    type: ContentType.Exercise,
    title,
    order: null,
    createdAt: null,
    sectionId: null,
    isUnlocked: null,
    isComplete: null,
    lessonAt: null,
    callUrl: null,
    sessionDurationMinutes: null,
    recordingUrl: null,
    hasNoteContent: null,
    hasSlideContent: null,
    videosCount: null,
    documentsCount: null,
    questionCount: null,
    dueBy: null
  };
}

describe('buildExercises', () => {
  it('uses the active exercise maximum for the header, not the first row historical maximum', () => {
    // Two students attempted the same exercise against different historical maxima
    // (a question was archived between their attempts); the live active max is 3.
    const marks = [
      makeMark({ exercisePoints: 8.5, activeExercisePoints: 3, groupmemberId: 'gm-1', totalPointsGotten: 5 }),
      makeMark({ exercisePoints: 2.5, activeExercisePoints: 3, groupmemberId: 'gm-2', totalPointsGotten: 2 })
    ];

    const exercises = buildExercises(marks, []);

    expect(exercises).toEqual([{ id: 'exercise-1', title: 'Exercise 1', points: 3 }]);
  });

  it('preserves fractional active points', () => {
    const marks = [makeMark({ exercisePoints: 2, activeExercisePoints: 2.75 })];

    const exercises = buildExercises(marks, []);

    expect(exercises[0].points).toBe(2.75);
  });

  it('orders exercises by course content when available and keeps active points per exercise', () => {
    const marks = [
      makeMark({ exerciseId: 'exercise-2', exerciseTitle: 'Second', activeExercisePoints: 10 }),
      makeMark({ exerciseId: 'exercise-1', exerciseTitle: 'First', activeExercisePoints: 4.5 })
    ];
    const contentItems = [
      makeExerciseContentItem('exercise-1', 'First'),
      makeExerciseContentItem('exercise-2', 'Second')
    ];

    const exercises = buildExercises(marks, contentItems);

    expect(exercises).toEqual([
      { id: 'exercise-1', title: 'First', points: 4.5 },
      { id: 'exercise-2', title: 'Second', points: 10 }
    ]);
  });

  it('falls back to mark order with zero points for exercises missing from marks', () => {
    const contentItems = [makeExerciseContentItem('exercise-untaken', 'Untaken')];

    const exercises = buildExercises([], contentItems);

    expect(exercises).toEqual([{ id: 'exercise-untaken', title: 'Untaken', points: 0 }]);
  });
});

describe('buildStudentMarksByExerciseId', () => {
  it('selects the best completed attempt and keeps its historical denominator', () => {
    const marks = [
      makeMark({
        exercisePoints: 10,
        gradingState: 'completed',
        groupmemberId: 'gm-1',
        submissionCreatedAt: '2026-07-16T10:00:00.000Z',
        submissionId: 'submission-1',
        totalPointsGotten: 8
      }),
      makeMark({
        exercisePoints: 5,
        gradingState: 'completed',
        groupmemberId: 'gm-1',
        submissionCreatedAt: '2026-07-16T11:00:00.000Z',
        submissionId: 'submission-2',
        totalPointsGotten: 4.5
      })
    ];

    expect(buildStudentMarksByExerciseId(marks)).toEqual({
      'gm-1': {
        'exercise-1': { score: '4.5', maxPoints: 5 }
      }
    });
  });

  it('uses the latest completed attempt as the deterministic tie-breaker', () => {
    const marks = [
      makeMark({
        exercisePoints: 10,
        gradingState: 'completed',
        groupmemberId: 'gm-1',
        submissionCreatedAt: '2026-07-16T11:00:00.000Z',
        submissionId: 'submission-latest',
        totalPointsGotten: 8
      }),
      makeMark({
        exercisePoints: 5,
        gradingState: 'completed',
        groupmemberId: 'gm-1',
        submissionCreatedAt: '2026-07-16T10:00:00.000Z',
        submissionId: 'submission-earlier',
        totalPointsGotten: 4
      })
    ];

    expect(buildStudentMarksByExerciseId(marks)['gm-1']['exercise-1']).toEqual({ score: '8', maxPoints: 10 });
  });

  it('does not expose unfinished attempts as final grades', () => {
    const marks = [
      makeMark({
        exercisePoints: 5,
        gradingState: 'awaiting_manual',
        groupmemberId: 'gm-1',
        submissionCreatedAt: '2026-07-16T11:00:00.000Z',
        submissionId: 'submission-pending',
        totalPointsGotten: 5
      })
    ];

    expect(buildStudentMarksByExerciseId(marks)).toEqual({});
  });
});
