/**
 * Who sat the paper, how far they got, and what they scored.
 *
 * The status words are the ones Vietnamese teachers already read in Azota, with one
 * deliberate exception. Azota's `chưa nộp bài` means a student who left **before** time
 * was up and may still come back; ours would mean the clock ran out, which is the
 * opposite situation. Borrowing the phrase would teach the wrong thing precisely because
 * it is already familiar, so the expired case says `hết giờ (chưa nộp)` instead.
 *
 * Kept beside the table rather than inside it: the tab that owns the fetching needs the
 * same shape, and a component file is not somewhere another module can import a type from.
 */
export type ExamResultRow = {
  attemptId: string;
  displayName: string | null;
  nickname?: string | null;
  className: string | null;
  candidateNumber: string | null;
  status: 'in_progress' | 'submitted' | 'expired';
  gradingState: 'complete' | 'awaiting_manual' | 'unscoreable';
  score: string | null;
  total: string | null;
  startedAt: string;
  submittedAt: string | null;
  duplicateName: boolean;
  duplicateAddress: boolean;
  /** How many times the paper stopped being the visible window on their device. */
  leaves: number;
  /**
   * Which paper this sitting belongs to, on the views that hold more than one.
   *
   * Absent on an exam's own results, where every row is the same paper and a column naming
   * it forty times would say nothing. Present on the course's list, which is where a
   * teacher is looking across papers and the title is the thing that tells rows apart.
   */
  examId?: string;
  examTitle?: string | null;
};
