import {
  MAX_ASSESSMENT_INTERACTIONS,
  QUESTION_TYPE_IDS,
  validateAssessmentItemForPublish,
  type AssessmentInteraction,
  type AssessmentItemDefinition,
  type ItemFeedback
} from '@cio/question-types';
import { validateExamImportDraft, type ExamImportValidationContext } from '../draft/exam-import-validation';
import type { ExamImportDiagnostic, ExamImportDraft, ExamImportQuestion } from '../draft/exam-import-draft';

export const DEFAULT_EXAM_IMPORT_QUESTION_POINTS = 1;

export type ExamImportLegacyQuestionPlan = {
  kind: 'legacy_question';
  sourceQuestionId: string;
  order: number;
  question: string;
  questionTypeId: number;
  points: number;
  settings: Record<string, unknown>;
  options: Array<{
    label: string;
    isCorrect: boolean;
    settings: Record<string, unknown>;
  }>;
};

export type ExamImportAssessmentItemPlan = {
  kind: 'assessment_item';
  sourceQuestionIds: string[];
  clientMutationId: string;
  order: number;
  title: string;
  definition: AssessmentItemDefinition;
};

export type ExamImportPublishSectionPlan = {
  sourceSectionId: string;
  title: string;
  order: number;
  entries: Array<ExamImportLegacyQuestionPlan | ExamImportAssessmentItemPlan>;
};

export type ExamImportPublishPlan = {
  title: string;
  sections: ExamImportPublishSectionPlan[];
};

export type ExamImportPublishPlanErrorCode = 'CANONICAL_DEFINITION_INVALID' | 'DRAFT_NOT_PUBLISHABLE';

export class ExamImportPublishPlanError extends Error {
  constructor(
    readonly code: ExamImportPublishPlanErrorCode,
    message: string,
    readonly findings: readonly ExamImportDiagnostic[] = []
  ) {
    super(message);
    this.name = 'ExamImportPublishPlanError';
  }
}

type PublishableQuestion = Exclude<ExamImportQuestion, { kind: 'unresolved' }>;

function questionPoints(question: PublishableQuestion): number {
  return question.points ?? DEFAULT_EXAM_IMPORT_QUESTION_POINTS;
}

function containsHtmlMarkup(value: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(value);
}

function hasRichHtml(question: PublishableQuestion): boolean {
  if (containsHtmlMarkup(question.promptHtml)) {
    return true;
  }

  if (question.kind === 'choice') {
    return question.options.some((option) => containsHtmlMarkup(option.html));
  }

  return false;
}

function isLegacyCompatible(question: PublishableQuestion): boolean {
  if (
    question.kind === 'true_false_group' ||
    question.passageId !== null ||
    hasRichHtml(question) ||
    (question.kind === 'choice' && (question.scoreWeights !== undefined || (question.feedback?.length ?? 0) > 0))
  ) {
    return false;
  }

  return Number.isInteger(questionPoints(question));
}

function toLegacyQuestion(question: Exclude<PublishableQuestion, { kind: 'true_false_group' }>, order: number) {
  const base = {
    kind: 'legacy_question' as const,
    sourceQuestionId: question.id,
    order,
    question: question.promptHtml,
    points: questionPoints(question),
    options: [] as ExamImportLegacyQuestionPlan['options']
  };

  switch (question.kind) {
    case 'choice': {
      const correctOptionIds = new Set(question.answerKey!.correctOptionIds);

      return {
        ...base,
        questionTypeId: question.cardinality === 'single' ? QUESTION_TYPE_IDS.RADIO : QUESTION_TYPE_IDS.CHECKBOX,
        settings: {},
        options: [...question.options]
          .sort((left, right) => left.order - right.order)
          .map((option) => ({
            label: option.html,
            isCorrect: correctOptionIds.has(option.id),
            settings: {}
          }))
      };
    }
    case 'short_answer':
      return {
        ...base,
        questionTypeId: QUESTION_TYPE_IDS.SHORT_ANSWER,
        settings: { acceptedAnswers: question.answerKey!.acceptedAnswers.join(',') }
      };
    case 'numeric':
      return {
        ...base,
        questionTypeId: QUESTION_TYPE_IDS.NUMERIC,
        settings: {
          correctValue: question.answerKey!.value,
          tolerance: question.answerKey!.tolerance ?? 0
        }
      };
    case 'essay':
      return {
        ...base,
        questionTypeId: QUESTION_TYPE_IDS.TEXTAREA,
        settings: {}
      };
  }
}

function toInteraction(question: PublishableQuestion): AssessmentInteraction {
  const base = {
    prompt: { format: 'html' as const, html: question.promptHtml },
    required: true,
    maxScore: questionPoints(question)
  };

  switch (question.kind) {
    case 'choice':
      return {
        kind: 'choice',
        ...base,
        config: {
          cardinality: question.cardinality,
          presentation: 'list',
          options: [...question.options]
            .sort((left, right) => left.order - right.order)
            .map((option) => ({ id: option.id, html: option.html })),
          correctOptionIds: question.answerKey!.correctOptionIds,
          ...(question.scoreWeights ? { scoreWeights: question.scoreWeights } : {})
        }
      };
    case 'true_false_group': {
      const correctValues = new Map(
        question.answerKey!.answers.map((answer) => [answer.statementId, answer.correctValue])
      );

      return {
        kind: 'true_false_group',
        ...base,
        config: {
          statements: [...question.statements]
            .sort((left, right) => left.order - right.order)
            .map((statement) => ({
              id: statement.id,
              html: statement.html,
              correctValue: correctValues.get(statement.id)!
            })),
          scoring: question.scoring
        }
      };
    }
    case 'short_answer':
      return {
        kind: 'text',
        ...base,
        config: { format: 'plain' }
      };
    case 'numeric':
      return {
        kind: 'numeric',
        ...base,
        config: {
          correctValue: question.answerKey!.value,
          tolerance: question.answerKey!.tolerance ?? 0
        }
      };
    case 'essay':
      return {
        kind: 'text',
        ...base,
        config: { format: 'rich' }
      };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toFeedback(questions: readonly PublishableQuestion[]): ItemFeedback[] {
  return questions.flatMap((question, questionIndex): ItemFeedback[] => {
    if (question.kind === 'choice') {
      return (question.feedback ?? []).map((feedback, feedbackIndex) =>
        feedback.optionId === null
          ? {
              id: `feedback-${questionIndex + 1}-${feedbackIndex + 1}`,
              scope: 'item' as const,
              html: feedback.html,
              visibility: 'after_grading' as const
            }
          : {
              id: `feedback-${questionIndex + 1}-${feedbackIndex + 1}`,
              scope: 'choice_option' as const,
              interactionId: question.id,
              optionId: feedback.optionId,
              html: feedback.html,
              visibility: 'after_grading' as const
            }
      );
    }
    if (question.kind !== 'short_answer') return [];

    const sourceNumber = question.sourceNumber ? `<strong>${escapeHtml(question.sourceNumber)}:</strong> ` : '';
    const acceptedAnswers = question.answerKey!.acceptedAnswers.map(escapeHtml).join(' / ');

    return [
      {
        id: `feedback-${questionIndex + 1}`,
        scope: 'item' as const,
        html: `<p>${sourceNumber}${acceptedAnswers}</p>`,
        visibility: 'after_grading' as const
      }
    ];
  });
}

function assessmentItemTitle(questions: readonly PublishableQuestion[]): string {
  const first = questions[0]!;
  const last = questions.at(-1)!;
  if (first.sourceNumber && last.sourceNumber && first.id !== last.id) {
    return `${first.sourceNumber}-${last.sourceNumber}`;
  }

  return first.sourceNumber ?? first.promptHtml;
}

function toAssessmentItem(
  questions: readonly PublishableQuestion[],
  sharedContent: ExamImportDraft['sharedContents'][number] | null,
  order: number,
  chunkIndex: number
): ExamImportAssessmentItemPlan {
  const definition: AssessmentItemDefinition = {
    schemaVersion: 1,
    ...(sharedContent ? { presentation: { layout: 'passage_split' as const } } : {}),
    blocks: [
      ...(sharedContent
        ? [
            {
              id: sharedContent.id,
              kind: 'content' as const,
              content: { format: 'html' as const, html: sharedContent.html }
            }
          ]
        : []),
      ...questions.map((question) => ({
        id: question.id,
        kind: 'interaction' as const,
        interaction: toInteraction(question)
      }))
    ],
    feedback: toFeedback(questions)
  };
  const validated = validateAssessmentItemForPublish(definition);
  if (!validated.success) {
    throw new ExamImportPublishPlanError(
      'CANONICAL_DEFINITION_INVALID',
      `Exam import produced an invalid canonical assessment item: ${validated.issues
        .map((issue) => issue.message)
        .join('; ')}`
    );
  }

  const firstQuestion = questions[0]!;

  return {
    kind: 'assessment_item',
    sourceQuestionIds: questions.map((question) => question.id),
    clientMutationId: `exam-import:${firstQuestion.id}:${chunkIndex}`,
    order,
    title: assessmentItemTitle(questions),
    definition: validated.data
  };
}

function buildSectionEntries(
  draft: ExamImportDraft,
  section: ExamImportDraft['sections'][number]
): ExamImportPublishSectionPlan['entries'] {
  const sharedContentsById = new Map(draft.sharedContents.map((content) => [content.id, content]));
  const questions = [...section.questions]
    .filter((question): question is PublishableQuestion => question.kind !== 'unresolved')
    .sort((left, right) => left.order - right.order);
  const questionsByPassageId = new Map<string, PublishableQuestion[]>();
  for (const question of questions) {
    if (question.passageId === null) continue;
    const passageQuestions = questionsByPassageId.get(question.passageId) ?? [];
    passageQuestions.push(question);
    questionsByPassageId.set(question.passageId, passageQuestions);
  }

  const entries: ExamImportPublishSectionPlan['entries'] = [];
  const emittedPassageIds = new Set<string>();
  for (const question of questions) {
    if (question.passageId !== null) {
      if (emittedPassageIds.has(question.passageId)) continue;
      emittedPassageIds.add(question.passageId);
      const passageQuestions = questionsByPassageId.get(question.passageId)!;
      const sharedContent = sharedContentsById.get(question.passageId)!;
      for (let offset = 0; offset < passageQuestions.length; offset += MAX_ASSESSMENT_INTERACTIONS) {
        const chunk = passageQuestions.slice(offset, offset + MAX_ASSESSMENT_INTERACTIONS);
        entries.push(
          toAssessmentItem(chunk, sharedContent, entries.length, Math.floor(offset / MAX_ASSESSMENT_INTERACTIONS))
        );
      }
      continue;
    }

    if (isLegacyCompatible(question)) {
      entries.push(
        toLegacyQuestion(question as Exclude<PublishableQuestion, { kind: 'true_false_group' }>, entries.length)
      );
      continue;
    }

    entries.push(toAssessmentItem([question], null, entries.length, 0));
  }

  return entries;
}

export function createExamImportPublishPlan(
  value: unknown,
  context: ExamImportValidationContext
): ExamImportPublishPlan {
  const validation = validateExamImportDraft(value, context);
  if (!validation.publishable || validation.draft === null) {
    throw new ExamImportPublishPlanError(
      'DRAFT_NOT_PUBLISHABLE',
      'Exam import draft has blocking findings',
      validation.findings
    );
  }

  return {
    title: validation.draft.title,
    sections: [...validation.draft.sections]
      .sort((left, right) => left.order - right.order)
      .map((section) => ({
        sourceSectionId: section.id,
        title: section.title,
        order: section.order,
        entries: buildSectionEntries(validation.draft!, section)
      }))
  };
}
