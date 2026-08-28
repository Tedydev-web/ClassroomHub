import { classroomhub } from '$lib/utils/services/api';

/**
 * The course's exams, loaded once for the sidebar.
 *
 * Two things read this — the count beside "Content" and the list under it — and they must
 * agree. Fetching in each of them would mean two requests per course view and, worse, two
 * answers whenever one of them was mid-flight.
 */

export type SidebarExam = { id: string; title: string; status: string };

export class CourseExams {
  exams = $state<SidebarExam[]>([]);
  /**
   * Whether the feature answered at all. Exams sit behind a server flag; where it is off
   * every route replies 404, and the difference between "no exams" and "no such feature"
   * is the difference between an empty list and no list.
   */
  available = $state(false);
  #loadedCourseId: string | null = null;

  async load(courseId: string): Promise<void> {
    if (this.#loadedCourseId === courseId) return;
    this.#loadedCourseId = courseId;

    try {
      const response = await classroomhub.exam.course[':courseId'].$get({ param: { courseId } });
      const body = await response.json();

      if ('success' in body && body.success) {
        this.exams = body.data.map((exam) => ({ id: exam.id, title: exam.title, status: exam.status }));
        this.available = true;

        return;
      }

      this.available = false;
    } catch {
      this.available = false;
    }
  }

  /** Called after an exam is created, deleted or restored elsewhere in the app. */
  async refresh(courseId: string): Promise<void> {
    this.#loadedCourseId = null;
    await this.load(courseId);
  }
}

export const courseExams = new CourseExams();
