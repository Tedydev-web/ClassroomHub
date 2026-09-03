import { db } from '@cio/db/drizzle';
import * as schema from '@cio/db/schema';
import { and, desc, eq, isNull } from 'drizzle-orm';

/**
 * Every sitting handed in across one course, newest first.
 *
 * The Submissions page answers one question — what did the learners hand in — and until
 * now its exam tab answered a different one, listing the papers themselves, which is what
 * the exam list page is for. This is the exam half of that page's actual subject.
 *
 * Deliberately a pure read. `listExamResultsService` finalises expired attempts and scores
 * unmarked ones before it returns, which is right for one exam a teacher just opened and
 * wrong here: this list would run that pass over every exam in the course, including one
 * being sat at that moment, every time somebody refreshes an overview page. A row that is
 * still `in_progress` here is shown as such, and opening the exam does the authoritative
 * pass. Do not add finalisation to this.
 *
 * Because it does not finalise, a sitting whose clock ran out is still stored as
 * `in_progress` until somebody opens that exam. `expiresAt` comes with each row so the
 * reader can say so honestly instead of calling a paper from last week ongoing.
 *
 * It also carries no `duplicateName` or `duplicateAddress`. Those are computed by
 * comparing candidates against each other within a single sitting; across a course they
 * would flag two people who never sat the same paper.
 */

export type CourseAttemptRow = {
  attemptId: string;
  examId: string;
  examTitle: string;
  displayName: string | null;
  nickname: string | null;
  className: string | null;
  candidateNumber: string | null;
  status: 'in_progress' | 'submitted' | 'expired';
  /** Null when the paper was untimed. Carried so a reader can tell a stale row apart. */
  expiresAt: string | null;
  gradingState: 'complete' | 'awaiting_manual' | 'unscoreable';
  score: string | null;
  total: string | null;
  startedAt: string;
  submittedAt: string | null;
};

export async function listCourseAttemptsService(courseId: string): Promise<CourseAttemptRow[]> {
  const rows = await db
    .select({
      attemptId: schema.examAttempt.id,
      examId: schema.exam.id,
      examTitle: schema.exam.title,
      displayName: schema.examAttempt.displayName,
      nickname: schema.examAttempt.nickname,
      className: schema.examAttempt.className,
      candidateNumber: schema.examAttempt.candidateNumber,
      status: schema.examAttempt.status,
      expiresAt: schema.examAttempt.expiresAt,
      gradingState: schema.examAttempt.gradingState,
      score: schema.examAttempt.score,
      total: schema.examAttempt.total,
      startedAt: schema.examAttempt.startedAt,
      submittedAt: schema.examAttempt.submittedAt
    })
    .from(schema.examAttempt)
    .innerJoin(schema.exam, eq(schema.exam.id, schema.examAttempt.examId))
    // A deleted exam keeps its attempts, and a teacher who deleted the paper is not asking
    // to see them on the course overview.
    .where(and(eq(schema.exam.courseId, courseId), isNull(schema.exam.deletedAt)))
    .orderBy(desc(schema.examAttempt.startedAt));

  return rows as CourseAttemptRow[];
}
