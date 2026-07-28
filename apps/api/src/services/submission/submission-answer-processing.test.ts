import { describe, expect, it } from 'vitest';
import { ErrorCodes } from '@api/utils/errors';
import {
  EXERCISE_SUBMISSION_MAX_TOTAL_ANSWER_CHARACTERS,
  ZExerciseSubmissionCreate
} from '@cio/utils/validation/exercise';
import { prepareSubmissionAnswers, type SubmissionQuestionDefinition } from './submission-answer-processing';

const assessmentDefinition = {
  schemaVersion: 1 as const,
  blocks: [
    {
      id: 'choice-1',
      kind: 'interaction' as const,
      interaction: {
        kind: 'choice' as const,
        prompt: { format: 'html' as const, html: '<p>Pick one.</p>' },
        required: true,
        maxScore: 1,
        config: {
          cardinality: 'single' as const,
          presentation: 'list' as const,
          options: [{ id: 'option-1', html: '<p>First</p>' }],
          correctOptionIds: ['option-1']
        }
      }
    }
  ],
  feedback: []
};

const trueFalseGroupAssessmentDefinition = {
  schemaVersion: 1 as const,
  blocks: [
    {
      id: 'group-1',
      kind: 'interaction' as const,
      interaction: {
        kind: 'true_false_group' as const,
        prompt: { format: 'html' as const, html: '<p>Mark every statement.</p>' },
        required: true,
        maxScore: 1,
        config: {
          statements: [
            { id: 'statement-1', html: '<p>First</p>', correctValue: true },
            { id: 'statement-2', html: '<p>Second</p>', correctValue: false }
          ],
          scoring: { mode: 'tiered' as const, tiers: [0, 0.5, 1] }
        }
      }
    }
  ],
  feedback: []
};

const questions: SubmissionQuestionDefinition[] = [
  {
    id: 1,
    title: 'Pick one',
    questionTypeId: 1,
    points: 10,
    settings: {},
    options: [
      { id: 11, label: 'First', value: 'first', isCorrect: true },
      { id: 12, label: 'Second', value: 'second', isCorrect: false }
    ]
  },
  {
    id: 2,
    title: 'Explain',
    questionTypeId: 3,
    points: 5,
    settings: { minCharacters: 3 },
    options: []
  }
];

describe('prepareSubmissionAnswers', () => {
  it('rejects duplicate question answers', () => {
    expect(() =>
      prepareSubmissionAnswers(questions, [
        { questionId: 1, optionId: 11 },
        { questionId: 1, optionId: 12 }
      ])
    ).toThrowError(expect.objectContaining({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 }));
  });

  it('rejects a question outside the exercise instead of silently skipping it', () => {
    expect(() => prepareSubmissionAnswers(questions, [{ questionId: 999, optionId: 11 }])).toThrowError(
      expect.objectContaining({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 })
    );
  });

  it('rejects malformed structured answers as validation errors', () => {
    const checkboxQuestion: SubmissionQuestionDefinition = {
      ...questions[0],
      questionTypeId: 2
    };

    expect(() => prepareSubmissionAnswers([checkboxQuestion], [{ questionId: 1, answer: '{not-json' }])).toThrowError(
      expect.objectContaining({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 })
    );
  });

  it('rejects payload fields that do not belong to the question type', () => {
    expect(() =>
      prepareSubmissionAnswers(questions, [{ questionId: 1, optionId: 11, answer: 'unexpected' }])
    ).toThrowError(expect.objectContaining({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 }));
  });

  it('rejects a submission that omits a required question', () => {
    expect(() => prepareSubmissionAnswers(questions, [{ questionId: 1, optionId: 11 }])).toThrowError(
      expect.objectContaining({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 })
    );
  });

  it('allows an omitted question only when its settings mark it optional', () => {
    const optionalQuestions: SubmissionQuestionDefinition[] = [
      questions[0],
      { ...questions[1], settings: { minCharacters: 3, required: false } }
    ];

    expect(prepareSubmissionAnswers(optionalQuestions, [{ questionId: 1, optionId: 11 }]).answers).toHaveLength(1);
  });

  it('allows an empty submission when every question is optional', () => {
    const optionalQuestions = questions.map((question) => ({
      ...question,
      settings: { required: false }
    }));

    expect(ZExerciseSubmissionCreate.safeParse({ exerciseId: 'exercise-a', answers: [] }).success).toBe(true);
    expect(prepareSubmissionAnswers(optionalQuestions, []).answers).toEqual([]);
  });

  it('rejects submissions whose aggregate legacy answer payload is too large', () => {
    const answer = 'x'.repeat(100_000);
    const answers = Array.from(
      { length: EXERCISE_SUBMISSION_MAX_TOTAL_ANSWER_CHARACTERS / answer.length + 1 },
      (_, index) => ({
        questionId: index + 1,
        answer
      })
    );

    expect(ZExerciseSubmissionCreate.safeParse({ exerciseId: 'exercise-a', answers }).success).toBe(false);
  });

  it('rejects submissions whose aggregate canonical response payload is too large', () => {
    const answers = Array.from({ length: 11 }, (_, index) => ({
      questionId: index + 1,
      response: {
        schemaVersion: 1 as const,
        responses: [
          {
            interactionId: `text-${index}`,
            response: { kind: 'text' as const, text: 'x'.repeat(100_000) }
          }
        ]
      }
    }));

    expect(ZExerciseSubmissionCreate.safeParse({ exerciseId: 'exercise-a', answers }).success).toBe(false);
  });

  it('accepts opaque revision links and rejects malformed revision identifiers', () => {
    const canonicalResponse = {
      schemaVersion: 1 as const,
      responses: [
        {
          interactionId: 'choice-1',
          response: { kind: 'choice' as const, selectedOptionIds: ['option-a'] }
        }
      ]
    };

    expect(
      ZExerciseSubmissionCreate.safeParse({
        exerciseId: 'exercise-a',
        answers: [
          {
            questionId: 1,
            questionRevisionId: '00000000-0000-4000-8000-000000000001',
            response: canonicalResponse
          }
        ]
      }).success
    ).toBe(true);
    expect(
      ZExerciseSubmissionCreate.safeParse({
        exerciseId: 'exercise-a',
        answers: [{ questionId: 1, questionRevisionId: 'revision-1', response: canonicalResponse }]
      }).success
    ).toBe(false);
  });

  it('rejects disabled question types at the exercise API boundary', async () => {
    const { ZExerciseCreate } = await import('@cio/utils/validation/exercise');

    expect(
      ZExerciseCreate.safeParse({
        courseId: 'course-a',
        title: 'Unsupported interaction',
        questions: [{ question: 'Choose a hotspot', questionTypeId: 15 }]
      }).success
    ).toBe(false);
  });

  it('rejects an empty response for a required question', () => {
    const shortAnswerQuestion: SubmissionQuestionDefinition = {
      id: 3,
      title: 'Short response',
      questionTypeId: 5,
      points: 2,
      settings: {},
      options: []
    };

    expect(() => prepareSubmissionAnswers([shortAnswerQuestion], [{ questionId: 3, answer: '   ' }])).toThrowError(
      expect.objectContaining({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 })
    );
  });

  it('requires one fill-blank answer for every configured blank', () => {
    const fillBlankQuestion: SubmissionQuestionDefinition = {
      id: 4,
      title: 'Complete both blanks',
      questionTypeId: 7,
      points: 2,
      settings: { acceptedAnswers: 'first,second' },
      options: []
    };

    expect(() =>
      prepareSubmissionAnswers(
        [fillBlankQuestion],
        [{ questionId: 4, answer: JSON.stringify({ type: 'FILL_BLANK', answers: ['first'] }) }]
      )
    ).toThrowError(expect.objectContaining({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 }));
  });

  it('requires one word-bank answer for every configured blank', () => {
    const wordBankQuestion: SubmissionQuestionDefinition = {
      id: 5,
      title: 'Complete both blanks',
      questionTypeId: 11,
      points: 2,
      settings: { correctAnswers: ['first', 'second'] },
      options: []
    };

    expect(() =>
      prepareSubmissionAnswers(
        [wordBankQuestion],
        [{ questionId: 5, answer: JSON.stringify({ type: 'WORD_BANK', filledBlanks: ['first'] }) }]
      )
    ).toThrowError(expect.objectContaining({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 }));
  });

  it('returns typed answer data and question models for valid input', () => {
    const result = prepareSubmissionAnswers(questions, [
      { questionId: 1, optionId: 11 },
      { questionId: 2, answer: 'Detailed answer' }
    ]);

    expect(result.answers).toEqual([
      { questionId: 1, answerData: { type: 'RADIO', optionId: 11 } },
      { questionId: 2, answerData: { type: 'TEXTAREA', text: 'Detailed answer' } }
    ]);
    expect(result.answerByQuestionId.get(1)).toEqual({ type: 'RADIO', optionId: 11 });
    expect(result.questionById.get(2)).toMatchObject({
      id: 2,
      questionType: 'TEXTAREA',
      points: 5
    });
  });

  it('validates a canonical assessment response against its immutable definition', () => {
    const assessmentQuestion: SubmissionQuestionDefinition = {
      id: 16,
      title: 'Composite item',
      questionTypeId: 16,
      points: 1,
      settings: {},
      options: []
    };
    const response = {
      schemaVersion: 1,
      responses: [{ interactionId: 'choice-1', response: { kind: 'choice' as const, selectedOptionIds: ['option-1'] } }]
    };

    const result = prepareSubmissionAnswers(
      [assessmentQuestion],
      [{ questionId: 16, questionRevisionId: '00000000-0000-4000-8000-000000000016', response }],
      new Map([[16, assessmentDefinition]])
    );

    expect(result.answers).toEqual([{ questionId: 16, answerData: { type: 'ASSESSMENT_ITEM', response } }]);
  });

  it('rejects an incomplete required true-false group at the submission boundary', () => {
    const assessmentQuestion: SubmissionQuestionDefinition = {
      id: 16,
      title: 'Grouped true or false',
      questionTypeId: 16,
      points: 1,
      settings: {},
      options: []
    };
    const response = {
      schemaVersion: 1 as const,
      responses: [
        {
          interactionId: 'group-1',
          response: {
            kind: 'true_false_group' as const,
            answers: [{ statementId: 'statement-1', value: true }]
          }
        }
      ]
    };

    expect(() =>
      prepareSubmissionAnswers(
        [assessmentQuestion],
        [{ questionId: 16, questionRevisionId: '00000000-0000-4000-8000-000000000016', response }],
        new Map([[16, trueFalseGroupAssessmentDefinition]])
      )
    ).toThrowError(expect.objectContaining({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 }));
  });

  it('allows an optional true-false group to be skipped but rejects a partial answer at final submission', () => {
    const assessmentQuestion: SubmissionQuestionDefinition = {
      id: 16,
      title: 'Optional grouped true or false',
      questionTypeId: 16,
      points: 1,
      settings: {},
      options: []
    };
    const optionalDefinition = {
      ...trueFalseGroupAssessmentDefinition,
      blocks: trueFalseGroupAssessmentDefinition.blocks.map((block) => ({
        ...block,
        interaction: { ...block.interaction, required: false }
      }))
    };
    const partialResponse = {
      schemaVersion: 1 as const,
      responses: [
        {
          interactionId: 'group-1',
          response: {
            kind: 'true_false_group' as const,
            answers: [{ statementId: 'statement-1', value: true }]
          }
        }
      ]
    };
    const completeResponse = {
      schemaVersion: 1 as const,
      responses: [
        {
          interactionId: 'group-1',
          response: {
            kind: 'true_false_group' as const,
            answers: [
              { statementId: 'statement-1', value: true },
              { statementId: 'statement-2', value: false }
            ]
          }
        }
      ]
    };

    expect(prepareSubmissionAnswers([assessmentQuestion], [], new Map([[16, optionalDefinition]])).answers).toEqual([]);
    expect(() =>
      prepareSubmissionAnswers(
        [assessmentQuestion],
        [{ questionId: 16, questionRevisionId: '00000000-0000-4000-8000-000000000016', response: partialResponse }],
        new Map([[16, optionalDefinition]])
      )
    ).toThrowError(expect.objectContaining({ code: ErrorCodes.VALIDATION_ERROR, statusCode: 400 }));
    expect(
      prepareSubmissionAnswers(
        [assessmentQuestion],
        [
          {
            questionId: 16,
            questionRevisionId: '00000000-0000-4000-8000-000000000016',
            response: completeResponse
          }
        ],
        new Map([[16, optionalDefinition]])
      ).answers
    ).toHaveLength(1);
  });
});
