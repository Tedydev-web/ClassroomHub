import { describe, expect, it } from 'vitest';
import { scoreExtraction } from '../src/metrics/exam-extraction-metrics';
import {
  assertReferenceIsScoreable,
  pendingLayers,
  UnscoreableReferenceError,
  type ExtractedExam,
  type ReferenceCoverage,
  type ReferenceExam
} from '../src/metrics/reference-exam';

const ALL_VERIFIED: ReferenceCoverage = {
  structure: 'verified',
  answerKeys: 'verified',
  optionText: 'verified',
  reviewRouting: 'verified'
};

function buildReference(coverage: ReferenceCoverage = ALL_VERIFIED): ReferenceExam {
  return {
    document: 'sample.docx',
    note: 'two questions share a passage, one stands alone',
    coverage,
    provenance: 'hand-written for tests',
    questions: [
      {
        number: '1',
        kind: 'choice',
        groupId: 'passage-1',
        optionCount: 4,
        answerKey: ['C'],
        prompt: 'The word impeccable is OPPOSITE in meaning to',
        options: ['messy', 'ordinary', 'imperfect', 'reliable'],
        reviewRequired: false
      },
      {
        number: '2',
        kind: 'choice',
        groupId: 'passage-1',
        optionCount: 4,
        answerKey: ['B'],
        prompt: 'The word they refers to',
        options: ['teenagers', 'parents', 'routines', 'study plans'],
        reviewRequired: false
      },
      {
        number: '3',
        kind: 'short_answer',
        groupId: null,
        optionCount: 0,
        answerKey: null,
        prompt: 'Name one habit the writer recommends',
        options: [],
        reviewRequired: true
      }
    ]
  };
}

function copyOf(reference: ReferenceExam): ExtractedExam {
  return { questions: reference.questions.map((question) => ({ ...question })) };
}

describe('layer gating', () => {
  it('measures nothing when no layer is verified', () => {
    const reference = buildReference({
      structure: 'proposed',
      answerKeys: 'proposed',
      optionText: 'unlabelled',
      reviewRouting: 'unlabelled'
    });
    const metrics = scoreExtraction(reference, copyOf(reference));

    expect(metrics.questionRecall).toBeNull();
    expect(metrics.kindAccuracy).toBeNull();
    expect(metrics.groupingAccuracy).toBeNull();
    expect(metrics.optionCountAccuracy).toBeNull();
    expect(metrics.answerKeyAccuracy).toBeNull();
    expect(metrics.optionFidelity).toBeNull();
    expect(metrics.reviewPrecision).toBeNull();
  });

  it('measures only the structure layer when only structure is verified', () => {
    const reference = buildReference({
      structure: 'verified',
      answerKeys: 'proposed',
      optionText: 'unlabelled',
      reviewRouting: 'unlabelled'
    });
    const metrics = scoreExtraction(reference, copyOf(reference));

    expect(metrics.questionRecall).toBe(1);
    expect(metrics.groupingAccuracy).toBe(1);
    expect(metrics.optionCountAccuracy).toBe(1);
    expect(metrics.answerKeyAccuracy).toBeNull();
    expect(metrics.optionFidelity).toBeNull();
  });

  it('a proposed layer is never silently treated as verified', () => {
    const proposed = buildReference({
      structure: 'proposed',
      answerKeys: 'verified',
      optionText: 'verified',
      reviewRouting: 'verified'
    });

    expect(scoreExtraction(proposed, copyOf(proposed)).questionRecall).toBeNull();
    expect(pendingLayers(proposed)).toEqual(['structure']);
  });
});

describe('extraction scoring', () => {
  const reference = buildReference();

  it('scores a faithful copy as perfect', () => {
    const metrics = scoreExtraction(reference, copyOf(reference));

    expect(metrics.questionRecall).toBe(1);
    expect(metrics.optionFidelity).toBe(1);
    expect(metrics.answerKeyAccuracy).toBe(1);
    expect(metrics.groupingAccuracy).toBe(1);
    expect(metrics.kindAccuracy).toBe(1);
    expect(metrics.optionCountAccuracy).toBe(1);
    expect(metrics.reviewPrecision).toBe(1);
    expect(metrics.counts.spuriousQuestions).toBe(0);
  });

  it('penalises review flags on questions that do not require correction', () => {
    const extracted = copyOf(reference);
    extracted.questions[0]!.reviewRequired = true;
    extracted.questions[2]!.reviewRequired = true;

    expect(scoreExtraction(reference, extracted).reviewPrecision).toBe(0.5);
  });

  it('scores an extractor that finds nothing as zero, not as unmeasurable', () => {
    const metrics = scoreExtraction(reference, { questions: [] });

    expect(metrics.questionRecall).toBe(0);
    expect(metrics.optionFidelity).toBe(0);
    expect(metrics.answerKeyAccuracy).toBe(0);
    expect(metrics.missingQuestionNumbers).toEqual(['1', '2', '3']);
  });

  it('ignores whitespace, case, and Unicode composition when comparing text', () => {
    const extracted = copyOf(reference);
    extracted.questions[0]!.options = ['  MESSY ', 'Ordinary', 'imperfect', 'RELIABLE'];

    expect(scoreExtraction(reference, extracted).optionFidelity).toBe(1);
  });

  it('counts questions the extractor invented', () => {
    const extracted = copyOf(reference);
    extracted.questions.push({
      number: '99',
      kind: 'choice',
      groupId: null,
      optionCount: 4,
      answerKey: null,
      prompt: 'Invented',
      options: [],
      reviewRequired: false
    });

    expect(scoreExtraction(reference, extracted).counts.spuriousQuestions).toBe(1);
  });

  it('scores grouping on the partition, not on the label text', () => {
    const relabelled = copyOf(reference);
    relabelled.questions[0]!.groupId = 'g-a';
    relabelled.questions[1]!.groupId = 'g-a';

    expect(scoreExtraction(reference, relabelled).groupingAccuracy).toBe(1);
  });

  it('penalises a grouping that splits questions belonging to one passage', () => {
    const split = copyOf(reference);
    split.questions[1]!.groupId = 'passage-2';

    expect(scoreExtraction(reference, split).groupingAccuracy).toBeCloseTo(1 / 3);
  });
});

describe('option count as a mis-assignment detector', () => {
  const reference = buildReference();

  // The failure a column-flattened layout provokes: every option text is
  // present somewhere in the output, but attached to the wrong question. Text
  // fidelity alone can look respectable while the paper is unusable.
  it('catches options stolen from a neighbouring question', () => {
    const extracted = copyOf(reference);
    extracted.questions[0]!.optionCount = 6;
    extracted.questions[1]!.optionCount = 2;

    const metrics = scoreExtraction(reference, extracted);

    expect(metrics.optionCountAccuracy).toBeCloseTo(1 / 3);
    expect(metrics.optionCountMismatches).toEqual([
      { number: '1', expected: 4, actual: 6 },
      { number: '2', expected: 4, actual: 2 }
    ]);
  });

  it('falls back to the length of the options list when no count is stated', () => {
    const extracted = copyOf(reference);
    extracted.questions[0]!.optionCount = null;
    extracted.questions[0]!.options = ['a', 'b', 'c', 'd'];

    expect(scoreExtraction(reference, extracted).optionCountAccuracy).toBe(1);
  });

  it('reports a missing question as an option-count miss rather than skipping it', () => {
    const extracted: ExtractedExam = { questions: [copyOf(reference).questions[0]!] };
    const metrics = scoreExtraction(reference, extracted);

    expect(metrics.optionCountMismatches).toEqual([
      { number: '2', expected: 4, actual: null },
      { number: '3', expected: 0, actual: null }
    ]);
  });
});

describe('scoreability', () => {
  it('accepts a reference with at least one verified layer', () => {
    const partial = buildReference({
      structure: 'verified',
      answerKeys: 'unlabelled',
      optionText: 'unlabelled',
      reviewRouting: 'unlabelled'
    });

    expect(() => assertReferenceIsScoreable(partial)).not.toThrow();
  });

  it('refuses a reference where nothing has been verified', () => {
    const proposed = buildReference({
      structure: 'proposed',
      answerKeys: 'proposed',
      optionText: 'proposed',
      reviewRouting: 'proposed'
    });

    expect(() => assertReferenceIsScoreable(proposed)).toThrow(UnscoreableReferenceError);
  });

  it('refuses an empty reference, which would otherwise look perfect', () => {
    const empty: ReferenceExam = { ...buildReference(), questions: [] };

    expect(() => assertReferenceIsScoreable(empty)).toThrow(UnscoreableReferenceError);
  });

  it('names the layers still awaiting a human', () => {
    const partial = buildReference({
      structure: 'verified',
      answerKeys: 'proposed',
      optionText: 'unlabelled',
      reviewRouting: 'unlabelled'
    });

    expect(pendingLayers(partial)).toEqual(['answerKeys', 'optionText', 'reviewRouting']);
  });
});
