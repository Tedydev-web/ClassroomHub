import { describe, expect, it } from 'vitest';

import { buildAnswerMatrix, type MatrixAttempt } from './exam-answer-matrix';
import type { ExamAnswerKeyQuestion } from './exam-answer-keys';

/**
 * A marking sheet whose columns are headed one question and filled with another is worse
 * than none: a teacher goes through the paper with a class off the back of it. Every case
 * here is about that one risk.
 */
function question(position: number, questionId: number, interactionId: string, key: string[]): ExamAnswerKeyQuestion {
  return {
    questionId,
    interactionId,
    position,
    points: 1,
    promptHtml: '',
    options: [
      { id: 'o1', label: 'A', html: 'one' },
      { id: 'o2', label: 'B', html: 'two' },
      { id: 'o3', label: 'C', html: 'three' }
    ],
    effectiveKey: key,
    cardinality: 'single',
    keyFixable: true,
    questionsInItem: 1,
    hasSeveralChoiceParts: false,
    awarded: false,
    corrected: false
  };
}

function sitting(answers: MatrixAttempt['answers']): MatrixAttempt {
  return {
    attemptId: 'a1',
    displayName: 'Nguyễn Văn A',
    nickname: null,
    className: '12A1',
    candidateNumber: null,
    score: '1',
    total: '2',
    answers
  };
}

function answered(questionId: number, entries: Array<[string, string[]]>) {
  return {
    questionId,
    answerData: {
      responses: entries.map(([interactionId, selectedOptionIds]) => ({
        interactionId,
        response: { kind: 'choice', selectedOptionIds }
      }))
    }
  };
}

describe('buildAnswerMatrix', () => {
  it('puts each answer under the question it was given for, across items', () => {
    // Two questions in one passage and one standing alone. Aligning by anything other than
    // the interaction — array position, item order — crosses the columns here.
    const questions = [
      question(1, 160, 'i-a', ['o1']),
      question(2, 160, 'i-b', ['o2']),
      question(3, 161, 'i-c', ['o3'])
    ];
    const matrix = buildAnswerMatrix(questions, [
      sitting([
        answered(161, [['i-c', ['o3']]]),
        answered(160, [
          ['i-b', ['o2']],
          ['i-a', ['o1']]
        ])
      ])
    ]);

    expect(matrix.rows[0].chosen).toEqual(['A', 'B', 'C']);
    expect(matrix.rows[0].correct).toBe(3);
  });

  it('reads the paper in its own order, not the order the questions arrived in', () => {
    const matrix = buildAnswerMatrix(
      [question(2, 161, 'i-b', ['o2']), question(1, 160, 'i-a', ['o1'])],
      [sitting([answered(160, [['i-a', ['o1']]]), answered(161, [['i-b', ['o3']]])])]
    );

    expect(matrix.questions.map((entry) => entry.position)).toEqual([1, 2]);
    expect(matrix.rows[0].chosen).toEqual(['A', 'C']);
    expect(matrix.rows[0].correct).toBe(1);
  });

  it('leaves a blank blank rather than guessing at it', () => {
    const matrix = buildAnswerMatrix(
      [question(1, 160, 'i-a', ['o1']), question(2, 160, 'i-b', ['o2'])],
      [sitting([answered(160, [['i-a', ['o1']]])])]
    );

    expect(matrix.rows[0].chosen).toEqual(['A', null]);
    expect(matrix.rows[0].correct).toBe(1);
  });

  it('prints the letters of a question that accepts more than one', () => {
    const matrix = buildAnswerMatrix(
      [question(1, 160, 'i-a', ['o1', 'o3'])],
      [sitting([answered(160, [['i-a', ['o3', 'o1']]])])]
    );

    expect(matrix.questions[0].key).toBe('A, C');
    // In paper order, whatever order the candidate happened to tick them in.
    expect(matrix.rows[0].chosen).toEqual(['A, C']);
    expect(matrix.rows[0].correct).toBe(1);
  });

  it('shows an option the paper no longer offers instead of dropping it', () => {
    // A key fix can retire an option after the class answered. Printing a blank would say
    // they answered nothing, which is not what happened.
    const matrix = buildAnswerMatrix(
      [question(1, 160, 'i-a', ['o1'])],
      [sitting([answered(160, [['i-a', ['gone']]])])]
    );

    expect(matrix.rows[0].chosen).toEqual(['gone']);
    expect(matrix.rows[0].correct).toBe(0);
  });

  it('counts nothing correct on a question with no key', () => {
    const matrix = buildAnswerMatrix([question(1, 160, 'i-a', [])], [sitting([answered(160, [['i-a', ['o1']]])])]);

    expect(matrix.questions[0].key).toBe('');
    expect(matrix.rows[0].correct).toBe(0);
  });
});
