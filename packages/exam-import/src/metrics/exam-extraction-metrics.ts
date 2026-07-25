import { normalizeComparableText } from '../source-run';
import type { ExtractedExam, ReferenceExam, ReferenceQuestion } from './reference-exam';

/**
 * Scores an extraction against hand-written ground truth.
 *
 * Every rate is in `[0, 1]`, or `null` when the reference offers nothing to
 * measure. `null` rather than `1` matters: a corpus document with no answer key
 * would otherwise report perfect answer-key accuracy and quietly inflate the
 * aggregate, which is the specific way this kind of harness lies.
 */

export type ExtractionMetrics = {
  /** Reference questions the extractor found, by printed number. */
  questionRecall: number;
  /** Options recovered at the right position, over all reference options. */
  optionFidelity: number | null;
  /** Answer keys matching, over reference questions that state one. */
  answerKeyAccuracy: number | null;
  /** Questions whose set of co-grouped siblings matches the reference. */
  groupingAccuracy: number | null;
  /** Questions whose kind matches, over matched questions. */
  kindAccuracy: number | null;
  counts: {
    referenceQuestions: number;
    extractedQuestions: number;
    matchedQuestions: number;
    /** Extracted questions with no reference counterpart — invented content. */
    spuriousQuestions: number;
  };
  /** Printed numbers of reference questions the extractor did not produce. */
  missingQuestionNumbers: string[];
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
 * its group must match. An ungrouped question must remain ungrouped.
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

  let matchedQuestions = 0;
  let matchedKinds = 0;
  let matchedOptions = 0;
  let totalReferenceOptions = 0;
  let keyedQuestions = 0;
  let correctKeys = 0;
  let correctGroupings = 0;
  const missingQuestionNumbers: string[] = [];

  for (const expected of referenceQuestions) {
    totalReferenceOptions += expected.options.length;
    if (expected.answerKey !== null) keyedQuestions++;

    const actual = extractedByNumber.get(expected.number);
    if (!actual) {
      missingQuestionNumbers.push(expected.number);
      continue;
    }

    matchedQuestions++;
    if (actual.kind === expected.kind) matchedKinds++;
    matchedOptions += sameTextList(expected.options, actual.options);

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

  return {
    questionRecall: referenceQuestions.length === 0 ? 0 : matchedQuestions / referenceQuestions.length,
    optionFidelity: rate(matchedOptions, totalReferenceOptions),
    answerKeyAccuracy: rate(correctKeys, keyedQuestions),
    groupingAccuracy: rate(correctGroupings, referenceQuestions.length),
    kindAccuracy: rate(matchedKinds, matchedQuestions),
    counts: {
      referenceQuestions: referenceQuestions.length,
      extractedQuestions: extracted.questions.length,
      matchedQuestions,
      spuriousQuestions
    },
    missingQuestionNumbers
  };
}

function formatRate(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

/** One-line-per-metric report for a corpus run. */
export function formatMetrics(reference: ReferenceExam, metrics: ExtractionMetrics): string {
  return [
    `document          : ${reference.document}`,
    `question recall   : ${formatRate(metrics.questionRecall)} (${metrics.counts.matchedQuestions}/${metrics.counts.referenceQuestions})`,
    `option fidelity   : ${formatRate(metrics.optionFidelity)}`,
    `answer-key acc.   : ${formatRate(metrics.answerKeyAccuracy)}`,
    `grouping accuracy : ${formatRate(metrics.groupingAccuracy)}`,
    `kind accuracy     : ${formatRate(metrics.kindAccuracy)}`,
    `spurious questions: ${metrics.counts.spuriousQuestions}`,
    `missing           : ${metrics.missingQuestionNumbers.join(', ') || 'none'}`
  ].join('\n');
}
