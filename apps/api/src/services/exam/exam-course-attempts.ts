import { db } from '@cio/db/drizzle';
import * as schema from '@cio/db/schema';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

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
  /** How many times the paper stopped being the visible window on their device. */
  leaves: number;
  duplicateName: boolean;
  duplicateAddress: boolean;
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
      submittedAt: schema.examAttempt.submittedAt,
      ipHash: schema.examAttempt.ipHash,
      // Counted in the database, as the per-exam list counts it: the log itself is never
      // selected here, and one integer is all a teacher needs to choose who to read first.
      leaves: sql<number>`(
        select count(*)::int
        from jsonb_array_elements(${schema.examAttempt.activityLog}) as event
        where event->>'kind' = 'left'
      )`
    })
    .from(schema.examAttempt)
    .innerJoin(schema.exam, eq(schema.exam.id, schema.examAttempt.examId))
    // A deleted exam keeps its attempts, and a teacher who deleted the paper is not asking
    // to see them on the course overview.
    .where(and(eq(schema.exam.courseId, courseId), isNull(schema.exam.deletedAt)))
    .orderBy(desc(schema.examAttempt.startedAt));

  /**
   * Duplicates are counted within a paper, never across the course.
   *
   * Two candidates of the same name sitting two different papers is a class with two
   * Nguyễn Văn A in it, which is ordinary. Two of them on the *same* paper is the thing a
   * teacher wants flagged, and the same argument holds for an address.
   */
  const names = new Map<string, number>();
  const addresses = new Map<string, number>();

  for (const row of rows) {
    const name = row.displayName?.trim().toLowerCase();

    if (name) names.set(`${row.examId}:${name}`, (names.get(`${row.examId}:${name}`) ?? 0) + 1);
    if (row.ipHash)
      addresses.set(`${row.examId}:${row.ipHash}`, (addresses.get(`${row.examId}:${row.ipHash}`) ?? 0) + 1);
  }

  return rows.map(({ ipHash, ...row }) => ({
    ...row,
    duplicateName: Boolean(
      row.displayName && (names.get(`${row.examId}:${row.displayName.trim().toLowerCase()}`) ?? 0) > 1
    ),
    duplicateAddress: Boolean(ipHash && (addresses.get(`${row.examId}:${ipHash}`) ?? 0) > 1)
  })) as CourseAttemptRow[];
}
