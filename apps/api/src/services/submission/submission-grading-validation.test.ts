import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '@api/utils/errors';
import { ZSubmissionGradesUpdate, ZSubmissionUpdate } from '@cio/utils/validation/submission';
import { ZExerciseSubmissionCreate } from '@cio/utils/validation/exercise';
import { prepareSubmissionGrades } from './submission-grading-validation';

const questions = [
  { id: 1, points: 2.5 },
  { id: 2, points: 7.25 }
];

const storedAnswers = [
  { questionId: 1, score: 1.25, point: 1 },
  { questionId: 2, score: 3.5, point: 4 }
];

describe('prepareSubmissionGrades', () => {
  it('forbids score changes through the generic submission update contract', () => {
    expect(ZSubmissionUpdate.safeParse({ total: 10 }).success).toBe(false);
  });

  it('bounds the number of answers in a submission request', () => {
    const result = ZExerciseSubmissionCreate.safeParse({
      exerciseId: 'exercise-a',
      answers: Array.from({ length: 501 }, (_, index) => ({ questionId: index + 1, answer: 'answer' }))
    });

    expect(result.success).toBe(false);
  });

  it('accepts floating-point sums that resolve to two decimal places', () => {
    const result = ZSubmissionGradesUpdate.safeParse({
      answers: [
        { questionId: 1, points: 0.1 },
        { questionId: 2, points: 0.2 }
      ],
      total: 0.1 + 0.2
    });

    expect(result.success).toBe(true);
  });

  it('rejects scores with more than two material decimal places at the request boundary', () => {
    const result = ZSubmissionGradesUpdate.safeParse({
      answers: [{ questionId: 1, points: 1.235 }],
      total: 1.235
    });

    expect(result.success).toBe(false);
  });

  it('merges partial grade updates and derives the exact total from server state', () => {
    const result = prepareSubmissionGrades({
      questions,
      storedAnswers,
      updates: [{ questionId: 1, points: 2.25 }]
    });

    expect(result).toEqual({
      answers: [{ questionId: 1, points: 2.25 }],
      total: 5.75
    });
  });

  it('rejects duplicate question updates', () => {
    expect(() =>
      prepareSubmissionGrades({
        questions,
        storedAnswers,
        updates: [
          { questionId: 1, points: 1 },
          { questionId: 1, points: 2 }
        ]
      })
    ).toThrowError(expect.objectContaining({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 }));
  });

  it('rejects grades for questions without an answer in the submission', () => {
    expect(() =>
      prepareSubmissionGrades({
        questions: [...questions, { id: 3, points: 4 }],
        storedAnswers,
        updates: [{ questionId: 3, points: 1 }]
      })
    ).toThrowError(expect.objectContaining({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 }));
  });

  it('rejects grades above the configured question maximum', () => {
    expect(() =>
      prepareSubmissionGrades({
        questions,
        storedAnswers,
        updates: [{ questionId: 1, points: 2.51 }]
      })
    ).toThrowError(expect.objectContaining({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 }));
  });

  it('rejects scores with more than two decimal places', () => {
    expect(() =>
      prepareSubmissionGrades({
        questions,
        storedAnswers,
        updates: [{ questionId: 1, points: 1.235 }]
      })
    ).toThrowError(expect.objectContaining({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 }));
  });

  it('rejects a client total that differs from the server-derived total', () => {
    expect(() =>
      prepareSubmissionGrades({
        questions,
        storedAnswers,
        updates: [
          { questionId: 1, points: 2.25 },
          { questionId: 2, points: 3.5 }
        ],
        expectedTotal: 99,
        requireAllAnswers: true
      })
    ).toThrowError(expect.objectContaining({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 }));
  });

  it('requires every stored answer when completing batch grading', () => {
    expect(() =>
      prepareSubmissionGrades({
        questions,
        storedAnswers,
        updates: [{ questionId: 1, points: 2.25 }],
        expectedTotal: 5.75,
        requireAllAnswers: true
      })
    ).toThrowError(expect.objectContaining({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 }));
  });
});
