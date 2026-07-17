import { ContentType, ROLE } from '@cio/utils/constants';
import { getMarksByCourseId, type Mark } from '@cio/db/queries/mark';
import { getCourseMembers } from '@cio/db/queries/course/people';
import { getCourseWithRelations } from '@cio/db/queries/course';
import { buildCourseContent, type CourseContentItem } from '@api/services/course/utils';
import { AppError, ErrorCodes } from '@api/utils/errors';

export type GradebookExercise = {
  id: string;
  title: string;
  /** Live active maximum of the exercise (archived questions excluded). */
  points: number;
};

export type GradebookMark = {
  score: string;
  /** Immutable maximum from the selected completed attempt. */
  maxPoints: number;
};

export type GradebookStudentMarks = Record<string, Record<string, GradebookMark>>;

export type GradebookResponse = {
  students: Awaited<ReturnType<typeof getCourseMembers>>;
  exercises: GradebookExercise[];
  studentMarksByExerciseId: GradebookStudentMarks;
};

function markPercentage(mark: Mark): number {
  const score = Number(mark.totalPointsGotten);
  const maxPoints = Number(mark.exercisePoints);
  if (!Number.isFinite(score) || !Number.isFinite(maxPoints) || maxPoints <= 0) {
    return Number.NEGATIVE_INFINITY;
  }

  return score / maxPoints;
}

function isPreferredGradebookAttempt(candidate: Mark, current: Mark): boolean {
  const candidatePercentage = markPercentage(candidate);
  const currentPercentage = markPercentage(current);
  if (candidatePercentage !== currentPercentage) {
    return candidatePercentage > currentPercentage;
  }

  const candidateCreatedAt = candidate.submissionCreatedAt ?? '';
  const currentCreatedAt = current.submissionCreatedAt ?? '';
  if (candidateCreatedAt !== currentCreatedAt) {
    return candidateCreatedAt > currentCreatedAt;
  }

  return (candidate.submissionId ?? '') > (current.submissionId ?? '');
}

export function buildStudentMarksByExerciseId(marks: Mark[]): GradebookStudentMarks {
  const selectedMarks = new Map<string, Map<string, Mark>>();
  for (const mark of marks) {
    const { groupmemberId, exerciseId, gradingState, submissionId } = mark;
    if (!groupmemberId || !exerciseId || !submissionId || gradingState !== 'completed') continue;

    let marksByExercise = selectedMarks.get(groupmemberId);
    if (!marksByExercise) {
      marksByExercise = new Map<string, Mark>();
      selectedMarks.set(groupmemberId, marksByExercise);
    }

    const current = marksByExercise.get(exerciseId);
    if (!current || isPreferredGradebookAttempt(mark, current)) {
      marksByExercise.set(exerciseId, mark);
    }
  }

  const result: GradebookStudentMarks = {};
  for (const [groupmemberId, marksByExercise] of selectedMarks) {
    result[groupmemberId] = {};
    for (const [exerciseId, mark] of marksByExercise) {
      result[groupmemberId][exerciseId] = {
        score: mark.totalPointsGotten?.toString() ?? '0',
        maxPoints: mark.exercisePoints
      };
    }
  }

  return result;
}

// Header points come from `activeExercisePoints` (identical on every row of an
// exercise), never from a row's historical `exercisePoints`: after a question is
// archived, submission rows carry diverging historical maxima and first-row-wins
// would show an arbitrary student's denominator in the column header.
export function buildExercises(marks: Mark[], contentItems: CourseContentItem[]): GradebookExercise[] {
  const marksByExerciseId = new Map<string, { title: string; points: number }>();
  const exerciseOrder: string[] = [];
  for (const mark of marks) {
    const { exerciseId, exerciseTitle, activeExercisePoints } = mark;
    if (!exerciseId) continue;
    if (!marksByExerciseId.has(exerciseId)) {
      exerciseOrder.push(exerciseId);
      marksByExerciseId.set(exerciseId, {
        title: exerciseTitle ?? '',
        points: activeExercisePoints ?? 0
      });
    }
  }

  const exerciseItems = contentItems.filter((item) => item.type === ContentType.Exercise);
  if (exerciseItems.length > 0) {
    return exerciseItems.map((item) => {
      const fromMarks = marksByExerciseId.get(item.id);
      return {
        id: item.id,
        title: item.title ?? fromMarks?.title ?? '',
        points: fromMarks?.points ?? 0
      };
    });
  }

  return exerciseOrder.map((id) => {
    const fromMarks = marksByExerciseId.get(id)!;
    return {
      id,
      title: fromMarks?.title ?? '',
      points: fromMarks?.points ?? 0
    };
  });
}

/**
 * Returns all data needed to render the marks gradebook: students, exercises in order, and marks per student per exercise.
 */
export async function getGradebook(courseId: string): Promise<GradebookResponse> {
  try {
    const [marks, members, course] = await Promise.all([
      getMarksByCourseId(courseId),
      getCourseMembers(courseId),
      getCourseWithRelations(courseId)
    ]);

    const students = members.filter((m) => Number(m.roleId) === ROLE.STUDENT);

    let contentItems: CourseContentItem[] = [];
    if (course?.contentItems != null) {
      const isGrouping = course.metadata?.isContentGroupingEnabled ?? true;
      const content = buildCourseContent(course.contentItems, isGrouping);
      contentItems = content.grouped ? (content.sections ?? []).flatMap((s) => s.items ?? []) : (content.items ?? []);
    }

    const exercises = buildExercises(marks, contentItems);
    const studentMarksByExerciseId = buildStudentMarksByExerciseId(marks);

    return {
      students,
      exercises,
      studentMarksByExerciseId
    };
  } catch (error) {
    console.error('getGradebook error:', error);
    throw new AppError(
      error instanceof Error ? error.message : 'Failed to get gradebook',
      ErrorCodes.INTERNAL_ERROR,
      500
    );
  }
}
