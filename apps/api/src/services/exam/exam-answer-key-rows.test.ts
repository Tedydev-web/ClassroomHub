import { describe, expect, it } from 'vitest';

import { buildAnswerKeyRows } from './exam-answer-keys';
import type { ExamCorrection } from './exam-grading';

/**
 * The corrections screen lists questions, and an item is not a question: a passage holding
 * six is one item and six numbers on the paper the class sat. Listing items showed each
 * passage once, carrying the prompt, the options and the key of its first part — and printed
 * that single letter as the answer to a question the teacher could not see they were reading.
 */
function choice(id: string, prompt: string, correct: string[]) {
  return {
    kind: 'interaction' as const,
    id,
    interaction: {
      kind: 'choice',
      prompt: { html: prompt },
      config: {
        cardinality: 'single',
        options: [
          { id: 'o1', html: 'one' },
          { id: 'o2', html: 'two' }
        ],
        correctOptionIds: correct
      }
    }
  };
}

function written(id: string, prompt: string) {
  return { kind: 'interaction' as const, id, interaction: { kind: 'text', prompt: { html: prompt } } };
}

function item(questionId: number, order: number, blocks: unknown[]) {
  return { questionId, order, points: 1, definition: { schemaVersion: 1, blocks } };
}

const NO_CORRECTIONS = new Map<number, Set<ExamCorrection['kind']>>();

describe('buildAnswerKeyRows', () => {
  it('gives every question in a passage its own row', () => {
    const rows = buildAnswerKeyRows(
      [item(160, 1, [choice('a', 'first', ['o1']), choice('b', 'second', ['o2']), choice('c', 'third', ['o1'])])],
      NO_CORRECTIONS
    );

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.promptHtml)).toEqual(['first', 'second', 'third']);
    expect(rows.map((row) => row.effectiveKey)).toEqual([['o1'], ['o2'], ['o1']]);
  });

  it('numbers questions across the whole paper, not within each item', () => {
    // The bug in one line: three questions in the first passage means the second passage
    // starts at four, not at two.
    const rows = buildAnswerKeyRows(
      [
        item(160, 1, [choice('a', 'p1q1', ['o1']), choice('b', 'p1q2', ['o1']), choice('c', 'p1q3', ['o1'])]),
        item(161, 2, [choice('d', 'p2q1', ['o2'])])
      ],
      NO_CORRECTIONS
    );

    expect(rows.map((row) => row.position)).toEqual([1, 2, 3, 4]);
  });

  it('counts a written answer even though it has no key to correct', () => {
    // It occupies a number on the paper. Skipping it here would shift every number after it.
    const rows = buildAnswerKeyRows(
      [item(160, 1, [written('a', 'essay'), choice('b', 'after it', ['o1'])])],
      NO_CORRECTIONS
    );

    expect(rows.map((row) => row.position)).toEqual([1, 2]);
    expect(rows[0].keyFixable).toBe(false);
    expect(rows[1].keyFixable).toBe(true);
  });

  it('reads the paper in delivery order, not the order the rows arrived in', () => {
    const rows = buildAnswerKeyRows(
      [item(161, 2, [choice('b', 'second', ['o1'])]), item(160, 1, [choice('a', 'first', ['o1'])])],
      NO_CORRECTIONS
    );

    expect(rows.map((row) => row.promptHtml)).toEqual(['first', 'second']);
  });

  it('marks every question of an item whose key fix would overwrite its siblings', () => {
    // The write path still replaces the key in every choice part of the item it is given,
    // so the screen withholds the fix here. The flag is about the item, and every row of
    // that item has to carry it.
    const rows = buildAnswerKeyRows(
      [
        item(160, 1, [choice('a', 'one', ['o1']), choice('b', 'two', ['o2'])]),
        item(161, 2, [choice('c', 'alone', ['o1'])])
      ],
      NO_CORRECTIONS
    );

    expect(rows.map((row) => row.hasSeveralChoiceParts)).toEqual([true, true, false]);
  });

  it('shows a correction against every question of the item it was made on', () => {
    const corrections = new Map<number, Set<ExamCorrection['kind']>>([[160, new Set(['award' as const])]]);
    const rows = buildAnswerKeyRows(
      [item(160, 1, [choice('a', 'one', ['o1']), choice('b', 'two', ['o2'])])],
      corrections
    );

    expect(rows.every((row) => row.awarded)).toBe(true);
    expect(rows.every((row) => row.corrected)).toBe(false);
  });

  it('says how many questions the item holds, because an award reaches all of them', () => {
    const rows = buildAnswerKeyRows(
      [
        item(160, 1, [choice('a', 'one', ['o1']), choice('b', 'two', ['o2']), written('c', 'essay')]),
        item(161, 2, [choice('d', 'alone', ['o1'])])
      ],
      NO_CORRECTIONS
    );

    // Every question of the passage, including the written one an award also covers.
    expect(rows.map((row) => row.questionsInItem)).toEqual([3, 3, 3, 1]);
  });

  it('labels options by letter, in the order the paper prints them', () => {
    const rows = buildAnswerKeyRows([item(160, 1, [choice('a', 'one', ['o2'])])], NO_CORRECTIONS);

    expect(rows[0].options.map((option) => option.label)).toEqual(['A', 'B']);
    expect(rows[0].interactionId).toBe('a');
  });
});
