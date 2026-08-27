import { describe, expect, it } from 'vitest';

import { applyCorrections, gradeAttempt, type ExamCorrection } from './exam-grading';
import type { ExamPaperSnapshot } from './exam-paper-serializer';

/**
 * Grading, and the two deliberate corrections a teacher may make afterwards.
 *
 * The cases that matter most are the ones an earlier draft of this phase would have
 * failed: a blank paper must score zero rather than raise, and one attempt that cannot be
 * scored must not take the rest of the class down with it.
 */

function choiceDefinition(correctOptionId: string) {
  return {
    schemaVersion: 1,
    blocks: [
      {
        id: 'b1',
        kind: 'interaction',
        interaction: {
          kind: 'choice',
          prompt: { html: '<p>Which one?</p>' },
          required: true,
          maxScore: 1,
          config: {
            cardinality: 'single',
            presentation: 'list',
            options: [
              { id: '1', html: '<p>focus</p>' },
              { id: '2', html: '<p>attention</p>' }
            ],
            correctOptionIds: [correctOptionId]
          }
        }
      }
    ]
  } as never;
}

function paper(correctOptionId = '2'): ExamPaperSnapshot {
  return {
    frozenAt: '2026-08-12T00:00:00.000Z',
    questions: [
      {
        questionId: 1,
        questionRevisionId: 'rev-1',
        order: 1,
        points: 1,
        definition: choiceDefinition(correctOptionId)
      }
    ]
  };
}

/** The envelope the assessment model validates: one entry per interaction, by id. */
function answer(optionId: string) {
  return [
    {
      questionId: 1,
      questionRevisionId: 'rev-1',
      answerData: {
        schemaVersion: 1,
        responses: [{ interactionId: 'b1', response: { kind: 'choice', selectedOptionIds: [optionId] } }]
      }
    }
  ];
}

const AWARD: ExamCorrection = { kind: 'award', questionId: 1, by: 'teacher', at: '2026-08-12T01:00:00.000Z' };
const KEY_FIX: ExamCorrection = {
  kind: 'keyFix',
  questionId: 1,
  previousKey: ['2'],
  correctedKey: ['1'],
  by: 'teacher',
  at: '2026-08-12T01:00:00.000Z'
};

describe('grading an attempt', () => {
  it('scores a blank paper zero rather than failing', () => {
    const result = gradeAttempt(paper(), [], []);

    expect(result.score).toBe(0);
    expect(result.gradingState).toBe('complete');
  });

  it('scores a correct answer', () => {
    expect(gradeAttempt(paper('2'), answer('2'), []).score).toBeGreaterThan(0);
  });

  it('scores a wrong answer zero', () => {
    expect(gradeAttempt(paper('2'), answer('1'), []).score).toBe(0);
  });

  it('ignores an answer to a question the paper does not contain, rather than raising', () => {
    const stray = [{ questionId: 99, questionRevisionId: 'rev-99', answerData: {} }];

    expect(() => gradeAttempt(paper(), stray, [])).not.toThrow();
    expect(gradeAttempt(paper(), stray, []).gradingState).toBe('complete');
  });

  it('marks an attempt it cannot score rather than throwing, so one bad row cannot fail the page', () => {
    const broken: ExamPaperSnapshot = {
      frozenAt: '2026-08-12T00:00:00.000Z',
      questions: [{ questionId: 1, questionRevisionId: 'rev-1', order: 1, points: 1, definition: {} as never }]
    };

    expect(() => gradeAttempt(broken, answer('2'), [])).not.toThrow();
    expect(gradeAttempt(broken, answer('2'), []).gradingState).toBe('unscoreable');
  });
});

describe('corrections', () => {
  it('awards a broken question to everybody, whatever they answered', () => {
    const wrong = gradeAttempt(paper('2'), answer('1'), [AWARD]);
    const right = gradeAttempt(paper('2'), answer('2'), [AWARD]);

    expect(wrong.score).toBe(right.score);
    expect(wrong.score).toBeGreaterThan(0);
  });

  it('re-scores against a corrected key, so the student who was right gains and the other does not', () => {
    expect(gradeAttempt(paper('2'), answer('1'), [KEY_FIX]).score).toBeGreaterThan(0);
    expect(gradeAttempt(paper('2'), answer('2'), [KEY_FIX]).score).toBe(0);
  });

  it('leaves the frozen paper untouched, so the previous key survives for an explanation', () => {
    const snapshot = paper('2');
    const before = JSON.stringify(snapshot);

    gradeAttempt(snapshot, answer('1'), [KEY_FIX]);

    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('applies to an attempt scored long afterwards, with nobody re-running a sweep', () => {
    // The same call lazy finalisation makes days later.
    expect(gradeAttempt(paper('2'), answer('1'), [AWARD]).score).toBeGreaterThan(0);
  });

  it('ignores a correction naming a question the paper does not contain', () => {
    const stray: ExamCorrection = { kind: 'award', questionId: 42, by: 't', at: '2026-08-12T01:00:00.000Z' };

    expect(gradeAttempt(paper(), answer('2'), [stray]).gradingState).toBe('complete');
  });
});

describe('the total', () => {
  it('is the automatic score plus the marks a teacher gave by hand', () => {
    const auto = gradeAttempt(paper('2'), answer('2'), []);
    const withManual = gradeAttempt(paper('2'), answer('2'), [], { 1: { score: 2 } });

    expect(withManual.score).toBe(auto.score + 2);
  });

  it('does not lose hand marks when a correction re-scores the paper', () => {
    const result = gradeAttempt(paper('2'), answer('1'), [AWARD], { 1: { score: 3 } });

    expect(result.score).toBeGreaterThanOrEqual(3);
  });
});

describe('applying corrections to a paper', () => {
  it('replaces the key for the named question only', () => {
    const corrected = applyCorrections(paper('2'), [KEY_FIX]);
    const definition = corrected.questions[0]?.definition as unknown as {
      blocks: Array<{ interaction: { config: { correctOptionIds: string[] } } }>;
    };

    expect(definition.blocks[0]?.interaction.config.correctOptionIds).toEqual(['1']);
  });
});

function textDefinition() {
  return {
    schemaVersion: 1,
    blocks: [
      {
        id: 'essay',
        kind: 'interaction',
        interaction: {
          kind: 'text',
          prompt: { html: '<p>Discuss</p>' },
          required: true,
          maxScore: 2,
          config: { multiline: true }
        }
      }
    ]
  } as never;
}

describe('a paper that mixes hand-marked and automatic questions', () => {
  it('is complete once the hand-marked questions are marked, not once every question is', () => {
    // The screen only offers a mark box where a mark is owed. Requiring a key for every
    // question — including the thirty-nine the machine already scored — left the attempt
    // stuck awaiting a mark that no one could enter.
    const snapshot = {
      frozenAt: new Date().toISOString(),
      questions: [
        { questionId: 1, questionRevisionId: 'r1', order: 1, points: 1, definition: choiceDefinition('1') },
        { questionId: 2, questionRevisionId: 'r2', order: 2, points: 2, definition: textDefinition() }
      ]
    } as never;

    const answers = [
      {
        questionId: 1,
        questionRevisionId: 'r1',
        answerData: {
          schemaVersion: 1,
          responses: [{ interactionId: 'b1', response: { kind: 'choice', selectedOptionIds: ['1'] } }]
        }
      },
      {
        questionId: 2,
        questionRevisionId: 'r2',
        answerData: {
          schemaVersion: 1,
          responses: [{ interactionId: 'essay', response: { kind: 'text', text: 'an answer' } }]
        }
      }
    ] as never;

    expect(gradeAttempt(snapshot, answers, [], {}).gradingState).toBe('awaiting_manual');
    expect(gradeAttempt(snapshot, answers, [], { 2: { score: 2 } }).gradingState).toBe('complete');
  });
});

describe('an item holding several questions', () => {
  function twoQuestionItem() {
    return {
      schemaVersion: 1,
      blocks: [
        {
          id: 'a',
          kind: 'interaction',
          interaction: {
            kind: 'choice',
            prompt: { html: '<p>a</p>' },
            required: true,
            maxScore: 1,
            config: {
              cardinality: 'single',
              presentation: 'list',
              options: [
                { id: '1', html: '<p>one</p>' },
                { id: '2', html: '<p>two</p>' }
              ],
              correctOptionIds: ['1']
            }
          }
        },
        {
          id: 'b',
          kind: 'interaction',
          interaction: {
            kind: 'choice',
            prompt: { html: '<p>b</p>' },
            required: true,
            maxScore: 1,
            config: {
              cardinality: 'single',
              presentation: 'list',
              options: [
                { id: '1', html: '<p>one</p>' },
                { id: '2', html: '<p>two</p>' }
              ],
              correctOptionIds: ['1']
            }
          }
        }
      ]
    } as never;
  }

  it('still marks the answered questions when a sibling was left blank', () => {
    // A reading passage is one item holding up to ten questions. Refusing to read the
    // envelope because one of them is blank scored the whole passage zero — on the sitting
    // that prompted this, one skipped question cost seven answered ones, several correct.
    const snapshot = {
      frozenAt: new Date().toISOString(),
      questions: [{ questionId: 1, questionRevisionId: 'r1', order: 1, points: 2, definition: twoQuestionItem() }]
    } as never;
    const answers = [
      {
        questionId: 1,
        questionRevisionId: 'r1',
        answerData: {
          schemaVersion: 1,
          responses: [{ interactionId: 'a', response: { kind: 'choice', selectedOptionIds: ['1'] } }]
        }
      }
    ] as never;

    expect(gradeAttempt(snapshot, answers, [], {}).score).toBe(1);
  });

  it('still refuses an envelope that is malformed rather than merely incomplete', () => {
    const snapshot = {
      frozenAt: new Date().toISOString(),
      questions: [{ questionId: 1, questionRevisionId: 'r1', order: 1, points: 2, definition: twoQuestionItem() }]
    } as never;
    const answers = [
      { questionId: 1, questionRevisionId: 'r1', answerData: { schemaVersion: 99, responses: [] } }
    ] as never;

    expect(gradeAttempt(snapshot, answers, [], {}).score).toBe(0);
  });
});
