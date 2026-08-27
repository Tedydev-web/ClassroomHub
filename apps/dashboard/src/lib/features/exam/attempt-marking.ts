import {
  getAssessmentInteractionBlocks,
  getUnsupportedAssessmentVerticalSliceInteractionKinds,
  scoreAssessmentVerticalSlice,
  validateAssessmentResponseEnvelope,
  type AssessmentItemDefinition
} from '@cio/question-types';

const OPTION_LABELS = 'ABCDEFGHIJ';

export type MarkedOption = { label: string; html: string };

/**
 * What a marker can say about one question, honestly.
 *
 * `correct | incorrect` alone could not describe this paper. Fill-in-the-blank and
 * Đúng/Sai questions score in parts, so a half-right answer was being struck through in
 * red beside a total that had counted half of it — the same contradiction the corrected-key
 * fix removed on the server, on a different axis. And every kind other than multiple choice
 * was reported as unanswered, because only `selectedOptionIds` was ever read.
 */
export type MarkedOutcome = 'correct' | 'partial' | 'incorrect' | 'manual' | 'unscored';

export type MarkedInteraction = {
  interactionId: string;
  /** The number the candidate saw, continuous across the whole paper. */
  number: number;
  kind: string;
  /** Whether the candidate left anything at all here. */
  answered: boolean;
  /** Multiple-choice selections. Empty for every other kind. */
  chosen: MarkedOption[];
  /** The options the key names. Empty for every other kind. */
  correct: MarkedOption[];
  /** What was given, in words, for the kinds that are not multiple choice. */
  givenText: string | null;
  /** What the key expects, in words, for the kinds that are not multiple choice. */
  expectedText: string | null;
  score: number | null;
  maxScore: number;
  outcome: MarkedOutcome;
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

type StoredResponse = {
  kind?: string;
  selectedOptionIds?: string[];
  value?: number;
  values?: string[];
  answers?: Array<{ statementId?: string; value?: boolean }>;
  text?: string;
};

type StoredAnswer = {
  responses?: Array<{ interactionId?: string; response?: StoredResponse }>;
};

function describeGiven(response: StoredResponse | undefined, trueLabel: string, falseLabel: string): string | null {
  if (!response) return null;
  if (response.kind === 'numeric') return response.value === undefined ? null : String(response.value);
  if (response.kind === 'fill_blank') return (response.values ?? []).join(' · ') || null;
  if (response.kind === 'text') return response.text?.trim() || null;
  if (response.kind === 'true_false_group') {
    return (response.answers ?? []).map((entry) => (entry.value ? trueLabel : falseLabel)).join(' · ') || null;
  }

  return null;
}

function describeExpected(
  interaction: { kind?: string; config?: Record<string, unknown> },
  trueLabel: string,
  falseLabel: string
): string | null {
  const config = interaction.config ?? {};
  if (interaction.kind === 'numeric') {
    const value = config.correctValue as number | null | undefined;
    if (value === null || value === undefined) return null;
    const tolerance = Number(config.tolerance ?? 0);

    return tolerance > 0 ? `${value} ± ${tolerance}` : String(value);
  }
  if (interaction.kind === 'fill_blank') {
    return ((config.acceptedAnswers as string[] | undefined) ?? []).join(' · ') || null;
  }
  if (interaction.kind === 'true_false_group') {
    const statements = (config.statements as Array<{ correctValue?: boolean }> | undefined) ?? [];

    return statements.map((statement) => (statement.correctValue ? trueLabel : falseLabel)).join(' · ') || null;
  }

  return null;
}

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
  answersByQuestionId: ReadonlyMap<number, unknown>,
  labels: { trueLabel: string; falseLabel: string } = { trueLabel: 'Đúng', falseLabel: 'Sai' }
): MarkedItem[] {
  let next = 1;

  return questions.map((question) => {
    const definition = question.definition;
    // Reading the paper's own shape can throw on a definition this build cannot parse, and
    // it sits outside the try below. An item nobody can read must cost one card, not the
    // whole marking screen.
    let blocks: ReturnType<typeof getAssessmentInteractionBlocks> = [];
    let unreadable = false;
    try {
      blocks = getAssessmentInteractionBlocks(definition);
      unreadable = getUnsupportedAssessmentVerticalSliceInteractionKinds(definition).length > 0;
    } catch {
      unreadable = true;
    }
    const firstNumber = next;
    next += blocks.length;

    const shared = ((definition as { blocks?: Array<{ kind: string; content?: { html?: string } }> }).blocks ?? [])
      .filter((block) => block.kind === 'content')
      .map((block) => block.content?.html ?? '')
      .join('');

    const answer = answersByQuestionId.get(question.questionId) as StoredAnswer | undefined;
    const responseByInteraction = new Map<string, StoredResponse>(
      (answer?.responses ?? [])
        .filter((entry) => entry.interactionId !== undefined && entry.response !== undefined)
        .map((entry) => [entry.interactionId as string, entry.response as StoredResponse])
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

    let interactionMaxTotal = 0;

    const interactions = blocks.map((block, index): MarkedInteraction => {
      const interaction = block.interaction as {
        kind?: string;
        maxScore?: number;
        config?: { options?: Array<{ id: string; html: string }>; correctOptionIds?: string[] } & Record<
          string,
          unknown
        >;
      };
      const config = interaction.config;
      const options = config?.options ?? [];
      const describe = (optionId: string): MarkedOption => {
        const position = options.findIndex((option) => option.id === optionId);

        return {
          label: position >= 0 ? (OPTION_LABELS[position] ?? String(position + 1)) : '?',
          html: options[position]?.html ?? ''
        };
      };

      const kind = interaction.kind ?? 'unknown';
      const needsManual = kind === 'text';
      const maxScore = Number(interaction.maxScore ?? 0);
      interactionMaxTotal += maxScore;

      const response = responseByInteraction.get(block.id);
      const chosenIds = kind === 'choice' ? (response?.selectedOptionIds ?? []) : [];
      const correctIds = kind === 'choice' ? (config?.correctOptionIds ?? []) : [];
      const givenText = kind === 'choice' ? null : describeGiven(response, labels.trueLabel, labels.falseLabel);
      const expectedText =
        kind === 'choice' ? null : describeExpected(interaction, labels.trueLabel, labels.falseLabel);
      const answered = kind === 'choice' ? chosenIds.length > 0 : givenText !== null;

      const interactionScore = scoreByInteraction.get(block.id);
      /**
       * The scorer's own number when it has one, so partial credit reads as partial rather
       * than as a red cross beside a total that counted it.
       *
       * When validation failed — one required question left blank invalidates the whole
       * item — there is no score, and only multiple choice can be settled from the key
       * alone. A weighted choice cannot: the scorer never consults `correctOptionIds` when
       * `scoreWeights` is present, so claiming right or wrong here would be inventing a
       * verdict the scorer would not have given.
       */
      const score = interactionScore?.score ?? null;
      const outcome = ((): MarkedOutcome => {
        if (needsManual) return 'manual';
        if (!answered) return 'unscored';
        if (score !== null) {
          if (score >= maxScore && maxScore > 0) return 'correct';

          return score > 0 ? 'partial' : 'incorrect';
        }
        if (kind !== 'choice' || correctIds.length === 0 || config?.scoreWeights !== undefined) return 'unscored';

        const chosenSet = new Set(chosenIds);
        const correctSet = new Set(correctIds);

        return chosenSet.size === correctSet.size && [...chosenSet].every((optionId) => correctSet.has(optionId))
          ? 'correct'
          : 'incorrect';
      })();

      return {
        interactionId: block.id,
        number: firstNumber + index,
        kind,
        answered,
        chosen: chosenIds.map(describe),
        correct: correctIds.map(describe),
        givenText,
        expectedText,
        score,
        maxScore,
        outcome,
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
      // The paper's points when it states them, the scorer's own maximum otherwise. Reading
      // only `points` rendered "2/0" for a question whose row carries none.
      maxScore: Number(question.points ?? 0) || interactionMaxTotal,
      needsManual: interactions.some((entry) => entry.needsManual),
      // Unreadable means the *paper* holds something this build cannot mark, not that the
      // candidate left it blank.
      unreadable,
      scoreBlocked: scored === null && !unreadable && blocks.length > 0 && answer !== undefined
    };
  });
}
