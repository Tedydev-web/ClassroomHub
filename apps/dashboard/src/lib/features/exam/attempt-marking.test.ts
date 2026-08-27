import { describe, expect, it } from 'vitest';

import { markAttemptPaper } from './attempt-marking';

/**
 * The screen this feeds used to print option ids and number by assessment item, so a
 * passage holding five questions appeared as one row called "7". These pin the two claims
 * that fixes: numbers run over interactions, and every option resolves to its own text.
 */

function choice(id: string, correctId: string) {
  return {
    id,
    kind: 'interaction',
    interaction: {
      kind: 'choice',
      prompt: { html: `<p>${id}</p>`, format: 'html' },
      required: true,
      maxScore: 1,
      config: {
        cardinality: 'single',
        presentation: 'list',
        options: [
          { id: `${id}-a`, html: '<p>first</p>' },
          { id: `${id}-b`, html: '<p>second</p>' },
          { id: `${id}-c`, html: '<p>third</p>' },
          { id: `${id}-d`, html: '<p>fourth</p>' }
        ],
        correctOptionIds: [correctId]
      }
    }
  };
}

function item(questionId: number, ids: string[], correctSuffix: string, sharedHtml?: string) {
  return {
    questionId,
    points: ids.length,
    definition: {
      schemaVersion: 1,
      blocks: [
        ...(sharedHtml
          ? [{ id: `shared-${questionId}`, kind: 'content', content: { html: sharedHtml, format: 'html' } }]
          : []),
        ...ids.map((id) => choice(id, `${id}-${correctSuffix}`))
      ]
    } as never
  };
}

function answered(pairs: Array<[string, string]>) {
  return {
    schemaVersion: 1,
    responses: pairs.map(([interactionId, optionId]) => ({
      interactionId,
      response: { kind: 'choice', selectedOptionIds: [optionId] }
    }))
  };
}

describe('markAttemptPaper', () => {
  it('numbers across interactions, not across items', () => {
    // One single question, then a passage holding five. The sixth question of the paper is
    // the second question of the passage, not the second item.
    const marked = markAttemptPaper(
      [item(1, ['q1'], 'a'), item(2, ['q2', 'q3', 'q4', 'q5', 'q6'], 'a', '<p>passage</p>')],
      new Map()
    );

    expect(marked.map((entry) => [entry.firstNumber, entry.lastNumber])).toEqual([
      [1, 1],
      [2, 6]
    ]);
    expect(marked[1]!.interactions.map((entry) => entry.number)).toEqual([2, 3, 4, 5, 6]);
    expect(marked[1]!.sharedHtml).toBe('<p>passage</p>');
  });

  it('resolves the chosen option to its label and text, and marks it right or wrong', () => {
    const marked = markAttemptPaper(
      [item(1, ['q1', 'q2'], 'c')],
      new Map([
        [
          1,
          answered([
            ['q1', 'q1-c'],
            ['q2', 'q2-a']
          ])
        ]
      ])
    );
    const [right, wrong] = marked[0]!.interactions;

    expect(right!.chosen).toEqual([{ label: 'C', html: '<p>third</p>' }]);
    expect(right!.isCorrect).toBe(true);

    expect(wrong!.chosen).toEqual([{ label: 'A', html: '<p>first</p>' }]);
    expect(wrong!.isCorrect).toBe(false);
    expect(wrong!.correct).toEqual([{ label: 'C', html: '<p>third</p>' }]);
  });

  it('leaves an unanswered question blank rather than guessing', () => {
    const marked = markAttemptPaper([item(1, ['q1'], 'a')], new Map());

    expect(marked[0]!.interactions[0]!.chosen).toEqual([]);
  });

  it('asks for a hand mark only where one is owed', () => {
    const text = {
      questionId: 2,
      points: 2,
      definition: {
        schemaVersion: 1,
        blocks: [
          {
            id: 'essay',
            kind: 'interaction',
            interaction: {
              kind: 'text',
              prompt: { html: '<p>Discuss</p>', format: 'html' },
              required: true,
              maxScore: 2,
              config: { multiline: true }
            }
          }
        ]
      } as never
    };

    const marked = markAttemptPaper([item(1, ['q1'], 'a'), text], new Map());

    expect(marked[0]!.needsManual).toBe(false);
    expect(marked[1]!.needsManual).toBe(true);
    expect(marked[1]!.interactions[0]!.isCorrect).toBeNull();
  });

  it('still marks the answered questions when one blank sibling blocks the score', () => {
    // A required question left blank fails the whole item's validation, and with it every
    // sibling's verdict. On the paper that prompted this, one skipped question hid whether
    // seven answered ones were right.
    const marked = markAttemptPaper(
      [item(1, ['q1', 'q2', 'q3'], 'b')],
      new Map([
        [
          1,
          answered([
            ['q1', 'q1-b'],
            ['q2', 'q2-a']
          ])
        ]
      ])
    );
    const [first, second, third] = marked[0]!.interactions;

    expect(first!.isCorrect).toBe(true);
    expect(second!.isCorrect).toBe(false);
    expect(third!.chosen).toEqual([]);
    expect(third!.isCorrect).toBeNull();
    expect(marked[0]!.scoreBlocked).toBe(true);
  });

  it('does not call a repeated choice correct when the key names two different options', () => {
    // The fallback runs precisely when validation failed, so the responses it reads have
    // not been normalised. Comparing by length and `includes` let ['a','a'] satisfy a key
    // of ['a','b'].
    const multi = {
      questionId: 1,
      points: 1,
      definition: {
        schemaVersion: 1,
        blocks: [
          {
            id: 'q1',
            kind: 'interaction',
            interaction: {
              kind: 'choice',
              prompt: { html: '<p>q1</p>', format: 'html' },
              required: true,
              maxScore: 1,
              config: {
                cardinality: 'multiple',
                presentation: 'list',
                options: [
                  { id: 'q1-a', html: '<p>first</p>' },
                  { id: 'q1-b', html: '<p>second</p>' }
                ],
                correctOptionIds: ['q1-a', 'q1-b']
              }
            }
          },
          {
            id: 'q2',
            kind: 'interaction',
            interaction: {
              kind: 'choice',
              prompt: { html: '<p>q2</p>', format: 'html' },
              required: true,
              maxScore: 1,
              config: {
                cardinality: 'single',
                presentation: 'list',
                options: [{ id: 'q2-a', html: '<p>only</p>' }],
                correctOptionIds: ['q2-a']
              }
            }
          }
        ]
      } as never
    };

    // q2 left blank, so the item fails validation and the fallback decides q1.
    const marked = markAttemptPaper(
      [multi],
      new Map([
        [
          1,
          {
            schemaVersion: 1,
            responses: [{ interactionId: 'q1', response: { kind: 'choice', selectedOptionIds: ['q1-a', 'q1-a'] } }]
          }
        ]
      ])
    );

    expect(marked[0]!.scoreBlocked).toBe(true);
    expect(marked[0]!.interactions[0]!.isCorrect).toBe(false);
  });
});
