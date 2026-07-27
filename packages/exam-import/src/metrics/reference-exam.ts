import * as z from 'zod';

/**
 * The ground truth for one corpus document, and the shape any extractor is
 * scored against.
 *
 * Ground truth is built in layers, not in one pass. The layers differ by an
 * order of magnitude in what they cost to establish and in what they catch, so
 * treating them as one all-or-nothing artefact stalls the work for weeks before
 * the first measurement exists:
 *
 * - `structure` — how many questions, their numbers, their kinds, which share a
 *   passage, how many options each has. Cheap to state, cheap to check by eye,
 *   and it is what separates a working reader from a broken one.
 * - `answerKeys` — one letter per question. Short, and the one thing that must
 *   never be wrong. Many real papers state no key at all, which is a fact about
 *   the source, not a gap in the labelling.
 * - `optionText` — the wording of every option. Expensive, and on a
 *   scan-converted document it measures the wrong thing: the source text is
 *   already damaged, so exact match rewards reproducing the damage. Worth doing
 *   on cleanly authored documents, not on OCR output.
 * - `reviewRouting` — whether the extracted question genuinely requires a
 *   teacher correction or confirmation.
 *
 * A layer that is not `verified` is not scored. The harness reports `null` for
 * its metrics rather than a number, so partial ground truth produces partial
 * measurement instead of a confident average over things nobody checked.
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

/**
 * How a layer came to be.
 *
 * `proposed` is a first-class state, not a lesser one. Machine-proposed labels
 * are standard practice and are what make labelling affordable; what makes them
 * ground truth is a human confirming them. The distinction that matters is not
 * who typed the value but whether a person has checked it, so the state is
 * recorded per layer and scoring keys off it.
 *
 * The one prohibition: a proposal must not come from the extractor under test.
 * Deriving it by an independent route — a raw structural pass, a different tool,
 * the printed paper — keeps the measurement honest.
 */
export const LABEL_STATES = ['unlabelled', 'proposed', 'verified'] as const;
export type LabelState = (typeof LABEL_STATES)[number];

const labelStateSchema = z.enum(LABEL_STATES);

export const referenceCoverageSchema = z.strictObject({
  structure: labelStateSchema,
  answerKeys: labelStateSchema,
  optionText: labelStateSchema,
  reviewRouting: labelStateSchema
});

export type ReferenceCoverage = z.infer<typeof referenceCoverageSchema>;

const referenceQuestionSchema = z.strictObject({
  /** The number as printed — `"1"`, `"12"`. The key questions are matched on. */
  number: z.string().min(1),

  // -- structure layer --
  kind: z.enum(REFERENCE_QUESTION_KINDS).nullable(),
  /**
   * Identifier shared by questions depending on the same passage or content
   * block; `null` when the question stands alone. Labels are arbitrary —
   * scoring compares the partition they induce, never the label text.
   */
  groupId: z.string().nullable(),
  /** How many options the question offers. Catches mis-assigned options. */
  optionCount: z.number().int().min(0).nullable(),

  // -- answer key layer --
  /**
   * Correct option labels — `["C"]`, or `["a","c"]` for a true/false group.
   * When the `answerKeys` layer is verified, `null` states that the source
   * document contains no key for this question. When it is not verified, the
   * field carries no meaning and is not scored.
   */
  answerKey: z.array(z.string()).nullable(),

  // -- option text layer --
  prompt: z.string().nullable(),
  options: z.array(z.string()).nullable(),

  // -- review routing layer --
  reviewRequired: z.boolean().nullable()
});

export type ReferenceQuestion = z.infer<typeof referenceQuestionSchema>;

export const referenceExamSchema = z.strictObject({
  /** Corpus document this describes, relative to the corpus root. */
  document: z.string().min(1),
  note: z.string(),
  coverage: referenceCoverageSchema,
  /** How each layer was established, for anyone auditing the numbers later. */
  provenance: z.string(),
  questions: z.array(referenceQuestionSchema)
});

export type ReferenceExam = z.infer<typeof referenceExamSchema>;

/** What an extractor produces for scoring: the same question shape. */
export type ExtractedExam = {
  questions: ReferenceQuestion[];
};

export class UnscoreableReferenceError extends Error {
  constructor(reference: ReferenceExam, reason: string) {
    super(`Reference for "${reference.document}" cannot be scored: ${reason}`);
    this.name = 'UnscoreableReferenceError';
  }
}

/**
 * Refuses a reference that would produce a number meaning nothing. Both cases
 * would otherwise score as a clean 100% while measuring nothing at all.
 */
export function assertReferenceIsScoreable(reference: ReferenceExam): void {
  if (reference.questions.length === 0) {
    throw new UnscoreableReferenceError(reference, 'it contains no questions');
  }

  const verifiedLayers = Object.values(reference.coverage).filter((state) => state === 'verified');
  if (verifiedLayers.length === 0) {
    throw new UnscoreableReferenceError(reference, 'no layer has been verified by a human');
  }
}

/** Layers a human still has to confirm, for a corpus run to report honestly. */
export function pendingLayers(reference: ReferenceExam): Array<keyof ReferenceCoverage> {
  return (Object.keys(reference.coverage) as Array<keyof ReferenceCoverage>).filter(
    (layer) => reference.coverage[layer] !== 'verified'
  );
}
