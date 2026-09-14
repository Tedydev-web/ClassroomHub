import type { CourseContentItem, CourseMembers } from '$features/course/utils/types';
import type { Marks } from './types';
import type { ExportColumn, ExportDocument } from '@cio/utils/export';
import { ContentType } from '@cio/utils/constants/content';
import Papa from 'papaparse';

/** Exercise information for display in marks table (linear, no lesson grouping) */
export interface ExerciseInfo {
  id: string;
  title: string;
  points: number;
}

export interface GradebookMark {
  score: string;
  maxPoints: number;
}

/** Maps groupMemberId -> exerciseId -> selected completed attempt. */
export type StudentMarksByExercise = {
  [groupMemberId: string]: {
    [exerciseId: string]: GradebookMark;
  };
};

/** Student's exercise data for calculating totals */
export type StudentExerciseData =
  | {
      [exerciseId: string]: GradebookMark;
    }
  | undefined;

/** Processed marks data structure returned from server */
export interface MarksPageData {
  studentMarksByExerciseId: StudentMarksByExercise;
  exercises: ExerciseInfo[];
  students: CourseMembers;
}

/**
 * Calculate total points for a student from their exercise data
 * @param studentExerciseData Student's marks by exercise ID
 * @returns Total points as number
 */
export function calculateStudentTotal(studentExerciseData: StudentExerciseData): number {
  if (!studentExerciseData) return 0;

  // Number() keeps fractional marks intact (parseInt would truncate "2.5" to 2).
  return Object.values(studentExerciseData).reduce((total: number, mark) => {
    const points = Number(mark.score);
    return total + (Number.isFinite(points) ? points : 0);
  }, 0);
}

/**
 * Calculate average grade as percentage (points earned / total points possible) for a student
 * @param studentExerciseData Student's marks by exercise ID
 * @param exercises Ordered list of exercises with points
 * @returns Rounded percentage 0-100, or null if no exercises with points
 */
export function calculateStudentAverage(
  studentExerciseData: StudentExerciseData,
  exercises: ExerciseInfo[]
): number | null {
  if (!studentExerciseData || exercises.length === 0) return null;
  const totalPossible = exercises.reduce((sum, exercise) => {
    const mark = studentExerciseData[exercise.id];
    const maxPoints = mark?.maxPoints ?? exercise.points;
    return sum + (Number.isFinite(maxPoints) && maxPoints > 0 ? maxPoints : 0);
  }, 0);
  if (totalPossible === 0) return null;
  // Number() keeps fractional marks intact (parseInt would truncate "2.5" to 2).
  const totalEarned = exercises.reduce((sum, exercise) => {
    const points = Number(studentExerciseData[exercise.id]?.score);
    return sum + (Number.isFinite(points) ? points : 0);
  }, 0);
  return Math.round((totalEarned / totalPossible) * 100);
}

/**
 * Percentage for a single gradebook cell using its immutable attempted maximum.
 * @param mark Selected completed attempt returned by the gradebook API
 * @returns Rounded percentage, or null when the score or maximum is unusable
 */
export function gradePercent(mark: GradebookMark | undefined): number | null {
  if (!mark || !Number.isFinite(mark.maxPoints) || mark.maxPoints <= 0) return null;

  // Number() keeps fractional marks intact (parseInt would truncate "2.5" to 2).
  const points = Number(mark.score);
  if (!Number.isFinite(points)) return null;

  return Math.round((points / mark.maxPoints) * 100);
}

/**
 * Transform marks array into nested object structure mapping groupMemberId -> exerciseId -> points
 * @param marks Array of mark records from API
 * @returns Nested object structure for student marks
 */
export function processMarksIntoStudentMarksByExerciseId(marks: Marks): StudentMarksByExercise {
  const result: StudentMarksByExercise = {};

  if (!Array.isArray(marks)) return result;

  marks.forEach((mark) => {
    const { exerciseId, exercisePoints, groupmemberId, totalPointsGotten } = mark;

    if (!groupmemberId || !exerciseId) return;

    const gradebookMark = {
      score: totalPointsGotten?.toString() || '0',
      maxPoints: exercisePoints
    };

    if (result[groupmemberId]) {
      result[groupmemberId] = {
        ...result[groupmemberId],
        [exerciseId]: gradebookMark
      };
    } else {
      result[groupmemberId] = {
        [exerciseId]: gradebookMark
      };
    }
  });

  return result;
}

/**
 * Build ordered list of exercises for gradebook from course content and marks.
 * When contentItems has no exercises (e.g. course fetch failed), derives order from marks.
 * @param marks Array of mark records from API
 * @param contentItems Flat or section-flattened content items (lesson + exercise) in display order; may be empty
 * @returns Ordered ExerciseInfo[] (exercise id, title, points)
 */
export function processMarksIntoExercises(marks: Marks, contentItems: CourseContentItem[]): ExerciseInfo[] {
  // Header points come from `activeExercisePoints` (identical on every row of an
  // exercise), never from a row's historical `exercisePoints`: after a question is
  // archived, submission rows carry diverging historical maxima and first-row-wins
  // would show an arbitrary student's denominator in the column header.
  const marksByExerciseId = new Map<string, { title: string; points: number }>();
  const exerciseOrder: string[] = [];
  if (Array.isArray(marks)) {
    marks.forEach((mark) => {
      const { exerciseId, exerciseTitle, activeExercisePoints } = mark;
      if (!exerciseId) return;
      if (!marksByExerciseId.has(exerciseId)) {
        exerciseOrder.push(exerciseId);
        marksByExerciseId.set(exerciseId, {
          title: exerciseTitle || '',
          points: activeExercisePoints ?? 0
        });
      }
    });
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

  // No course content (e.g. course fetch failed): use exercises from marks, order by first appearance
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
 * Generate and download CSV export of marks (student by exercise + avg grade)
 * @param students Array of students
 * @param exercises Ordered exercises
 * @param studentMarksByExerciseId Student marks by exercise
 * @param courseTitle Course title for filename
 */
export function generateMarksCSV(
  students: CourseMembers,
  exercises: ExerciseInfo[],
  studentMarksByExerciseId: StudentMarksByExercise,
  courseTitle: string
): void {
  const exportData = students.map((student) => {
    const marks = studentMarksByExerciseId[student.id] || {};
    const rowData: Record<string, string | number> = {
      name: student.profile?.fullname || '',
      email: student.profile?.email || ''
    };
    exercises.forEach((ex) => {
      rowData[ex.title] = marks[ex.id]?.score ?? '-';
    });
    const avg = calculateStudentAverage(marks, exercises);
    rowData['Avg grade'] = avg != null ? avg : '-';
    return rowData;
  });

  const csv = Papa.unparse(exportData);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `${courseTitle}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Generate and download PDF export of marks (student by exercise + avg grade)
 * @param students Array of students
 * @param exercises Ordered exercises
 * @param studentMarksByExerciseId Student marks by exercise
 * @param courseTitle Course title for filename and header
 */
export async function generateMarksPDF(
  students: CourseMembers,
  exercises: ExerciseInfo[],
  studentMarksByExerciseId: StudentMarksByExercise,
  courseTitle: string
): Promise<void> {
  try {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable')
    ]);

    const doc = new jsPDF({ orientation: 'landscape' });
    const head = [['Student', ...exercises.map((ex) => ex.title), 'Avg grade']];

    const body = students.map((student) => {
      const marks = studentMarksByExerciseId[student.id] || {};
      const row: string[] = [student?.profile?.fullname ?? ''];
      exercises.forEach((ex) => {
        row.push(marks[ex.id]?.score ?? '-');
      });
      const avg = calculateStudentAverage(marks, exercises);
      row.push(avg != null ? String(avg) : '-');
      return row;
    });

    autoTable(doc, {
      head,
      body,
      startY: 20,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [22, 160, 133] },
      footStyles: { fillColor: [22, 160, 133] },
      didDrawPage: function (data) {
        doc.setFontSize(14);
        doc.setTextColor(40);
        doc.text(`${courseTitle} - Marks`, data.settings.margin.left, 10);
      }
    });
    doc.save(`${courseTitle}-marks.pdf`);
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw error;
  }
}

/**
 * One row per student, one column per exercise (cell = that exercise's score),
 * plus an average column. Feeds the shared export pipeline; headers arrive
 * translated. Cells read the GradebookMark score this fork's gradebook returns.
 */
export function buildMarksExportDocument(
  students: CourseMembers,
  exercises: ExerciseInfo[],
  studentMarksByExerciseId: StudentMarksByExercise,
  courseTitle: string,
  headers: { name: string; email: string; averageGrade: string }
): ExportDocument<CourseMembers[number]> {
  const exerciseColumns: ExportColumn<CourseMembers[number]>[] = exercises.map((exercise) => ({
    key: exercise.id,
    header: exercise.title,
    value: (student) => studentMarksByExerciseId[student.id]?.[exercise.id]?.score ?? null
  }));

  return {
    filename: `${courseTitle}-marks`,
    title: `${courseTitle} — ${headers.averageGrade}`,
    columns: [
      { key: 'name', header: headers.name, value: (student) => student.profile?.fullname ?? '' },
      { key: 'email', header: headers.email, value: (student) => student.profile?.email ?? '' },
      ...exerciseColumns,
      {
        key: 'average',
        header: headers.averageGrade,
        value: (student) => calculateStudentAverage(studentMarksByExerciseId[student.id] || {}, exercises)
      }
    ],
    rows: students
  };
}
