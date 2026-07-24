import { describe, expect, it } from 'vitest';
import type { CourseContentItem } from '$features/course/utils/types';
import type { Marks } from './types';
import { calculateStudentAverage, calculateStudentTotal, gradePercent, processMarksIntoExercises } from './marks-utils';

const EXERCISE_CONTENT_TYPE = 'EXERCISE' as CourseContentItem['type'];

type MarkRow = Marks[number];

function makeMark(overrides: Partial<MarkRow>): MarkRow {
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
  } as MarkRow;
}

describe('processMarksIntoExercises', () => {
  it('uses the active exercise maximum for the header when rows carry diverging historical maxima', () => {
    const marks = [
      makeMark({ exercisePoints: 8.5, activeExercisePoints: 3, groupmemberId: 'gm-1' }),
      makeMark({ exercisePoints: 2.5, activeExercisePoints: 3, groupmemberId: 'gm-2' })
    ] as Marks;

    const exercises = processMarksIntoExercises(marks, []);

    expect(exercises).toEqual([{ id: 'exercise-1', title: 'Exercise 1', points: 3 }]);
  });

  it('preserves fractional active points and orders by course content', () => {
    const marks = [
      makeMark({ exerciseId: 'exercise-2', exerciseTitle: 'Second', activeExercisePoints: 10 }),
      makeMark({ exerciseId: 'exercise-1', exerciseTitle: 'First', activeExercisePoints: 4.5 })
    ] as Marks;
    const contentItems = [
      { id: 'exercise-1', title: 'First', type: EXERCISE_CONTENT_TYPE },
      { id: 'exercise-2', title: 'Second', type: EXERCISE_CONTENT_TYPE }
    ] as CourseContentItem[];

    const exercises = processMarksIntoExercises(marks, contentItems);

    expect(exercises).toEqual([
      { id: 'exercise-1', title: 'First', points: 4.5 },
      { id: 'exercise-2', title: 'Second', points: 10 }
    ]);
  });
});

describe('calculateStudentTotal', () => {
  it('preserves fractional marks instead of truncating them', () => {
    expect(
      calculateStudentTotal({
        'exercise-1': { score: '2.5', maxPoints: 5 },
        'exercise-2': { score: '1.25', maxPoints: 2 }
      })
    ).toBe(3.75);
  });

  it('treats non-numeric marks as zero', () => {
    expect(
      calculateStudentTotal({
        'exercise-1': { score: '2.5', maxPoints: 5 },
        'exercise-2': { score: 'not-a-number', maxPoints: 2 }
      })
    ).toBe(2.5);
  });
});

describe('gradePercent', () => {
  it('preserves fractional cell marks in the percentage', () => {
    // parseInt would truncate "2.5" to 2 and report 40 instead of 50.
    expect(gradePercent({ score: '2.5', maxPoints: 5 })).toBe(50);
  });

  it('uses the historical attempted maximum after the active maximum shrinks', () => {
    expect(gradePercent({ score: '8.5', maxPoints: 8.5 })).toBe(100);
  });

  it('returns null for missing, non-numeric, or zero-max cells', () => {
    expect(gradePercent(undefined)).toBeNull();
    expect(gradePercent({ score: 'not-a-number', maxPoints: 5 })).toBeNull();
    expect(gradePercent({ score: '2.5', maxPoints: 0 })).toBeNull();
  });
});

describe('calculateStudentAverage', () => {
  it('preserves fractional marks in the percentage', () => {
    const exercises = [{ id: 'exercise-1', title: 'Exercise 1', points: 5 }];

    // parseInt would truncate "2.5" to 2 and report 40 instead of 50.
    expect(calculateStudentAverage({ 'exercise-1': { score: '2.5', maxPoints: 5 } }, exercises)).toBe(50);
  });

  it('pins attempted exercises to historical maxima while unattempted exercises use active maxima', () => {
    const exercises = [
      { id: 'exercise-1', title: 'Exercise 1', points: 3 },
      { id: 'exercise-2', title: 'Exercise 2', points: 5 }
    ];

    expect(calculateStudentAverage({ 'exercise-1': { score: '8.5', maxPoints: 8.5 } }, exercises)).toBe(63);
  });

  it('returns null when no exercises carry points', () => {
    const exercises = [{ id: 'exercise-1', title: 'Exercise 1', points: 0 }];

    expect(calculateStudentAverage({ 'exercise-1': { score: '2', maxPoints: 0 } }, exercises)).toBeNull();
  });
});
