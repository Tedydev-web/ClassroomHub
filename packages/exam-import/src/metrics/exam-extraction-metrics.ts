import { normalizeComparableText } from '../source-run';
import type { ExtractedExam, ReferenceExam, ReferenceQuestion } from './reference-exam';

/**
 * Scores an extraction against ground truth, one layer at a time.
 *
 * A metric is a number only when the layer it depends on has been verified by a
 * human. Otherwise it is `null` — never `0`, never `1`. Both of those would be
 * lies in opposite directions: `1` inflates an average over things nobody
 * checked, and `0` reports a failure that was never measured.
 */

export type ExtractionMetrics = {
  // -- from the structure layer --
  /** Reference questions the extractor found, by printed number. */
  questionRecall: number | null;
  /** Questions whose kind matches, over matched questions. */
  kindAccuracy: number | null;
  /** Questions whose set of co-grouped siblings matches the reference. */
  groupingAccuracy: number | null;
  /**
   * Questions whose option count matches. Cheap to state and unusually
   * discriminating: a reader that mis-assigns options across questions — the
   * failure a column-flattened layout provokes — gets the counts wrong even
   * when every individual option text is present somewhere in its output.
   */
  optionCountAccuracy: number | null;

  // -- from the answer key layer --
  /** Answer keys matching, over reference questions that state one. */
  answerKeyAccuracy: number | null;

  // -- from the option text layer --
  /** Options recovered at the right position, over all reference options. */
  optionFidelity: number | null;

  // -- from the review routing layer --
  /** Flagged extracted questions that genuinely require teacher review. */
  reviewPrecision: number | null;

  counts: {
    referenceQuestions: number;
    extractedQuestions: number;
    matchedQuestions: number;
    /** Extracted questions with no reference counterpart — invented content. */
    spuriousQuestions: number;
  };
  /** Printed numbers of reference questions the extractor did not produce. */
  missingQuestionNumbers: string[];
  /** Numbers whose option count disagrees, with both values, for triage. */
  optionCountMismatches: Array<{ number: string; expected: number; actual: number | null }>;
};

function rate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;

  return numerator / denominator;
}

function sameTextList(expected: string[], actual: string[]): number {
  let matched = 0;
  for (let index = 0; index < expected.length; index++) {
    const actualText = actual[index];
    if (actualText === undefined) continue;

    if (normalizeComparableText(expected[index]!) === normalizeComparableText(actualText)) {
      matched++;
    }
  }

  return matched;
}

/** Answer keys are compared as sets: option order carries no meaning for a key. */
function sameAnswerKey(expected: string[], actual: string[]): boolean {
  if (expected.length !== actual.length) return false;

  const normalize = (keys: string[]) => keys.map(normalizeComparableText).sort();
  const expectedKeys = normalize(expected);
  const actualKeys = normalize(actual);

  return expectedKeys.every((key, index) => key === actualKeys[index]);
}

/**
 * Group labels are arbitrary, so grouping is scored on the partition rather
 * than the label. For each question, the set of other question numbers sharing
 * its group must match. An ungrouped question must stay ungrouped.
 */
function siblingNumbers(questions: ReferenceQuestion[], target: ReferenceQuestion): Set<string> {
  if (target.groupId === null) return new Set();

  return new Set(
    questions
      .filter((question) => question.groupId === target.groupId && question.number !== target.number)
      .map((question) => question.number)
  );
}

function sameSiblings(expected: Set<string>, actual: Set<string>): boolean {
  if (expected.size !== actual.size) return false;

  for (const value of expected) {
    if (!actual.has(value)) return false;
  }

  return true;
}

export function scoreExtraction(reference: ReferenceExam, extracted: ExtractedExam): ExtractionMetrics {
  const referenceQuestions = reference.questions;
  const extractedByNumber = new Map(extracted.questions.map((question) => [question.number, question]));
  const scoresStructure = reference.coverage.structure === 'verified';
  const scoresKeys = reference.coverage.answerKeys === 'verified';
  const scoresText = reference.coverage.optionText === 'verified';
  const scoresReviewRouting = reference.coverage.reviewRouting === 'verified';

  let matchedQuestions = 0;
  let matchedKinds = 0;
  let comparableKinds = 0;
  let matchedOptionCounts = 0;
  let comparableOptionCounts = 0;
  let matchedOptions = 0;
  let totalReferenceOptions = 0;
  let keyedQuestions = 0;
  let correctKeys = 0;
  let correctGroupings = 0;
  const missingQuestionNumbers: string[] = [];
  const optionCountMismatches: ExtractionMetrics['optionCountMismatches'] = [];

  for (const expected of referenceQuestions) {
    if (expected.options !== null) totalReferenceOptions += expected.options.length;
    if (expected.answerKey !== null) keyedQuestions++;

    const actual = extractedByNumber.get(expected.number);
    if (!actual) {
      missingQuestionNumbers.push(expected.number);
      if (expected.optionCount !== null) {
        comparableOptionCounts++;
        optionCountMismatches.push({ number: expected.number, expected: expected.optionCount, actual: null });
      }
      continue;
    }

    matchedQuestions++;

    if (expected.kind !== null) {
      comparableKinds++;
      if (actual.kind === expected.kind) matchedKinds++;
    }

    if (expected.optionCount !== null) {
      comparableOptionCounts++;
      const actualCount = actual.optionCount ?? actual.options?.length ?? null;
      if (actualCount === expected.optionCount) {
        matchedOptionCounts++;
      } else {
        optionCountMismatches.push({ number: expected.number, expected: expected.optionCount, actual: actualCount });
      }
    }

    if (expected.options !== null && actual.options !== null) {
      matchedOptions += sameTextList(expected.options, actual.options);
    }

    if (
      expected.answerKey !== null &&
      actual.answerKey !== null &&
      sameAnswerKey(expected.answerKey, actual.answerKey)
    ) {
      correctKeys++;
    }

    const expectedSiblings = siblingNumbers(referenceQuestions, expected);
    const actualSiblings = siblingNumbers(extracted.questions, actual);
    if (sameSiblings(expectedSiblings, actualSiblings)) correctGroupings++;
  }

  const spuriousQuestions = extracted.questions.filter(
    (question) => !referenceQuestions.some((expected) => expected.number === question.number)
  ).length;
  const flaggedQuestions = extracted.questions.filter((question) => question.reviewRequired === true);
  const correctlyFlaggedQuestions = flaggedQuestions.filter(
    (question) => referenceQuestions.find((expected) => expected.number === question.number)?.reviewRequired === true
  ).length;

  return {
    questionRecall: scoresStructure ? rate(matchedQuestions, referenceQuestions.length) : null,
    kindAccuracy: scoresStructure ? rate(matchedKinds, comparableKinds) : null,
    groupingAccuracy: scoresStructure ? rate(correctGroupings, referenceQuestions.length) : null,
    optionCountAccuracy: scoresStructure ? rate(matchedOptionCounts, comparableOptionCounts) : null,
    answerKeyAccuracy: scoresKeys ? rate(correctKeys, keyedQuestions) : null,
    optionFidelity: scoresText ? rate(matchedOptions, totalReferenceOptions) : null,
    reviewPrecision: scoresReviewRouting ? rate(correctlyFlaggedQuestions, flaggedQuestions.length) : null,
    counts: {
      referenceQuestions: referenceQuestions.length,
      extractedQuestions: extracted.questions.length,
      matchedQuestions,
      spuriousQuestions
    },
    missingQuestionNumbers,
    optionCountMismatches
  };
}

function formatRate(value: number | null): string {
  return value === null ? 'not measured' : `${(value * 100).toFixed(1)}%`;
}

/**
 * Report for a corpus run. Names the unverified layers first, because a reader
 * of these numbers must know what was not measured before reading what was.
 */
export function formatMetrics(reference: ReferenceExam, metrics: ExtractionMetrics): string {
  const unverified = (Object.keys(reference.coverage) as Array<keyof typeof reference.coverage>).filter(
    (layer) => reference.coverage[layer] !== 'verified'
  );

  return [
    `document            : ${reference.document}`,
    `unverified layers   : ${unverified.length === 0 ? 'none' : unverified.join(', ')}`,
    `question recall     : ${formatRate(metrics.questionRecall)} (${metrics.counts.matchedQuestions}/${metrics.counts.referenceQuestions})`,
    `kind accuracy       : ${formatRate(metrics.kindAccuracy)}`,
    `grouping accuracy   : ${formatRate(metrics.groupingAccuracy)}`,
    `option count acc.   : ${formatRate(metrics.optionCountAccuracy)}`,
    `answer-key accuracy : ${formatRate(metrics.answerKeyAccuracy)}`,
    `option fidelity     : ${formatRate(metrics.optionFidelity)}`,
    `review precision    : ${formatRate(metrics.reviewPrecision)}`,
    `spurious questions  : ${metrics.counts.spuriousQuestions}`,
    `missing             : ${metrics.missingQuestionNumbers.join(', ') || 'none'}`,
    `option count misses : ${
      metrics.optionCountMismatches.map((m) => `Q${m.number} want ${m.expected} got ${m.actual ?? '-'}`).join('; ') ||
      'none'
    }`
  ].join('\n');
}
