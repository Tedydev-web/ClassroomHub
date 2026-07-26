import { describe, expect, it } from 'vitest';
import {
  MAX_EXAM_IMPORT_DIAGNOSTICS,
  MAX_EXAM_IMPORT_PROVENANCE_SPANS,
  examImportDraftSchema
} from '../src/draft/exam-import-draft';
import { reconcileExamImportDraftAnswers } from '../src/draft/exam-import-reconciliation';
import { validateExamImportDraft } from '../src/draft/exam-import-validation';
import type { ExamImportDraft, ExamImportQuestion } from '../src/draft/exam-import-draft';
import { buildValidExamImportDraft, sourceSpan } from './fixtures/exam-import-draft-fixture';

const enabledQuestionKinds = new Set(['choice', 'true_false_group', 'short_answer', 'numeric', 'essay'] as const);
const validationContext = {
  enabledQuestionKinds,
  sanitizeHtml: (html: string) => html
};

type ChoiceCandidate = Extract<ExamImportQuestion, { kind: 'choice' }>['answerCandidates'][number];

function choiceDraftWithCandidates(candidates: ChoiceCandidate[]): ExamImportDraft {
  const draft = buildValidExamImportDraft();
  const question = draft.sections[0]!.questions[0]!;
  if (question.kind !== 'choice') throw new Error('Expected choice fixture');
  question.answerCandidates = candidates;
  question.answerKey = null;
  question.confidence = 'none';
  question.review = 'unresolved';
  draft.fieldStates = draft.fieldStates.filter(
    (fieldState) => !(fieldState.target.kind === 'question_field' && fieldState.target.field === 'answerKey')
  );

  return draft;
}

function choiceCandidate(
  id: string,
  source: ChoiceCandidate['source'],
  correctOptionId: 'option-a' | 'option-b'
): ChoiceCandidate {
  return {
    id,
    kind: 'choice',
    correctOptionIds: [correctOptionId],
    source,
    provenance: [sourceSpan]
  };
}

function firstChoice(draft: ExamImportDraft): Extract<ExamImportQuestion, { kind: 'choice' }> {
  const question = draft.sections[0]!.questions[0]!;
  if (question.kind !== 'choice') throw new Error('Expected choice fixture');

  return question;
}

describe('answer candidate reconciliation', () => {
  it('keeps a keyless question unresolved without inventing an answer', () => {
    const reconciled = reconcileExamImportDraftAnswers(choiceDraftWithCandidates([]));
    const question = firstChoice(reconciled);

    expect(question.answerKey).toBeNull();
    expect(question.confidence).toBe('none');
    expect(question.review).toBe('unresolved');
    expect(reconciled.diagnostics.map((diagnostic) => diagnostic.code)).toContain('ANSWER_KEY_MISSING');
  });

  it('accepts one deterministic source at medium confidence', () => {
    const draft = choiceDraftWithCandidates([choiceCandidate('explicit', 'explicit_line', 'option-b')]);
    const reconciled = reconcileExamImportDraftAnswers(draft);
    const question = firstChoice(reconciled);

    expect(question.answerKey).toMatchObject({
      kind: 'choice',
      correctOptionIds: ['option-b'],
      agreement: 'single_source',
      selectedCandidateIds: ['explicit'],
      conflictingCandidateIds: []
    });
    expect(question.confidence).toBe('medium');
    expect(question.review).toBe('clean');
    expect(validateExamImportDraft(reconciled, validationContext).publishable).toBe(true);
  });

  it('raises deterministic agreement from independent sources to high confidence', () => {
    const draft = choiceDraftWithCandidates([
      choiceCandidate('table', 'answer_table', 'option-b'),
      choiceCandidate('emphasis', 'emphasis', 'option-b')
    ]);
    const question = firstChoice(reconcileExamImportDraftAnswers(draft));

    expect(question.answerKey).toMatchObject({
      agreement: 'unanimous',
      selectedCandidateIds: ['table', 'emphasis'],
      conflictingCandidateIds: []
    });
    expect(question.confidence).toBe('high');
    expect(question.review).toBe('clean');
  });

  it('lets one internally consistent answer table win a source conflict and preserves both candidates', () => {
    const draft = choiceDraftWithCandidates([
      choiceCandidate('table', 'answer_table', 'option-b'),
      choiceCandidate('emphasis', 'emphasis', 'option-a')
    ]);
    const reconciled = reconcileExamImportDraftAnswers(draft);
    const question = firstChoice(reconciled);

    expect(question.answerKey).toMatchObject({
      correctOptionIds: ['option-b'],
      agreement: 'conflict',
      selectedCandidateIds: ['table'],
      conflictingCandidateIds: ['emphasis']
    });
    expect(question.confidence).toBe('low');
    expect(question.review).toBe('needs_attention');
    expect(reconciled.diagnostics.map((diagnostic) => diagnostic.code)).toContain('ANSWER_SOURCE_CONFLICT');
    expect(validateExamImportDraft(reconciled, validationContext).publishable).toBe(false);
  });

  it('does not guess when deterministic sources conflict without an answer table', () => {
    const draft = choiceDraftWithCandidates([
      choiceCandidate('explicit', 'explicit_line', 'option-b'),
      choiceCandidate('emphasis', 'emphasis', 'option-a')
    ]);
    const reconciled = reconcileExamImportDraftAnswers(draft);
    const question = firstChoice(reconciled);

    expect(question.answerKey).toBeNull();
    expect(question.review).toBe('unresolved');
    expect(reconciled.diagnostics.map((diagnostic) => diagnostic.code)).toContain('ANSWER_SOURCE_CONFLICT_UNRESOLVED');
  });

  it('does not guess when answer-table candidates disagree with each other', () => {
    const draft = choiceDraftWithCandidates([
      choiceCandidate('table-1', 'answer_table', 'option-b'),
      choiceCandidate('table-2', 'answer_table', 'option-a')
    ]);
    const reconciled = reconcileExamImportDraftAnswers(draft);

    expect(firstChoice(reconciled).answerKey).toBeNull();
    expect(reconciled.diagnostics.map((diagnostic) => diagnostic.code)).toContain('ANSWER_SOURCE_CONFLICT_UNRESOLVED');
  });

  it('keeps an AI-only answer low confidence and blocked for teacher confirmation', () => {
    const draft = choiceDraftWithCandidates([choiceCandidate('ai', 'ai', 'option-b')]);
    const reconciled = reconcileExamImportDraftAnswers(draft);
    const question = firstChoice(reconciled);

    expect(question.answerKey).toMatchObject({ correctOptionIds: ['option-b'] });
    expect(question.confidence).toBe('low');
    expect(question.review).toBe('needs_attention');
    expect(reconciled.diagnostics.map((diagnostic) => diagnostic.code)).toContain('AI_ANSWER_PROPOSED');
    expect(validateExamImportDraft(reconciled, validationContext).publishable).toBe(false);
  });

  it('lets an explicit teacher answer resolve prior candidates without leaving a blocking conflict', () => {
    const draft = choiceDraftWithCandidates([
      choiceCandidate('teacher', 'teacher', 'option-a'),
      choiceCandidate('table', 'answer_table', 'option-b')
    ]);
    const reconciled = reconcileExamImportDraftAnswers(draft);
    const question = firstChoice(reconciled);

    expect(question.answerKey).toMatchObject({
      correctOptionIds: ['option-a'],
      agreement: 'conflict',
      selectedCandidateIds: ['teacher'],
      conflictingCandidateIds: ['table']
    });
    expect(question.confidence).toBe('high');
    expect(question.review).toBe('clean');
    expect(reconciled.diagnostics).toEqual([]);
    expect(validateExamImportDraft(reconciled, validationContext).publishable).toBe(true);
  });

  it('reconciles true/false group candidates without flattening boolean false into missing', () => {
    const draft = buildValidExamImportDraft();
    const original = draft.sections[0]!.questions[0]!;
    draft.sections[0]!.questions = [
      {
        id: original.id,
        kind: 'true_false_group',
        order: original.order,
        sourceNumber: original.sourceNumber,
        promptHtml: original.promptHtml,
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
            id: 'table',
            kind: 'true_false_group',
            answers: [
              { statementId: 'statement-a', correctValue: true },
              { statementId: 'statement-b', correctValue: false }
            ],
            source: 'answer_table',
            provenance: [sourceSpan]
          }
        ],
        answerKey: null,
        confidence: 'none',
        review: 'unresolved',
        provenance: original.provenance
      }
    ];
    draft.fieldStates = [];

    const reconciled = reconcileExamImportDraftAnswers(draft);
    const question = reconciled.sections[0]!.questions[0]!;

    expect(question.answerKey).toMatchObject({
      kind: 'true_false_group',
      answers: [
        { statementId: 'statement-a', correctValue: true },
        { statementId: 'statement-b', correctValue: false }
      ]
    });
  });

  it('bounds reconciled provenance when many candidates agree', () => {
    const candidates = Array.from({ length: 500 }, (_, index): ChoiceCandidate => {
      const firstBlockIndex = index * 2;

      return {
        id: `candidate-${index}`,
        kind: 'choice',
        correctOptionIds: ['option-a'],
        source: 'answer_table',
        provenance: [
          {
            start: { blockIndex: firstBlockIndex, runIndex: 0 },
            end: { blockIndex: firstBlockIndex, runIndex: 0 },
            pageStart: null,
            pageEnd: null
          },
          {
            start: { blockIndex: firstBlockIndex + 1, runIndex: 0 },
            end: { blockIndex: firstBlockIndex + 1, runIndex: 0 },
            pageStart: null,
            pageEnd: null
          }
        ]
      };
    });
    const reconciled = reconcileExamImportDraftAnswers(choiceDraftWithCandidates(candidates));
    const answerState = reconciled.fieldStates.find(
      (fieldState) => fieldState.target.kind === 'question_field' && fieldState.target.field === 'answerKey'
    );

    expect(answerState?.provenance.length).toBeLessThanOrEqual(MAX_EXAM_IMPORT_PROVENANCE_SPANS);
    expect(examImportDraftSchema.safeParse(reconciled).success).toBe(true);
  });

  it('keeps every missing-key diagnostic schema-valid at the maximum question scale', () => {
    const draft = buildValidExamImportDraft();
    const questionTemplate = firstChoice(draft);
    draft.fieldStates = [];
    draft.sharedContents = [];
    draft.diagnostics = [];
    draft.sections = Array.from({ length: 5 }, (_, sectionIndex) => {
      const sectionStart = sectionIndex * 500;
      const sectionQuestionCount = sectionIndex === 4 ? 1 : 500;

      return {
        id: `section-${sectionIndex + 1}`,
        title: `Part ${sectionIndex + 1}`,
        order: sectionIndex,
        questions: Array.from({ length: sectionQuestionCount }, (_, questionIndex) => {
          const globalIndex = sectionStart + questionIndex + 1;
          const questionId = `question-${globalIndex}`;

          return {
            ...structuredClone(questionTemplate),
            id: questionId,
            order: globalIndex - 1,
            sourceNumber: String(globalIndex),
            passageId: null,
            options: questionTemplate.options.map((option) => ({
              ...option,
              id: `${questionId}-${option.sourceLabel.toLowerCase()}`
            })),
            answerCandidates: [],
            answerKey: null,
            confidence: 'none' as const,
            review: 'unresolved' as const
          };
        })
      };
    });

    const reconciled = reconcileExamImportDraftAnswers(draft);

    expect(reconciled.diagnostics).toHaveLength(2_001);
    expect(examImportDraftSchema.safeParse(reconciled).success).toBe(true);
  });

  it('fails closed with a summary when a valid input already fills the diagnostic budget', () => {
    const draft = choiceDraftWithCandidates([]);
    draft.diagnostics = Array.from({ length: MAX_EXAM_IMPORT_DIAGNOSTICS }, () => ({
      tier: 'semantic' as const,
      severity: 'warning' as const,
      blocking: false,
      code: 'EXISTING_WARNING',
      message: 'Existing source warning',
      messageKey: 'exam_import.diagnostics.existing_warning',
      questionId: null,
      target: null,
      provenance: [sourceSpan]
    }));

    const reconciled = reconcileExamImportDraftAnswers(draft);

    expect(reconciled.diagnostics).toHaveLength(MAX_EXAM_IMPORT_DIAGNOSTICS);
    expect(reconciled.diagnostics.at(-1)).toMatchObject({
      code: 'DIAGNOSTICS_TRUNCATED',
      blocking: true
    });
    expect(examImportDraftSchema.safeParse(reconciled).success).toBe(true);
    expect(reconcileExamImportDraftAnswers(reconciled)).toEqual(reconciled);
  });

  it('is deterministic and idempotent', () => {
    const draft = choiceDraftWithCandidates([
      choiceCandidate('table', 'answer_table', 'option-b'),
      choiceCandidate('emphasis', 'emphasis', 'option-b')
    ]);
    const once = reconcileExamImportDraftAnswers(draft);
    const twice = reconcileExamImportDraftAnswers(once);

    expect(twice).toEqual(once);
    expect(draft).toEqual(choiceDraftWithCandidates(draft.sections[0]!.questions[0]!.answerCandidates));
  });
});
