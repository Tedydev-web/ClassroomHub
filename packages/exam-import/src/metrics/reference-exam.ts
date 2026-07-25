import * as z from 'zod';

/**
 * The hand-written ground truth for one corpus document, and the shape any
 * extractor is scored against.
 *
 * It is deliberately not the draft representation. The draft will change shape
 * many times while the reader improves; the references are written once by hand
 * and must not have to be rewritten every time an internal type moves. An
 * adapter projects a draft onto this shape for scoring.
 */

export const REFERENCE_QUESTION_KINDS = [
  'choice',
  'true_false_group',
  'short_answer',
  'numeric',
  'essay',
  'ordering'
] as const;

export type ReferenceQuestionKind = (typeof REFERENCE_QUESTION_KINDS)[number];

const referenceQuestionSchema = z.strictObject({
  /** The number as printed in the document — `"1"`, `"12"`. Matching key. */
  number: z.string().min(1),
  kind: z.enum(REFERENCE_QUESTION_KINDS),
  /** Prompt as plain text; formatting and markup are not scored. */
  prompt: z.string(),
  /** Option texts in printed order. Empty for kinds that have no options. */
  options: z.array(z.string()),
  /**
   * Option labels that are correct — `["C"]`, or `["a","c"]` for a true/false
   * group's true statements.
   *
   * `null` means the source document states no answer, which is common and is
   * not an extraction failure. Such questions are excluded from answer-key
   * accuracy instead of counting as misses.
   */
  answerKey: z.array(z.string()).nullable(),
  /**
   * Identifier shared by questions that depend on the same passage or content
   * block. Labels are arbitrary: scoring compares the partition they induce,
   * never the label text.
   */
  groupId: z.string().nullable()
});

export type ReferenceQuestion = z.infer<typeof referenceQuestionSchema>;

export const referenceExamSchema = z.strictObject({
  /** Corpus document this describes, relative to the corpus root. */
  document: z.string().min(1),
  /** Free-text note on what makes this document interesting to the corpus. */
  note: z.string(),
  /**
   * Whether a human has read the source document and confirmed every question
   * below. Ground truth produced or pre-filled by the extractor is circular: it
   * would score the reader against its own output and report agreement as
   * accuracy. An unverified reference is never scored — see
   * `assertReferenceIsScoreable`.
   */
  verified: z.boolean(),
  questions: z.array(referenceQuestionSchema)
});

export type ReferenceExam = z.infer<typeof referenceExamSchema>;

export class UnscoreableReferenceError extends Error {
  constructor(reference: ReferenceExam, reason: string) {
    super(`Reference for "${reference.document}" cannot be scored: ${reason}`);
    this.name = 'UnscoreableReferenceError';
  }
}

/**
 * Refuses a reference that would produce a meaningless number. Both cases below
 * would otherwise score as a clean 100% and hide the fact that nothing was
 * measured.
 */
export function assertReferenceIsScoreable(reference: ReferenceExam): void {
  if (!reference.verified) {
    throw new UnscoreableReferenceError(reference, 'it has not been verified by a human');
  }

  if (reference.questions.length === 0) {
    throw new UnscoreableReferenceError(reference, 'it contains no questions');
  }
}

/** What an extractor produces for scoring. Same shape, minus corpus metadata. */
export type ExtractedExam = {
  questions: ReferenceQuestion[];
};
