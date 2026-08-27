import {
  getAssessmentInteractionBlocks,
  getUnsupportedAssessmentVerticalSliceInteractionKinds,
  scoreAssessmentVerticalSlice,
  validateAssessmentResponseEnvelope,
  type AssessmentItemDefinition
} from '@cio/question-types';

const OPTION_LABELS = 'ABCDEFGHIJ';

export type MarkedOption = { label: string; html: string };

export type MarkedInteraction = {
  interactionId: string;
  /** The number the candidate saw, continuous across the whole paper. */
  number: number;
  chosen: MarkedOption[];
  correct: MarkedOption[];
  /** `null` when a hand mark decides it, or when nothing was chosen. */
  isCorrect: boolean | null;
  needsManual: boolean;
};

export type MarkedItem = {
  questionId: number;
  firstNumber: number;
  lastNumber: number;
  sharedHtml: string | null;
  interactions: MarkedInteraction[];
  autoScore: number | null;
  maxScore: number;
  needsManual: boolean;
  unreadable: boolean;
  /**
   * The item scored nothing because the paper's own rules rejected the responses — in
   * practice, a required question left blank. The answers beside it are still shown right
   * or wrong, so a marker can see what happened rather than eight unexplained blank rows.
   */
  scoreBlocked: boolean;
};

type PaperQuestion = {
  questionId: number;
  points?: number | string | null;
  definition: AssessmentItemDefinition;
};

type StoredAnswer = {
  responses?: Array<{ interactionId?: string; response?: { selectedOptionIds?: string[] } }>;
};

/**
 * The paper as a marker reads it: real question numbers, the option the candidate chose in
 * words, and the key beside it when they were wrong.
 *
 * The screen this replaces printed option ids — `question-12-option-a` — because it never
 * resolved them against the paper, and it numbered by assessment item, so a passage holding
 * five questions showed as a single "7". Both are fixed here rather than in the template,
 * so the numbering can be checked against a real paper without a browser.
 *
 * Scoring runs the same two steps in the same order the server grades with, so what a
 * teacher reads and what the total says cannot drift apart.
 */
export function markAttemptPaper(
  questions: readonly PaperQuestion[],
  answersByQuestionId: ReadonlyMap<number, unknown>
): MarkedItem[] {
  let next = 1;

  return questions.map((question) => {
    const definition = question.definition;
    const blocks = getAssessmentInteractionBlocks(definition);
    const firstNumber = next;
    next += blocks.length;

    const shared = ((definition as { blocks?: Array<{ kind: string; content?: { html?: string } }> }).blocks ?? [])
      .filter((block) => block.kind === 'content')
      .map((block) => block.content?.html ?? '')
      .join('');

    const answer = answersByQuestionId.get(question.questionId) as StoredAnswer | undefined;
    const chosenByInteraction = new Map<string, string[]>(
      (answer?.responses ?? []).map((entry) => [entry.interactionId ?? '', entry.response?.selectedOptionIds ?? []])
    );

    // Validate, then score. The scorer takes the validated responses rather than the stored
    // envelope, and throws on an item it cannot read rather than guessing. One unreadable
    // item must not take the rest of the paper down with it.
    let scored: ReturnType<typeof scoreAssessmentVerticalSlice> | null = null;
    try {
      const validated = validateAssessmentResponseEnvelope(definition, answer as never);
      scored = validated.success ? scoreAssessmentVerticalSlice(definition, validated.data) : null;
    } catch {
      scored = null;
    }
    const scoreByInteraction = new Map((scored?.interactionScores ?? []).map((entry) => [entry.interactionId, entry]));

    const interactions = blocks.map((block, index): MarkedInteraction => {
      const config = (
        block.interaction as {
          config?: { options?: Array<{ id: string; html: string }>; correctOptionIds?: string[] };
        }
      ).config;
      const options = config?.options ?? [];
      const describe = (optionId: string): MarkedOption => {
        const position = options.findIndex((option) => option.id === optionId);

        return {
          label: position >= 0 ? (OPTION_LABELS[position] ?? String(position + 1)) : '?',
          html: options[position]?.html ?? ''
        };
      };

      // Read from the question, not from the answer. An unanswered paper produces no score
      // at all, and asking the score whether a hand mark is owed then said "no" for every
      // essay a candidate skipped — exactly the ones a marker has to open.
      const needsManual = (block.interaction as { kind?: string }).kind === 'text';
      const interactionScore = scoreByInteraction.get(block.id);
      const chosenIds = chosenByInteraction.get(block.id) ?? [];
      const correctIds = config?.correctOptionIds ?? [];

      /**
       * Prefer the scorer's verdict; fall back to the key when it has none.
       *
       * One required question left blank makes the whole item fail validation, and with it
       * every sibling question's verdict. On the paper that prompted this, that hid whether
       * seven answered questions were right because an eighth was skipped. The fallback
       * compares against the same key the scorer would have used, so it cannot disagree with
       * the score — the item simply scores zero, which `scoreBlocked` says out loud.
       */
      const verdict = (): boolean | null => {
        if (needsManual || chosenIds.length === 0) return null;
        if (interactionScore !== undefined) return (interactionScore.score ?? 0) >= interactionScore.maxScore;
        if (correctIds.length === 0) return null;

        return chosenIds.length === correctIds.length && chosenIds.every((optionId) => correctIds.includes(optionId));
      };

      return {
        interactionId: block.id,
        number: firstNumber + index,
        chosen: chosenIds.map(describe),
        correct: correctIds.map(describe),
        isCorrect: verdict(),
        needsManual
      };
    });

    return {
      questionId: question.questionId,
      firstNumber,
      lastNumber: next - 1,
      sharedHtml: shared.length > 0 ? shared : null,
      interactions,
      autoScore: scored?.autoScore ?? null,
      maxScore: Number(question.points ?? 0),
      needsManual: interactions.some((entry) => entry.needsManual),
      // Unreadable means the *paper* holds something this build cannot mark, not that the
      // candidate left it blank.
      unreadable: getUnsupportedAssessmentVerticalSliceInteractionKinds(definition).length > 0,
      scoreBlocked: scored === null && blocks.length > 0 && answer !== undefined
    };
  });
}
