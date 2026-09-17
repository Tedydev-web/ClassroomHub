/**
 * Whether an exercise has changes that would be lost by leaving.
 *
 * This is what decides if a teacher is stopped by the unsaved-changes dialog, and it was a
 * closure over the questionnaire store, so the rules could only be checked by driving the
 * screen. Three of them are easy to trip over:
 *
 * - A **temporary id** counts as a change — except on a draft nobody has touched. Ids minted in
 *   the browser carry `-form`. The exercise page adds a blank question by itself whenever its
 *   legacy list is empty, which is every imported exam, because imports are canonical-only. So
 *   counting that draft stopped a teacher with the leave dialog on exercises where nothing had
 *   changed at all. An empty question loses no work when it is left behind; the rule is now
 *   "something was typed or chosen", not "something exists that the server has not seen".
 * - A **deleted** question or section counts as a change, because the deletion is the change.
 * - Options are checked as well as questions, so editing one choice of one question is enough.
 */

export interface DirtyFlaggable {
  id?: string | number;
  isDirty?: boolean;
  deletedAt?: string | null;
}

export interface DraftOptionLike extends DirtyFlaggable {
  label?: string | null;
  value?: string | null;
  isCorrect?: boolean;
}

export interface DraftQuestionLike extends DirtyFlaggable {
  title?: string | null;
  points?: number | string | null;
  answers?: Array<string | null> | null;
  settings?: Record<string, unknown> | null;
  options?: DraftOptionLike[];
}

export interface QuestionnaireLike {
  isTitleDirty?: boolean;
  isDescriptionDirty?: boolean;
  isDueByDirty?: boolean;
  questions?: DraftQuestionLike[];
  sections?: DirtyFlaggable[];
}

/**
 * The points a new question starts with. One, the way upstream creates a question: zero made
 * every new question on an auto-graded exercise invalid the instant it appeared. Shared with the
 * store so "untouched" cannot drift from what a fresh draft actually carries — which is exactly
 * how it broke before, when the default moved to one and this check still expected zero.
 */
export const NEW_QUESTION_POINTS = 1;

const UNTOUCHED_POINTS: ReadonlySet<number> = new Set([0, NEW_QUESTION_POINTS]);

/** Ids minted in the browser carry `-form`; anything else came back from the server. */
export function isTemporaryId(id: string | number | undefined): boolean {
  return typeof id === 'string' && id.includes('-form');
}

/** A question minted in the browser that nobody has typed into, chosen for, or marked. */
export function isUntouchedQuestionDraft(question: DraftQuestionLike): boolean {
  if (!isTemporaryId(question.id) || question.isDirty) return false;

  const hasTitle = `${question.title ?? ''}`.trim() !== '';
  // Zero was the default before it became one, and a draft saved to the browser under the old
  // default comes back carrying it. A question with no title, answer or option is no work either
  // way, so neither default counts as an edit.
  const hasChangedPoints = !UNTOUCHED_POINTS.has(Number(question.points ?? NEW_QUESTION_POINTS));
  const hasAnswer = (question.answers ?? []).some((answer) => answer !== null && `${answer}`.trim() !== '');
  const hasOptionContent = (question.options ?? []).some(
    (option) =>
      `${option.label ?? ''}`.trim() !== '' || `${option.value ?? ''}`.trim() !== '' || Boolean(option.isCorrect)
  );
  const hasSettings = Object.keys(question.settings ?? {}).length > 0;

  return !hasTitle && !hasChangedPoints && !hasAnswer && !hasOptionContent && !hasSettings;
}

export function hasDirtyQuestionnaire(questionnaire: QuestionnaireLike | null | undefined): boolean {
  if (!questionnaire) return false;

  const hasDirtyQuestion = (questionnaire.questions ?? []).some((question) => {
    if (isUntouchedQuestionDraft(question)) return false;

    const hasDirtyOption = (question.options ?? []).some((option) => option.isDirty || isTemporaryId(option.id));

    return question.isDirty || Boolean(question.deletedAt) || isTemporaryId(question.id) || hasDirtyOption;
  });

  const hasDirtySection = (questionnaire.sections ?? []).some(
    (section) => section.isDirty || Boolean(section.deletedAt)
  );

  return Boolean(
    questionnaire.isTitleDirty ||
      questionnaire.isDescriptionDirty ||
      questionnaire.isDueByDirty ||
      hasDirtyQuestion ||
      hasDirtySection
  );
}
