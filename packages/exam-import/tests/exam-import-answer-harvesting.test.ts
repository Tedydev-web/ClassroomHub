import { MAX_INTERACTION_OPTIONS } from '@cio/question-types';
import { describe, expect, it } from 'vitest';
import { harvestExamImportAnswerCandidates } from '../src/draft/exam-import-answer-harvesting';
import { reconcileExamImportDraftAnswers } from '../src/draft/exam-import-reconciliation';
import { segmentExamImportRuns } from '../src/draft/exam-import-segmentation';
import { emptyFormatting, type RunFormatting, type SourceRun } from '../src/source-run';

type BlockOptions = {
  formatting?: Partial<RunFormatting>;
  kind?: SourceRun['block']['kind'];
  listNumber?: string | null;
  table?: {
    tableIndex: number;
    row: number;
    column: number;
  };
};

function block(index: number, text: string, options: BlockOptions = {}): SourceRun {
  const tableRef = options.table
    ? {
        ...options.table,
        originRow: options.table.row,
        originColumn: options.table.column
      }
    : null;

  return {
    text,
    formatting: { ...emptyFormatting(), ...options.formatting },
    block: {
      kind: options.kind ?? (tableRef ? 'table_cell' : 'paragraph'),
      index,
      listNumber: options.listNumber ?? null,
      tableRef
    },
    math: null,
    image: null,
    location: { blockIndex: index, runIndex: 0 }
  };
}

function choiceQuestion(startIndex: number, number: number): SourceRun[] {
  return [
    block(startIndex, `Question ${number}. Choose answer ${number}.`),
    block(startIndex + 1, 'A. OneB. TwoC. ThreeD. Four')
  ];
}

function draftFor(runs: SourceRun[]) {
  return segmentExamImportRuns(runs, {
    assetId: 'asset-1',
    fileName: 'exam.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extractor: 'docx'
  });
}

function choiceCandidates(draft: ReturnType<typeof draftFor>, questionIndex: number) {
  const question = draft.sections.flatMap((section) => section.questions)[questionIndex];
  if (question?.kind !== 'choice') throw new Error('Expected a choice question');

  return question.answerCandidates;
}

describe('exam import answer harvesting', () => {
  it('harvests an explicit answer line for the preceding question', () => {
    const runs = [...choiceQuestion(0, 1), block(2, 'Đáp án: C')];
    const harvested = harvestExamImportAnswerCandidates(draftFor(runs), runs);

    expect(choiceCandidates(harvested, 0)).toMatchObject([
      {
        source: 'explicit_line',
        kind: 'choice',
        correctOptionIds: ['question-1-option-c']
      }
    ]);
  });

  it('maps a complete compact key by global document order when section numbering restarts', () => {
    const runs = [
      block(0, 'PHẦN I. Multiple choice'),
      ...choiceQuestion(1, 1),
      ...choiceQuestion(3, 2),
      block(5, 'PHẦN II. Multiple choice'),
      ...choiceQuestion(6, 1),
      ...choiceQuestion(8, 2),
      block(10, 'HẾT'),
      block(11, 'Đáp án: 1A 2B 3C 4D')
    ];
    const harvested = harvestExamImportAnswerCandidates(draftFor(runs), runs);

    expect([0, 1, 2, 3].map((index) => choiceCandidates(harvested, index)[0]?.correctOptionIds[0])).toEqual([
      'question-1-option-a',
      'question-2-option-b',
      'question-3-option-c',
      'question-4-option-d'
    ]);
    expect(harvested.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('ANSWER_KEY_COUNT_MISMATCH');
  });

  it('reads a key by its numbers, not by the order the entries arrived in', () => {
    /**
     * A two-column answer table exports in reading order, so the numbers come out
     * interleaved — and the count still matches the paper exactly. Assigning by position
     * there puts every answer on the wrong question, and nothing afterwards can tell: a
     * wrong key is a valid key, so the paper marks, and marks the class incorrectly.
     */
    const runs = [
      ...choiceQuestion(0, 1),
      ...choiceQuestion(2, 2),
      ...choiceQuestion(4, 3),
      ...choiceQuestion(6, 4),
      block(8, 'HẾT'),
      block(9, 'Đáp án: 1A 3C 2B 4D')
    ];
    const harvested = harvestExamImportAnswerCandidates(draftFor(runs), runs);

    expect([0, 1, 2, 3].map((index) => choiceCandidates(harvested, index)[0]?.correctOptionIds[0])).toEqual([
      'question-1-option-a',
      'question-2-option-b',
      'question-3-option-c',
      'question-4-option-d'
    ]);
    expect(harvested.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('ANSWER_KEY_COUNT_MISMATCH');
  });

  it('blocks a partial compact key instead of silently truncating by matching numbers', () => {
    const runs = [...choiceQuestion(0, 1), ...choiceQuestion(2, 2), block(4, 'HẾT'), block(5, 'Đáp án: 1A')];
    const harvested = harvestExamImportAnswerCandidates(draftFor(runs), runs);

    expect(choiceCandidates(harvested, 0)).toEqual([]);
    expect(choiceCandidates(harvested, 1)).toEqual([]);
    expect(harvested.diagnostics.map((diagnostic) => diagnostic.code)).toContain('ANSWER_KEY_COUNT_MISMATCH');
  });

  it('harvests normal, transposed and split answer tables as one ordered source', () => {
    const questionRuns = [
      ...choiceQuestion(0, 1),
      ...choiceQuestion(2, 2),
      ...choiceQuestion(4, 3),
      ...choiceQuestion(6, 4)
    ];
    const normalAndSplitTable = [
      block(8, 'Câu', { table: { tableIndex: 0, row: 0, column: 0 } }),
      block(9, '1', { table: { tableIndex: 0, row: 0, column: 1 } }),
      block(10, '2', { table: { tableIndex: 0, row: 0, column: 2 } }),
      block(11, 'Chọn', { table: { tableIndex: 0, row: 1, column: 0 } }),
      block(12, 'A', { table: { tableIndex: 0, row: 1, column: 1 } }),
      block(13, 'B', { table: { tableIndex: 0, row: 1, column: 2 } }),
      block(14, 'Câu', { table: { tableIndex: 1, row: 0, column: 0 } }),
      block(15, '3', { table: { tableIndex: 1, row: 0, column: 1 } }),
      block(16, '4', { table: { tableIndex: 1, row: 0, column: 2 } }),
      block(17, 'Chọn', { table: { tableIndex: 1, row: 1, column: 0 } }),
      block(18, 'C', { table: { tableIndex: 1, row: 1, column: 1 } }),
      block(19, 'D', { table: { tableIndex: 1, row: 1, column: 2 } })
    ];
    const normal = harvestExamImportAnswerCandidates(draftFor([...questionRuns, ...normalAndSplitTable]), [
      ...questionRuns,
      ...normalAndSplitTable
    ]);

    expect([0, 1, 2, 3].map((index) => choiceCandidates(normal, index)[0]?.correctOptionIds[0])).toEqual([
      'question-1-option-a',
      'question-2-option-b',
      'question-3-option-c',
      'question-4-option-d'
    ]);

    const transposedTable = [
      block(8, 'Câu', { table: { tableIndex: 0, row: 0, column: 0 } }),
      block(9, 'Chọn', { table: { tableIndex: 0, row: 0, column: 1 } }),
      block(10, '1', { table: { tableIndex: 0, row: 1, column: 0 } }),
      block(11, 'A', { table: { tableIndex: 0, row: 1, column: 1 } }),
      block(12, '2', { table: { tableIndex: 0, row: 2, column: 0 } }),
      block(13, 'B', { table: { tableIndex: 0, row: 2, column: 1 } }),
      block(14, '3', { table: { tableIndex: 0, row: 3, column: 0 } }),
      block(15, 'C', { table: { tableIndex: 0, row: 3, column: 1 } }),
      block(16, '4', { table: { tableIndex: 0, row: 4, column: 0 } }),
      block(17, 'D', { table: { tableIndex: 0, row: 4, column: 1 } })
    ];
    const transposed = harvestExamImportAnswerCandidates(draftFor([...questionRuns, ...transposedTable]), [
      ...questionRuns,
      ...transposedTable
    ]);

    expect([0, 1, 2, 3].map((index) => choiceCandidates(transposed, index)[0]?.correctOptionIds[0])).toEqual([
      'question-1-option-a',
      'question-2-option-b',
      'question-3-option-c',
      'question-4-option-d'
    ]);
  });

  it('does not treat an ordinary content table as an answer table', () => {
    const questionRuns = choiceQuestion(0, 1);
    const contentTable = [
      block(2, 'Year', { table: { tableIndex: 0, row: 0, column: 0 } }),
      block(3, 'Value', { table: { tableIndex: 0, row: 0, column: 1 } }),
      block(4, '1', { table: { tableIndex: 0, row: 1, column: 0 } }),
      block(5, 'A', { table: { tableIndex: 0, row: 1, column: 1 } })
    ];
    const runs = [...questionRuns, ...contentTable];
    const harvested = harvestExamImportAnswerCandidates(draftFor(runs), runs);

    expect(choiceCandidates(harvested, 0)).toEqual([]);
  });

  it('does not infer a choice key from prose in a generic question-answer table', () => {
    const questionRuns = choiceQuestion(0, 1);
    const contentTable = [
      block(2, 'Question', { table: { tableIndex: 0, row: 0, column: 0 } }),
      block(3, 'Answer', { table: { tableIndex: 0, row: 0, column: 1 } }),
      block(4, '1', { table: { tableIndex: 0, row: 1, column: 0 } }),
      block(5, 'Blue', { table: { tableIndex: 0, row: 1, column: 1 } })
    ];
    const runs = [...questionRuns, ...contentTable];
    const harvested = harvestExamImportAnswerCandidates(draftFor(runs), runs);

    expect(choiceCandidates(harvested, 0)).toEqual([]);
  });

  it('maps a true-false explicit line without losing false values', () => {
    const runs = [
      block(0, 'PHẦN II. Câu trắc nghiệm đúng sai'),
      block(1, 'Câu 1. Xác định tính đúng sai.'),
      block(2, 'Một', { kind: 'list_item', listNumber: 'a.' }),
      block(3, 'Hai', { kind: 'list_item', listNumber: 'b.' }),
      block(4, 'Ba', { kind: 'list_item', listNumber: 'c.' }),
      block(5, 'Bốn', { kind: 'list_item', listNumber: 'd.' }),
      block(6, 'Đáp án: ĐSĐS')
    ];
    const harvested = harvestExamImportAnswerCandidates(draftFor(runs), runs);
    const question = harvested.sections[0]?.questions[0];
    if (question?.kind !== 'true_false_group') throw new Error('Expected a true-false group');

    expect(question.answerCandidates[0]?.answers.map((answer) => answer.correctValue)).toEqual([
      true,
      false,
      true,
      false
    ]);
  });

  it('uses a four-value boolean key to corroborate true-false without a section heading', () => {
    const runs = [
      block(0, 'Câu 1. Xác định tính đúng sai.'),
      block(1, 'Một', { kind: 'list_item', listNumber: 'a.' }),
      block(2, 'Hai', { kind: 'list_item', listNumber: 'b.' }),
      block(3, 'Ba', { kind: 'list_item', listNumber: 'c.' }),
      block(4, 'Bốn', { kind: 'list_item', listNumber: 'd.' }),
      block(5, 'Đáp án: ĐSĐS')
    ];
    const harvested = harvestExamImportAnswerCandidates(draftFor(runs), runs);
    const question = harvested.sections[0]?.questions[0];

    expect(question?.kind).toBe('true_false_group');
    if (question?.kind !== 'true_false_group') throw new Error('Expected a true-false group');
    expect(question.answerCandidates[0]?.answers.map((answer) => answer.correctValue)).toEqual([
      true,
      false,
      true,
      false
    ]);
  });

  it('keeps independent answer sources separate so reconciliation can prove agreement', () => {
    const runs = [
      block(0, 'Question 1. Choose.'),
      block(1, 'A.', { formatting: { underline: true } }),
      block(1, ' OneB. TwoC. ThreeD. Four'),
      block(2, 'Đáp án: A')
    ];
    runs[2]!.location.runIndex = 1;
    const harvested = harvestExamImportAnswerCandidates(draftFor(runs), runs);
    const reconciled = reconcileExamImportDraftAnswers(harvested);
    const question = reconciled.sections[0]?.questions[0];
    if (question?.kind !== 'choice') throw new Error('Expected a choice question');

    expect(question.answerCandidates.map((candidate) => candidate.source).sort()).toEqual([
      'emphasis',
      'explicit_line'
    ]);
    expect(question.answerKey).toMatchObject({ agreement: 'unanimous' });
    expect(
      reconciled.fieldStates.find(
        (state) =>
          state.target.kind === 'question_field' &&
          state.target.questionId === question.id &&
          state.target.field === 'answerKey'
      )?.confidence
    ).toBe('high');
    expect(question.confidence).toBe('medium');
  });

  it('takes the marking back out of the option a candidate reads', () => {
    const runs = [
      block(0, 'Question 1. Choose.'),
      block(1, 'A. One\tB. Two\tC. '),
      block(1, 'Three', { formatting: { bold: true } }),
      block(1, '\tD. Four'),
      block(2, 'Question 2. Choose.'),
      block(3, 'A. Alpha\tB. '),
      block(3, 'Beta', { formatting: { bold: true } }),
      block(3, '\tC. Gamma\tD. Delta')
    ];
    runs[2]!.location.runIndex = 1;
    runs[3]!.location.runIndex = 2;
    runs[5]!.location.runIndex = 1;
    runs[6]!.location.runIndex = 2;
    const harvested = harvestExamImportAnswerCandidates(draftFor(runs), runs);
    const questions = harvested.sections.flatMap((section) => section.questions);

    for (const question of questions) {
      if (question.kind !== 'choice') throw new Error('Expected a choice question');
      for (const option of question.options) {
        expect(option.html).not.toContain('<strong>');
      }
    }

    const first = questions[0];
    if (first?.kind !== 'choice') throw new Error('Expected a choice question');
    // The key is still read; only the styling that gave it away is gone.
    expect(first.answerCandidates[0]?.correctOptionIds).toEqual([first.options[2]?.id]);
    expect(first.options[2]?.html).toBe('<p>Three</p>');
  });

  it('counts one marking once when the answer is both bold and highlighted', () => {
    const runs = [
      block(0, 'Question 1. Choose.'),
      block(1, 'A. One\tB. Two\tC. ', {}),
      block(1, 'Three', { formatting: { bold: true, highlight: '#d9d9d9' } }),
      block(1, '\tD. Four')
    ];
    runs[2]!.location.runIndex = 1;
    runs[3]!.location.runIndex = 2;
    const harvested = harvestExamImportAnswerCandidates(draftFor(runs), runs);
    const reconciled = reconcileExamImportDraftAnswers(harvested);
    const question = reconciled.sections[0]?.questions[0];
    if (question?.kind !== 'choice') throw new Error('Expected a choice question');

    expect(question.answerCandidates).toHaveLength(1);
    expect(question.answerKey?.agreement).toBe('single_source');
    expect(question.answerKey?.selectedCandidateIds).toHaveLength(1);
    expect(question.answerKey?.correctOptionIds).toEqual([question.options[2]?.id]);
    expect(question.review).toBe('clean');
  });

  it('discards an emphasis kind globally when it marks all options or inconsistent cardinalities', () => {
    const allBoldRuns = [
      block(0, 'Question 1. Choose.'),
      block(1, 'A.', { formatting: { bold: true } }),
      block(1, ' One'),
      block(1, 'B.', { formatting: { bold: true } }),
      block(1, ' Two'),
      block(1, 'C.', { formatting: { bold: true } }),
      block(1, ' Three'),
      block(1, 'D.', { formatting: { bold: true } }),
      block(1, ' Four')
    ];
    allBoldRuns.forEach((run, index) => {
      if (run.block.index === 1) run.location.runIndex = index - 1;
    });
    const allBold = harvestExamImportAnswerCandidates(draftFor(allBoldRuns), allBoldRuns);

    expect(choiceCandidates(allBold, 0)).toEqual([]);

    const inconsistentRuns = [
      block(0, 'Question 1. Choose.'),
      block(1, 'A.', { formatting: { underline: true } }),
      block(1, ' OneB. TwoC. ThreeD. Four'),
      block(2, 'Question 2. Choose.'),
      block(3, 'A.', { formatting: { underline: true } }),
      block(3, ' OneB.', { formatting: { underline: true } }),
      block(3, ' TwoC. ThreeD. Four')
    ];
    inconsistentRuns[2]!.location.runIndex = 1;
    inconsistentRuns[5]!.location.runIndex = 1;
    inconsistentRuns[6]!.location.runIndex = 2;
    const inconsistent = harvestExamImportAnswerCandidates(draftFor(inconsistentRuns), inconsistentRuns);

    expect(choiceCandidates(inconsistent, 0)).toEqual([]);
    expect(choiceCandidates(inconsistent, 1)).toEqual([]);
  });

  it('reads emphasis from the option marker owned by each question in a shared source block', () => {
    const sharedBlockRuns = [
      block(0, 'Question 1. '),
      block(0, 'A. One', { formatting: { underline: true } }),
      block(0, ' Question 2. '),
      block(0, 'A. Alpha')
    ];
    sharedBlockRuns.forEach((run, runIndex) => {
      run.location.runIndex = runIndex;
    });
    const runs = [
      ...sharedBlockRuns,
      block(1, 'B. Two'),
      block(2, 'B. Beta'),
      block(3, 'C. Three'),
      block(4, 'C. Gamma'),
      block(5, 'D. Four'),
      block(6, 'D. Delta')
    ];
    const harvested = harvestExamImportAnswerCandidates(draftFor(runs), runs);

    expect(choiceCandidates(harvested, 0)).toMatchObject([
      {
        source: 'emphasis',
        correctOptionIds: ['question-1-option-a']
      }
    ]);
    expect(choiceCandidates(harvested, 1)).toEqual([]);
  });

  it('harvests emphasis that starts after the option label instead of on it', () => {
    const optionRuns = [
      block(1, 'A. OneB. TwoC'),
      block(1, '. Three', { formatting: { highlight: '#A9A9A9' } }),
      block(1, 'D. Four')
    ];
    optionRuns.forEach((run, runIndex) => {
      run.location.runIndex = runIndex;
    });
    const runs = [block(0, 'Question 1. Choose.'), ...optionRuns];
    const harvested = harvestExamImportAnswerCandidates(draftFor(runs), runs);

    expect(choiceCandidates(harvested, 0)).toMatchObject([
      {
        source: 'emphasis',
        correctOptionIds: ['question-1-option-c']
      }
    ]);
  });

  it('is pure and idempotent', () => {
    const runs = [...choiceQuestion(0, 1), block(2, 'Đáp án: B')];
    const original = draftFor(runs);
    const once = harvestExamImportAnswerCandidates(original, runs);
    const twice = harvestExamImportAnswerCandidates(once, runs);

    expect(twice).toEqual(once);
    expect(choiceCandidates(original, 0)).toEqual([]);
  });

  it('refreshes deterministic candidates when the source changes at the same location', () => {
    const firstRuns = [...choiceQuestion(0, 1), block(2, 'Đáp án: A')];
    const secondRuns = [...choiceQuestion(0, 1), block(2, 'Đáp án: B')];
    const first = harvestExamImportAnswerCandidates(draftFor(firstRuns), firstRuns);
    const refreshed = harvestExamImportAnswerCandidates(first, secondRuns);

    expect(choiceCandidates(refreshed, 0)).toMatchObject([
      {
        source: 'explicit_line',
        correctOptionIds: ['question-1-option-b']
      }
    ]);
  });

  it('keeps candidate accumulation within the draft schema limit', () => {
    const runs = [...choiceQuestion(0, 1), block(2, 'Đáp án: B')];
    const draft = draftFor(runs);
    const question = draft.sections[0]?.questions[0];
    if (question?.kind !== 'choice') throw new Error('Expected a choice question');
    question.answerCandidates = Array.from({ length: MAX_INTERACTION_OPTIONS }, (_, index) => ({
      id: `candidate-${index}`,
      kind: 'choice' as const,
      correctOptionIds: [question.options[0]!.id],
      source: 'ai' as const,
      provenance: question.provenance
    }));

    const harvested = harvestExamImportAnswerCandidates(draft, runs);

    expect(choiceCandidates(harvested, 0)).toHaveLength(MAX_INTERACTION_OPTIONS);
    expect(harvested.diagnostics.map((diagnostic) => diagnostic.code)).toContain('ANSWER_CANDIDATE_LIMIT_EXCEEDED');
  });
});
