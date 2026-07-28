import { describe, expect, it } from 'vitest';
import {
  QUESTION_TYPE_IDS,
  scoreAssessmentVerticalSlice,
  validateAssessmentResponseEnvelope
} from '@cio/question-types';
import { ExamImportPublishPlanError, createExamImportPublishPlan } from '../src/publish/exam-import-publish-plan';
import type { ExamImportDraft } from '../src/draft/exam-import-draft';
import { buildValidExamImportDraft, sourceSpan } from './fixtures/exam-import-draft-fixture';

const validationContext = {
  enabledQuestionKinds: new Set(['choice', 'true_false_group', 'short_answer', 'numeric', 'essay'] as const),
  sanitizeHtml: (html: string) => html
};

function withoutPassage(draft: ExamImportDraft): ExamImportDraft {
  const question = draft.sections[0]!.questions[0]!;

  return {
    ...draft,
    sharedContents: [],
    sections: [{ ...draft.sections[0]!, questions: [{ ...question, passageId: null }] }]
  };
}

describe('createExamImportPublishPlan', () => {
  it('maps an HTML-authored integer-point choice to a canonical item', () => {
    const draft = withoutPassage(buildValidExamImportDraft());
    const question = draft.sections[0]!.questions[0]!;
    if (question.kind !== 'choice') throw new Error('Expected choice fixture');
    question.points = 1;

    const plan = createExamImportPublishPlan(draft, validationContext);

    const entry = plan.sections[0]?.entries[0];

    expect(entry?.kind).toBe('assessment_item');
    if (entry?.kind !== 'assessment_item') throw new Error('Expected a canonical item');
    expect(entry.definition.blocks[0]).toMatchObject({
      kind: 'interaction',
      interaction: {
        kind: 'choice',
        maxScore: 1,
        prompt: { format: 'html', html: '<p>Choose the correct answer.</p>' },
        config: {
          options: [
            { id: 'option-a', html: '<p>First</p>' },
            { id: 'option-b', html: '<p>Second</p>' }
          ],
          correctOptionIds: ['option-b']
        }
      }
    });
  });

  it('keeps an integer-point choice with flat text on the legacy authoring path', () => {
    const draft = withoutPassage(buildValidExamImportDraft());
    const question = draft.sections[0]!.questions[0]!;
    if (question.kind !== 'choice') throw new Error('Expected choice fixture');
    question.points = 1;
    question.promptHtml = 'Choose the correct answer.';
    question.options = question.options.map((option) => ({
      ...option,
      html: option.id === 'option-a' ? 'First' : 'Second'
    }));

    const plan = createExamImportPublishPlan(draft, validationContext);

    expect(plan.sections[0]?.entries).toEqual([
      {
        kind: 'legacy_question',
        sourceQuestionId: 'question-1',
        order: 0,
        question: 'Choose the correct answer.',
        questionTypeId: QUESTION_TYPE_IDS.RADIO,
        points: 1,
        settings: {},
        options: [
          { label: 'First', isCorrect: false, settings: {} },
          { label: 'Second', isCorrect: true, settings: {} }
        ]
      }
    ]);
  });

  it('maps a fractional-point choice to a publishable canonical item', () => {
    const draft = withoutPassage(buildValidExamImportDraft());

    const plan = createExamImportPublishPlan(draft, validationContext);
    const entry = plan.sections[0]?.entries[0];

    expect(entry?.kind).toBe('assessment_item');
    if (entry?.kind !== 'assessment_item') throw new Error('Expected a canonical item');
    expect(entry.definition.blocks).toEqual([
      {
        id: 'question-1',
        kind: 'interaction',
        interaction: {
          kind: 'choice',
          prompt: { format: 'html', html: '<p>Choose the correct answer.</p>' },
          required: true,
          maxScore: 0.25,
          config: {
            cardinality: 'single',
            presentation: 'list',
            options: [
              { id: 'option-a', html: '<p>First</p>' },
              { id: 'option-b', html: '<p>Second</p>' }
            ],
            correctOptionIds: ['option-b']
          }
        }
      }
    ]);
  });

  it('forces weighted choices through the canonical item and preserves score weights', () => {
    const draft = withoutPassage(buildValidExamImportDraft());
    const question = draft.sections[0]!.questions[0]!;
    if (question.kind !== 'choice') throw new Error('Expected choice fixture');
    question.points = 1;
    question.scoreWeights = { 'option-a': 40, 'option-b': 60 };
    question.feedback = [
      { optionId: 'option-a', html: '<p>Review the first option.</p>' },
      { optionId: null, html: '<p>Review the whole question.</p>' }
    ];
    question.cardinality = 'multiple';
    question.answerCandidates[0]!.correctOptionIds = ['option-a', 'option-b'];
    question.answerKey!.correctOptionIds = ['option-a', 'option-b'];

    const plan = createExamImportPublishPlan(draft, validationContext);
    const entry = plan.sections[0]?.entries[0];

    expect(entry?.kind).toBe('assessment_item');
    if (entry?.kind !== 'assessment_item') throw new Error('Expected a canonical item');
    expect(entry.definition.blocks[0]).toMatchObject({
      kind: 'interaction',
      interaction: {
        kind: 'choice',
        config: {
          correctOptionIds: ['option-a', 'option-b'],
          scoreWeights: { 'option-a': 40, 'option-b': 60 }
        }
      }
    });
    expect(entry.definition.feedback).toEqual([
      {
        id: 'feedback-1-1',
        scope: 'choice_option',
        interactionId: 'question-1',
        optionId: 'option-a',
        html: '<p>Review the first option.</p>',
        visibility: 'after_grading'
      },
      {
        id: 'feedback-1-2',
        scope: 'item',
        html: '<p>Review the whole question.</p>',
        visibility: 'after_grading'
      }
    ]);

    const validatedResponse = validateAssessmentResponseEnvelope(entry.definition, {
      schemaVersion: 1,
      responses: [
        {
          interactionId: 'question-1',
          response: { kind: 'choice', selectedOptionIds: ['option-a'] }
        }
      ]
    });
    expect(validatedResponse.success).toBe(true);
    if (!validatedResponse.success) throw new Error('Expected a valid weighted response');

    expect(scoreAssessmentVerticalSlice(entry.definition, validatedResponse.data).autoScore).toBe(0.4);
  });

  it('forces an unweighted choice with feedback through the canonical item', () => {
    const draft = withoutPassage(buildValidExamImportDraft());
    const question = draft.sections[0]!.questions[0]!;
    if (question.kind !== 'choice') throw new Error('Expected choice fixture');
    question.points = 1;
    question.feedback = [{ optionId: null, html: '<p>General feedback.</p>' }];

    const entry = createExamImportPublishPlan(draft, validationContext).sections[0]?.entries[0];

    expect(entry?.kind).toBe('assessment_item');
    if (entry?.kind !== 'assessment_item') throw new Error('Expected a canonical item');
    expect(entry.definition.feedback).toEqual([
      {
        id: 'feedback-1-1',
        scope: 'item',
        html: '<p>General feedback.</p>',
        visibility: 'after_grading'
      }
    ]);
  });

  it('maps grouped true-false to the canonical interaction and preserves tier scoring', () => {
    const draft = withoutPassage(buildValidExamImportDraft());
    draft.sections[0]!.questions = [
      {
        id: 'question-tf',
        kind: 'true_false_group',
        order: 0,
        sourceNumber: '1',
        promptHtml: '<p>Judge each statement.</p>',
        points: 1,
        cognitiveLevel: null,
        passageId: null,
        statements: [
          { id: 'statement-a', sourceLabel: 'a', html: '<p>First</p>', order: 0 },
          { id: 'statement-b', sourceLabel: 'b', html: '<p>Second</p>', order: 1 }
        ],
        scoring: { mode: 'tiered', tiers: [0, 0.5, 1] },
        answerCandidates: [
          {
            id: 'candidate-tf',
            kind: 'true_false_group',
            source: 'explicit_line',
            provenance: [sourceSpan],
            answers: [
              { statementId: 'statement-a', correctValue: true },
              { statementId: 'statement-b', correctValue: false }
            ]
          }
        ],
        answerKey: {
          kind: 'true_false_group',
          agreement: 'single_source',
          selectedCandidateIds: ['candidate-tf'],
          conflictingCandidateIds: [],
          answers: [
            { statementId: 'statement-a', correctValue: true },
            { statementId: 'statement-b', correctValue: false }
          ]
        },
        confidence: 'medium',
        review: 'clean',
        provenance: [sourceSpan]
      }
    ];
    draft.fieldStates = [];

    const plan = createExamImportPublishPlan(draft, validationContext);
    const entry = plan.sections[0]?.entries[0];

    expect(entry?.kind).toBe('assessment_item');
    if (entry?.kind !== 'assessment_item') throw new Error('Expected a canonical item');
    expect(entry.definition.blocks[0]).toMatchObject({
      kind: 'interaction',
      interaction: {
        kind: 'true_false_group',
        maxScore: 1,
        config: {
          statements: [
            { id: 'statement-a', html: '<p>First</p>', correctValue: true },
            { id: 'statement-b', html: '<p>Second</p>', correctValue: false }
          ],
          scoring: { mode: 'tiered', tiers: [0, 0.5, 1] }
        }
      }
    });
  });

  it('groups questions sharing a passage into one passage-split assessment item', () => {
    const draft = buildValidExamImportDraft();
    const firstQuestion = draft.sections[0]!.questions[0]!;
    if (firstQuestion.kind !== 'choice') throw new Error('Expected choice fixture');
    firstQuestion.points = 1;
    const secondQuestion = structuredClone(firstQuestion);
    secondQuestion.id = 'question-2';
    secondQuestion.order = 1;
    secondQuestion.sourceNumber = '2';
    secondQuestion.options = secondQuestion.options.map((option) => ({
      ...option,
      id: `${option.id}-2`
    }));
    secondQuestion.answerCandidates = [
      {
        id: 'candidate-2',
        kind: 'choice',
        correctOptionIds: ['option-a-2'],
        source: 'explicit_line',
        provenance: [sourceSpan]
      }
    ];
    secondQuestion.answerKey = {
      kind: 'choice',
      correctOptionIds: ['option-a-2'],
      agreement: 'single_source',
      selectedCandidateIds: ['candidate-2'],
      conflictingCandidateIds: []
    };
    draft.sections[0]!.questions.push(secondQuestion);
    draft.fieldStates = [];

    const plan = createExamImportPublishPlan(draft, validationContext);
    const entry = plan.sections[0]?.entries[0];

    expect(plan.sections[0]?.entries).toHaveLength(1);
    expect(entry?.kind).toBe('assessment_item');
    if (entry?.kind !== 'assessment_item') throw new Error('Expected a canonical item');
    expect(entry.definition.presentation).toEqual({ layout: 'passage_split' });
    expect(entry.definition.blocks.map((block) => block.kind)).toEqual(['content', 'interaction', 'interaction']);
  });

  it('fails closed when the validated draft still has a blocking finding', () => {
    const draft = withoutPassage(buildValidExamImportDraft());
    draft.diagnostics.push({
      tier: 'semantic',
      severity: 'error',
      blocking: true,
      code: 'MANUAL_BLOCK',
      message: 'Teacher must resolve this finding',
      messageKey: 'exam_import.diagnostics.manual_block',
      questionId: null,
      target: null,
      provenance: []
    });

    expect(() => createExamImportPublishPlan(draft, validationContext)).toThrowError(
      expect.objectContaining<Partial<ExamImportPublishPlanError>>({
        code: 'DRAFT_NOT_PUBLISHABLE'
      })
    );
  });
});
