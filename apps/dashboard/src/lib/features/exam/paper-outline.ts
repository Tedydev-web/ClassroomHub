import { getAssessmentVerticalSliceResponseProgress } from '@cio/question-types';
import type { AssessmentDeliveryDefinition, AssessmentResponseEnvelope } from '@cio/question-types';

/**
 * The numbers a candidate reads beside the questions of an exam paper, and the outline
 * that lets them jump between them.
 *
 * An item is not a question. A passage carrying six sub-questions is one item and six
 * numbers, so numbering has to run across interactions and not across items — a paper of
 * ten items really can be forty questions. Getting that wrong does not look like a bug: it
 * looks like a shorter paper, which is how a preview came to show a highest number of 17
 * for a paper of 40 while appearing to render everything.
 *
 * Shared by the paper a candidate sits and the preview a teacher reads, so the preview
 * cannot quietly drift into numbering the same paper differently from the real thing.
 */

export type PaperQuestion = {
  questionId: number;
  definition: AssessmentDeliveryDefinition;
};

export type OutlineQuestion = {
  key: string;
  label: string;
  isCurrent: boolean;
  isAnswered: boolean;
};

export type OutlineGroup = {
  id: string;
  title: string;
  isCurrent: boolean;
  questions: OutlineQuestion[];
};

/** How many numbered questions an item contributes, whatever it is made of. */
export function countInteractions(question: PaperQuestion): number {
  return getAssessmentVerticalSliceResponseProgress(question.definition, null).total;
}

/**
 * The first number each item carries, keyed by question id.
 *
 * Both the item header and the numbering inside it start from this, which is what makes
 * the seventh question the seventh question rather than the second item.
 */
export function questionNumberStarts(questions: PaperQuestion[]): Record<number, number> {
  const starts: Record<number, number> = {};
  let next = 1;

  for (const question of questions) {
    starts[question.questionId] = next;
    next += countInteractions(question);
  }

  return starts;
}

export type OutlineLabels = {
  /** A passage covering questions `start` to `end`. */
  range: (start: string, end: string) => string;
  /** A single question, by its number. */
  single: (index: string) => string;
};

/**
 * The outline groups, one per item, each holding one entry per numbered question.
 *
 * `answered` is asked for per item rather than read from a store so a preview — which has
 * no answers and never will — can use the same code as the paper being sat.
 */
export function buildOutlineGroups(
  questions: PaperQuestion[],
  options: {
    currentIndex: number;
    labels: OutlineLabels;
    answered?: (question: PaperQuestion) => AssessmentResponseEnvelope | null;
  }
): OutlineGroup[] {
  let number = 1;

  return questions.map((question, index) => {
    const envelope = options.answered?.(question) ?? null;
    const answeredIds = new Set(
      (envelope?.responses ?? []).map((entry: { interactionId: string }) => entry.interactionId)
    );
    const interactions = (question.definition?.blocks ?? []).filter(
      (block: { kind?: string }) => block.kind === 'interaction'
    );

    const isCurrent = index + 1 === options.currentIndex;

    const outlineQuestions = interactions.map((block: { id: string }) => {
      const label = String(number);
      number += 1;

      return {
        key: `${question.questionId}-${block.id}`,
        label,
        isCurrent,
        isAnswered: answeredIds.has(block.id)
      };
    });

    return {
      id: String(question.questionId),
      title:
        outlineQuestions.length > 1
          ? options.labels.range(
              outlineQuestions[0]?.label ?? '',
              outlineQuestions[outlineQuestions.length - 1]?.label ?? ''
            )
          : options.labels.single(outlineQuestions[0]?.label ?? ''),
      isCurrent,
      questions: outlineQuestions
    };
  });
}
