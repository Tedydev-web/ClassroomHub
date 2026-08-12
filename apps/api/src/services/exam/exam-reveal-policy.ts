/**
 * When a learner may see their score, the paper with its answers, or the teacher's
 * comments. Three independent settings share these four values, because returning
 * marked work with the comments visible and the mark withheld is an ordinary thing
 * for a teacher to want.
 *
 * Every decision is taken here, on the server. The browser is told what it may show,
 * never trusted to decide.
 */

export type ExamRevealValue = 'never' | 'on_submit' | 'after_everyone' | 'above_threshold';

export type ExamRevealContext = {
  now: Date;
  attempt: {
    status: 'in_progress' | 'submitted' | 'expired';
    gradingState: 'complete' | 'awaiting_manual' | 'unscoreable';
    score: string | null;
    total: string | null;
  };
  exam: {
    closesAt: string | null;
    workingSeconds: number | null;
    revealThreshold: string | null;
  };
};

function isFinished(attempt: ExamRevealContext['attempt']): boolean {
  return attempt.status === 'submitted' || attempt.status === 'expired';
}

/**
 * The last sitter cannot have finished before the window closed plus a full working
 * time, since somebody entering at the last moment still gets their clock.
 *
 * Both parts are required. With only one, there is no moment that can be computed, and
 * the honest answer is "not yet" rather than "now" — opening a paper early because it
 * was configured incompletely is the failure this guards against.
 */
function everyoneHasFinished(context: ExamRevealContext): boolean {
  const { closesAt, workingSeconds } = context.exam;
  if (!closesAt || workingSeconds === null) return false;

  const lastPossibleFinish = new Date(closesAt).getTime() + workingSeconds * 1000;
  return context.now.getTime() > lastPossibleFinish;
}

/**
 * A partial score is not a score. An attempt still awaiting a teacher's marks is
 * measured on its automatic portion alone, which would let a paper cross the threshold
 * it has not actually earned, so it does not qualify until marking is complete.
 */
function scoredAtOrAbove(context: ExamRevealContext): boolean {
  const { revealThreshold } = context.exam;
  const { gradingState, score, total } = context.attempt;

  if (!revealThreshold || gradingState !== 'complete') return false;
  if (score === null || total === null) return false;

  const totalValue = Number(total);
  if (!Number.isFinite(totalValue) || totalValue <= 0) return false;

  const ratio = Number(score) / totalValue;
  return Number.isFinite(ratio) && ratio >= Number(revealThreshold);
}

export function isRevealed(value: ExamRevealValue, context: ExamRevealContext): boolean {
  if (value === 'never') return false;

  // Nothing is revealed to somebody still sitting the paper, whatever the setting says.
  if (!isFinished(context.attempt)) return false;

  switch (value) {
    case 'on_submit':
      return true;
    case 'after_everyone':
      return everyoneHasFinished(context);
    case 'above_threshold':
      return scoredAtOrAbove(context);
  }
}

/**
 * Whether a stored configuration can ever fire. `after_everyone` without both a closing
 * time and a working time, or `above_threshold` without a threshold, is a setting that
 * silently means "never" — so it is refused at the point of saving rather than left to
 * disappoint a teacher who thinks they have released something.
 */
export function revealConfigurationIssue(
  value: ExamRevealValue,
  exam: Pick<ExamRevealContext['exam'], 'closesAt' | 'workingSeconds' | 'revealThreshold'>
): string | null {
  if (value === 'after_everyone' && (!exam.closesAt || exam.workingSeconds === null)) {
    return 'Showing this once everyone has finished needs both a closing time and a working time';
  }

  if (value === 'above_threshold' && !exam.revealThreshold) {
    return 'Showing this above a threshold needs the threshold to be set';
  }

  return null;
}
