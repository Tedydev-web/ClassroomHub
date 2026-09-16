/**
 * Where a learner goes after finishing a section.
 *
 * The decision and the acts that carry it out used to sit in one function in
 * `view-mode.svelte`, so the rules could only be checked by sitting an exercise. Two of them
 * are easy to get wrong and neither was written down:
 *
 * - `go_to_section` pointing at a section that is not there does **not** fail. It falls
 *   through to the next section, which is what a teacher who deleted a section would want.
 * - Running off the end of the section list submits the exercise. There is no "finished but
 *   not submitted" state to land in.
 *
 * Only the decision moves here. Updating the store, saving the draft and submitting stay in
 * the component, where they belong.
 */

export interface SectionAfterBehavior {
  action?: string | null;
  exerciseSectionId?: string | null;
}

export interface SectionLike {
  id: string;
}

export type SectionDestination = { action: 'submit' } | { action: 'go_to_section'; index: number };

/**
 * @param behavior what the current section says should happen next
 * @param sections the exercise's sections, in the order a learner meets them
 * @param currentIndex the section just finished
 */
export function resolveSectionAfterBehavior(
  behavior: SectionAfterBehavior | null | undefined,
  sections: SectionLike[],
  currentIndex: number
): SectionDestination {
  if (behavior?.action === 'submit') return { action: 'submit' };

  if (behavior?.action === 'go_to_section' && behavior.exerciseSectionId) {
    const targetIndex = sections.findIndex((section) => section.id === behavior.exerciseSectionId);

    // A named section that no longer exists falls through rather than trapping the learner.
    if (targetIndex >= 0) return { action: 'go_to_section', index: targetIndex };
  }

  const nextSectionIndex = currentIndex + 1;
  if (nextSectionIndex < sections.length) return { action: 'go_to_section', index: nextSectionIndex };

  return { action: 'submit' };
}
