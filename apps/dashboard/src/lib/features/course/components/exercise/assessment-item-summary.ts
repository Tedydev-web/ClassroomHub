/**
 * How many questions a composite item actually asks.
 *
 * One row in the authoring list is one item, and an item imported from an exam paper
 * commonly holds a passage plus six blanks. Counting rows therefore reports a forty
 * question paper as ten questions — the count is not wrong by a little, it is measuring a
 * different thing, and it disagrees with the section headings the same import wrote
 * ("...from 1 to 6").
 *
 * An item with no interaction block is still one thing a learner is asked, so it counts as
 * one rather than zero.
 */
export function countAssessmentQuestions(question: {
  definition?: { blocks?: readonly { kind: string }[] } | null;
}): number {
  const blocks = question.definition?.blocks;

  if (!Array.isArray(blocks)) return 1;

  const interactions = blocks.filter((block) => block.kind === 'interaction').length;

  return interactions > 0 ? interactions : 1;
}

/** The questions a section asks, counting what is inside each composite item. */
export function countSectionQuestions(
  legacyQuestionCount: number,
  canonicalQuestions: readonly { definition?: { blocks?: readonly { kind: string }[] } | null }[]
): number {
  return canonicalQuestions.reduce(
    (total, question) => total + countAssessmentQuestions(question),
    legacyQuestionCount
  );
}
