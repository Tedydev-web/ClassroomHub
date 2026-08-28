import { describe, expect, it } from 'vitest';

import { buildOutlineGroups, countInteractions, questionNumberStarts, type PaperQuestion } from './paper-outline';

/**
 * The shape under test is the one that was actually in production: ten items carrying
 * forty numbered questions between them, six of them under the first passage alone.
 *
 * Numbering from the item's position instead of from the running count produced a highest
 * displayed number of 17 on that paper — not an error, not a gap, just a paper that looked
 * like it stopped early. These cases exist so that cannot come back silently.
 */
function choiceBlock(id: string) {
  return {
    id,
    kind: 'interaction' as const,
    interaction: {
      kind: 'choice' as const,
      prompt: { format: 'html' as const, html: '<p>?</p>' },
      required: true,
      maxScore: 1,
      config: {
        cardinality: 'single' as const,
        presentation: 'list' as const,
        options: [
          { id: '1', html: '<p>A</p>' },
          { id: '2', html: '<p>B</p>' }
        ],
        correctOptionIds: ['2']
      }
    }
  };
}

/** An item holding `interactions` numbered questions, plus one passage of content. */
function item(questionId: number, interactions: number): PaperQuestion {
  return {
    questionId,
    definition: {
      schemaVersion: 1,
      blocks: [
        { id: `c${questionId}`, kind: 'content', content: { format: 'html', html: '<p>Passage</p>' } },
        ...Array.from({ length: interactions }, (_unused, index) => choiceBlock(`b${questionId}-${index}`))
      ]
    } as never
  };
}

/** The production paper: ten items, forty questions. */
const PAPER = [6, 1, 1, 1, 1, 1, 5, 10, 6, 8].map((interactions, index) => item(index + 1, interactions));

const labels = {
  range: (start: string, end: string) => `${start}-${end}`,
  single: (index: string) => index
};

describe('numbering an exam paper', () => {
  it('counts an item by its questions, not as one', () => {
    expect(countInteractions(PAPER[0])).toBe(6);
    expect(countInteractions(PAPER[1])).toBe(1);
  });

  it('starts each item where the previous one finished', () => {
    const starts = questionNumberStarts(PAPER);

    expect(starts[1]).toBe(1);
    // Six questions under the first passage, so the second item is question seven.
    expect(starts[2]).toBe(7);
    expect(starts[7]).toBe(12);
    expect(starts[8]).toBe(17);
    expect(starts[10]).toBe(33);
  });

  it('reaches the paper real length rather than the item count', () => {
    const starts = questionNumberStarts(PAPER);
    const last = PAPER[PAPER.length - 1];
    const highest = starts[last.questionId] + countInteractions(last) - 1;

    expect(highest).toBe(40);

    // Numbering from the item index instead — the defect — tops out here.
    const fromItemIndex = Math.max(...PAPER.map((question, index) => index + 1 + countInteractions(question) - 1));
    expect(fromItemIndex).toBe(17);
  });
});

describe('the outline of an exam paper', () => {
  it('labels a passage by the range it covers and a lone question by its number', () => {
    const groups = buildOutlineGroups(PAPER, { currentIndex: 1, labels });

    expect(groups[0].title).toBe('1-6');
    expect(groups[1].title).toBe('7');
    expect(groups[9].title).toBe('33-40');
  });

  it('numbers every question on the paper exactly once, in order', () => {
    const groups = buildOutlineGroups(PAPER, { currentIndex: 1, labels });
    const numbers = groups.flatMap((group) => group.questions.map((question) => Number(question.label)));

    expect(numbers).toEqual(Array.from({ length: 40 }, (_unused, index) => index + 1));
  });

  it('marks only the item being read as current', () => {
    const groups = buildOutlineGroups(PAPER, { currentIndex: 3, labels });

    expect(groups.filter((group) => group.isCurrent).map((group) => group.id)).toEqual(['3']);
  });

  it('reports nothing as answered when there are no answers to read', () => {
    const groups = buildOutlineGroups(PAPER, { currentIndex: 1, labels });

    expect(groups.every((group) => group.questions.every((question) => !question.isAnswered))).toBe(true);
  });

  it('marks the interactions an envelope names', () => {
    const groups = buildOutlineGroups(PAPER, {
      currentIndex: 1,
      labels,
      answered: (question) =>
        question.questionId === 1
          ? ({
              schemaVersion: 1,
              responses: [{ interactionId: 'b1-0', response: { kind: 'choice', selectedOptionIds: ['2'] } }]
            } as never)
          : null
    });

    expect(groups[0].questions.map((question) => question.isAnswered)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false
    ]);
  });
});
