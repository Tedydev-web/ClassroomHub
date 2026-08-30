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
  /** Marked by the candidate to come back to. Never sent anywhere; it is their own note. */
  isBookmarked: boolean;
  /** Whether the candidate wrote something down against this number. */
  hasNote: boolean;
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

/**
 * The span of numbers each item covers, keyed by question id.
 *
 * An item is not a question: a passage holding six is one row in the database and six
 * numbers on the paper. Anything reporting on an item to a person therefore has to say the
 * numbers rather than the id, and a span rather than a single figure — the activity log
 * records which item was answered, and "question 160" is a database key that appears
 * nowhere on the paper a teacher is holding.
 */
export function questionNumberRanges(questions: PaperQuestion[]): Record<number, { start: number; end: number }> {
  const ranges: Record<number, { start: number; end: number }> = {};
  let next = 1;

  for (const question of questions) {
    const count = countInteractions(question);
    // An item contributing nothing still gets a span, so a caller never has to guess whether
    // a missing entry means "no questions" or "not on this paper".
    ranges[question.questionId] = { start: next, end: next + Math.max(0, count - 1) };
    next += count;
  }

  return ranges;
}

/**
 * The number printed beside each interaction, keyed by the id the answer log records.
 *
 * This is the mapping that turns a stored answer back into something a teacher can look up
 * on the paper in front of them. An item id cannot do it — a passage is one item and six
 * numbers — but an interaction is exactly one number, which is the whole reason the answer
 * envelope records interactions rather than items.
 */
export function interactionQuestionNumbers(questions: PaperQuestion[]): Record<string, number> {
  const numbers: Record<string, number> = {};
  let next = 1;

  for (const question of questions) {
    const blocks = (question.definition?.blocks ?? []) as Array<{ kind?: string; id?: string }>;

    for (const block of blocks) {
      if (block.kind !== 'interaction' || !block.id) continue;

      numbers[block.id] = next;
      next += 1;
    }
  }

  return numbers;
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
    /**
     * The one number the candidate is on. Without it a passage of ten lights all ten as
     * current, which tells them where the passage is and not where they are — and makes a
     * jump to question 14 look identical to a jump to question 12.
     */
    currentNumber?: number | null;
    /** Numbers the candidate marked to come back to. */
    bookmarked?: ReadonlySet<number>;
    /** Numbers the candidate wrote a note against. */
    noted?: ReadonlySet<number>;
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

    const isCurrentGroup = index + 1 === options.currentIndex;

    const outlineQuestions = interactions.map((block: { id: string }) => {
      const value = number;
      const label = String(value);
      number += 1;

      return {
        key: `${question.questionId}-${block.id}`,
        label,
        // Where a number is named, only that one is current. Where none is — the candidate
        // paged here rather than jumping — the group's first question stands in, so the
        // panel still shows where they are.
        isCurrent: isCurrentGroup && (options.currentNumber == null || options.currentNumber === value),
        isAnswered: answeredIds.has(block.id),
        isBookmarked: options.bookmarked?.has(value) ?? false,
        hasNote: options.noted?.has(value) ?? false
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
      isCurrent: isCurrentGroup,
      questions: outlineQuestions
    };
  });
}
