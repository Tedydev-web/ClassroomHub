/**
 * One question of a sat paper, reduced to what correcting its key needs.
 *
 * The server sends one row per interaction rather than per item, because an item holding a
 * passage and six questions is six answers to a candidate and six keys to a teacher.
 *
 * Kept in its own module rather than inside the component that first needed it: the paper
 * tab and the correction buttons both take this shape, and a component file is not
 * somewhere another module can import a type from.
 */
export type AnswerKeyOption = { id: string; label: string; html: string };

export type AnswerKeyQuestion = {
  questionId: number;
  interactionId: string;
  /** The number printed beside this question, counted across the whole paper. */
  position: number;
  points: number;
  promptHtml: string;
  options: AnswerKeyOption[];
  /** The key in force right now: the frozen one, or the last correction to replace it. */
  effectiveKey: string[];
  cardinality: 'single' | 'multiple';
  /** A key can only be replaced where there is a key to replace. */
  keyFixable: boolean;
  questionsInItem: number;
  hasSeveralChoiceParts: boolean;
  awarded: boolean;
  corrected: boolean;
};
