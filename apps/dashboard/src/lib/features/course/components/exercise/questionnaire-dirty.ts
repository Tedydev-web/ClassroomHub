/**
 * Whether an exercise has changes that would be lost by leaving.
 *
 * This is what decides if a teacher is stopped by the unsaved-changes dialog, and it was a
 * closure over the questionnaire store, so the rules could only be checked by driving the
 * screen. Three of them are easy to trip over:
 *
 * - A **temporary id** counts as a change. Ids minted in the browser carry `-form`, so adding
 *   a question makes the exercise dirty even before anything is typed into it. That is right —
 *   the empty question would be lost — but it means "I changed nothing" and "nothing is dirty"
 *   are not the same statement.
 * - A **deleted** question or section counts as a change, because the deletion is the change.
 * - Options are checked as well as questions, so editing one choice of one question is enough.
 */

export interface DirtyFlaggable {
  id?: string | number;
  isDirty?: boolean;
  deletedAt?: string | null;
}

export interface QuestionnaireLike {
  isTitleDirty?: boolean;
  isDescriptionDirty?: boolean;
  isDueByDirty?: boolean;
  questions?: Array<DirtyFlaggable & { options?: DirtyFlaggable[] }>;
  sections?: DirtyFlaggable[];
}

/** Ids minted in the browser carry `-form`; anything else came back from the server. */
export function isTemporaryId(id: string | number | undefined): boolean {
  return typeof id === 'string' && id.includes('-form');
}

export function hasDirtyQuestionnaire(questionnaire: QuestionnaireLike | null | undefined): boolean {
  if (!questionnaire) return false;

  const hasDirtyQuestion = (questionnaire.questions ?? []).some((question) => {
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
