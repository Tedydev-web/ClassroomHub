import { getTextareaAnswerCharacterCount } from '../textarea-validation';
import type { AssessmentDeliveryDefinition } from './assessment-delivery-definition';
import { scaleScoreByFraction } from './assessment-capabilities';
import {
  getAssessmentInteractionBlocks,
  type AssessmentInteraction,
  type AssessmentInteractionKind,
  type AssessmentItemDefinition
} from './assessment-item-schema';
import {
  assessmentResponseEnvelopeSchema,
  type AssessmentInteractionResponse,
  type AssessmentResponseEnvelope,
  type ValidatedAssessmentResponses
} from './assessment-response-envelope';

const SUPPORTED_ASSESSMENT_VERTICAL_SLICE_INTERACTION_KINDS: ReadonlySet<AssessmentInteractionKind> = new Set([
  'choice',
  'fill_blank',
  'numeric',
  'ordering',
  'text',
  'true_false_group',
  'word_bank'
]);

export type AssessmentVerticalSliceInteractionScore = {
  interactionId: string;
  score: number | null;
  maxScore: number;
  grading: 'auto' | 'manual';
};

export type AssessmentVerticalSliceScore = {
  autoScore: number;
  manualMaxScore: number;
  interactionScores: AssessmentVerticalSliceInteractionScore[];
};

export type AssessmentVerticalSliceResponseProgress = {
  answered: number;
  total: number;
};

export function getUnsupportedAssessmentVerticalSliceInteractionKinds(definition: AssessmentItemDefinition): string[] {
  return [
    ...new Set(
      getAssessmentInteractionBlocks(definition)
        .map((block) => block.interaction.kind)
        .filter((kind) => !SUPPORTED_ASSESSMENT_VERTICAL_SLICE_INTERACTION_KINDS.has(kind))
    )
  ];
}

function hasExactChoiceResponse(expectedOptionIds: string[], selectedOptionIds: string[]): boolean {
  if (expectedOptionIds.length !== selectedOptionIds.length) return false;

  const expectedIds = new Set(expectedOptionIds);
  return selectedOptionIds.every((selectedOptionId) => expectedIds.has(selectedOptionId));
}

function normalizeFillBlankValue(value: string): string {
  return value.trim().toLowerCase();
}

function isExactOrdering(optionIds: string[], orderedOptionIds: string[]): boolean {
  if (orderedOptionIds.length !== optionIds.length) return false;
  if (new Set(orderedOptionIds).size !== orderedOptionIds.length) return false;

  const declaredIds = new Set(optionIds);
  return orderedOptionIds.every((optionId) => declaredIds.has(optionId));
}

/** Whether every required interaction in the Phase 3 delivery slice has a meaningful response. */
export function isAssessmentVerticalSliceResponseComplete(
  definition: AssessmentDeliveryDefinition,
  response: AssessmentResponseEnvelope | null | undefined
): boolean {
  const parsedResponse = assessmentResponseEnvelopeSchema.safeParse(response ?? { schemaVersion: 1, responses: [] });
  if (!parsedResponse.success) return false;

  const interactionBlocks = definition.blocks.filter((block) => block.kind === 'interaction');
  const interactionsById = new Map(interactionBlocks.map((block) => [block.id, block.interaction]));
  const responsesByInteractionId = new Map<string, AssessmentResponseEnvelope['responses'][number]['response']>();

  for (const entry of parsedResponse.data.responses) {
    if (responsesByInteractionId.has(entry.interactionId)) return false;

    const interaction = interactionsById.get(entry.interactionId);
    if (!interaction || interaction.kind !== entry.response.kind) return false;

    if (interaction.kind === 'choice' && entry.response.kind === 'choice') {
      const selectedOptionIds = entry.response.selectedOptionIds;
      const optionIds = new Set(interaction.config.options.map((option) => option.id));
      if (new Set(selectedOptionIds).size !== selectedOptionIds.length) return false;
      if (interaction.config.cardinality === 'single' && selectedOptionIds.length !== 1) return false;
      if (!selectedOptionIds.every((optionId) => optionIds.has(optionId))) return false;
    } else if (interaction.kind === 'text' && entry.response.kind === 'text') {
      const characterCount =
        interaction.config.format === 'rich'
          ? getTextareaAnswerCharacterCount(entry.response.text)
          : entry.response.text.trim().length;
      if (interaction.required && characterCount === 0) return false;
      if (interaction.config.minCharacters !== undefined && characterCount < interaction.config.minCharacters) {
        return false;
      }
      if (interaction.config.maxCharacters !== undefined && characterCount > interaction.config.maxCharacters) {
        return false;
      }
    } else if (interaction.kind === 'numeric' && entry.response.kind === 'numeric') {
      if (!Number.isFinite(entry.response.value)) return false;
    } else if (interaction.kind === 'fill_blank' && entry.response.kind === 'fill_blank') {
      if (entry.response.values.length !== interaction.config.blankCount) return false;
      if (interaction.required && !entry.response.values.some((value) => value.trim().length > 0)) return false;
    } else if (interaction.kind === 'word_bank' && entry.response.kind === 'word_bank') {
      // Delivery merges the answers and the distractors into `bankTokens` and drops
      // `correctAnswers`, so the blank count is not knowable here. What is checkable is
      // that every word the candidate placed came out of the bank they were shown.
      const bank = new Set(interaction.config.bankTokens.map(normalizeFillBlankValue));
      const filledValues = entry.response.filledBlanks.filter((value) => value.trim().length > 0);
      if (interaction.required && filledValues.length === 0) return false;
      if (!filledValues.every((value) => bank.has(normalizeFillBlankValue(value)))) return false;
    } else if (interaction.kind === 'ordering' && entry.response.kind === 'ordering') {
      // A partial arrangement is not an answer: the candidate has to place every option.
      if (
        !isExactOrdering(
          interaction.config.options.map((option) => option.id),
          entry.response.orderedOptionIds
        )
      ) {
        return false;
      }
    } else if (interaction.kind === 'true_false_group' && entry.response.kind === 'true_false_group') {
      const statementIds = new Set(interaction.config.statements.map((statement) => statement.id));
      const responseStatementIds = entry.response.answers.map((answer) => answer.statementId);
      if (new Set(responseStatementIds).size !== responseStatementIds.length) return false;
      if (!responseStatementIds.every((statementId) => statementIds.has(statementId))) return false;
      if (
        responseStatementIds.length !== statementIds.size &&
        (interaction.required || responseStatementIds.length > 0)
      ) {
        return false;
      }
    } else {
      return false;
    }

    responsesByInteractionId.set(entry.interactionId, entry.response);
  }

  return interactionBlocks.every((block) => !block.interaction.required || responsesByInteractionId.has(block.id));
}

export function getAssessmentVerticalSliceResponseProgress(
  definition: AssessmentDeliveryDefinition,
  response: AssessmentResponseEnvelope | null | undefined
): AssessmentVerticalSliceResponseProgress {
  const interactionBlocks = definition.blocks.filter((block) => block.kind === 'interaction');
  const parsedResponse = assessmentResponseEnvelopeSchema.safeParse(response ?? { schemaVersion: 1, responses: [] });
  if (!parsedResponse.success) return { answered: 0, total: interactionBlocks.length };

  const answered = interactionBlocks.filter((block) => {
    const matchingResponses = parsedResponse.data.responses.filter((entry) => entry.interactionId === block.id);
    if (matchingResponses.length !== 1) return false;

    const [matchingResponse] = matchingResponses;
    if (matchingResponse.response.kind === 'text') {
      const characterCount =
        block.interaction.kind === 'text' && block.interaction.config.format === 'rich'
          ? getTextareaAnswerCharacterCount(matchingResponse.response.text)
          : matchingResponse.response.text.trim().length;
      if (characterCount === 0) return false;
    }
    if (matchingResponse.response.kind === 'true_false_group' && matchingResponse.response.answers.length === 0) {
      return false;
    }
    if (
      matchingResponse.response.kind === 'word_bank' &&
      !matchingResponse.response.filledBlanks.some((value) => value.trim().length > 0)
    ) {
      return false;
    }

    return isAssessmentVerticalSliceResponseComplete(
      { schemaVersion: definition.schemaVersion, blocks: [block] },
      { schemaVersion: 1, responses: matchingResponses }
    );
  }).length;

  return { answered, total: interactionBlocks.length };
}

export function scoreTrueFalseGroupInteraction(
  interaction: Extract<AssessmentInteraction, { kind: 'true_false_group' }>,
  response: Extract<AssessmentInteractionResponse, { kind: 'true_false_group' }> | undefined
): number {
  if (!response) return 0;

  const answersByStatementId = new Map(response.answers.map((answer) => [answer.statementId, answer.value]));
  const correctCount = interaction.config.statements.reduce(
    (count, statement) => (answersByStatementId.get(statement.id) === statement.correctValue ? count + 1 : count),
    0
  );
  const statementCount = interaction.config.statements.length;
  let scoreFraction = 0;

  switch (interaction.config.scoring.mode) {
    case 'tiered':
      scoreFraction = interaction.config.scoring.tiers[correctCount] ?? 0;
      break;
    case 'proportional':
      scoreFraction = statementCount > 0 ? correctCount / statementCount : 0;
      break;
    case 'all_or_nothing':
      scoreFraction = correctCount === statementCount && response.answers.length === statementCount ? 1 : 0;
      break;
  }

  return scaleScoreByFraction(interaction.maxScore, scoreFraction);
}

/**
 * Phase 3 supports deterministic choice and grouped true/false scoring plus
 * manual extended text.
 * Multiple-choice uses exact matching until a separately authored response
 * mapping is introduced, so this scorer never invents a partial-credit rule.
 */
export function scoreAssessmentVerticalSlice(
  definition: AssessmentItemDefinition,
  validated: ValidatedAssessmentResponses
): AssessmentVerticalSliceScore {
  const unsupportedKinds = getUnsupportedAssessmentVerticalSliceInteractionKinds(definition);
  if (unsupportedKinds.length > 0) {
    throw new Error(`Unsupported assessment vertical slice interactions: ${unsupportedKinds.join(', ')}`);
  }

  let autoScoreCents = 0;
  let manualMaxScoreCents = 0;
  const interactionScores: AssessmentVerticalSliceInteractionScore[] = [];

  for (const block of getAssessmentInteractionBlocks(definition)) {
    const { interaction } = block;
    if (interaction.kind === 'text') {
      manualMaxScoreCents += Math.round(interaction.maxScore * 100);
      interactionScores.push({
        interactionId: block.id,
        score: null,
        maxScore: interaction.maxScore,
        grading: 'manual'
      });
      continue;
    }

    if (interaction.kind === 'numeric') {
      const response = validated.responsesByInteractionId.get(block.id);
      const score =
        response?.kind === 'numeric' &&
        interaction.config.correctValue !== null &&
        Math.abs(response.value - interaction.config.correctValue) <= interaction.config.tolerance
          ? interaction.maxScore
          : 0;
      autoScoreCents += Math.round(score * 100);
      interactionScores.push({ interactionId: block.id, score, maxScore: interaction.maxScore, grading: 'auto' });
      continue;
    }

    if (interaction.kind === 'fill_blank') {
      const response = validated.responsesByInteractionId.get(block.id);
      const correctCount =
        response?.kind === 'fill_blank'
          ? interaction.config.acceptedAnswers.reduce(
              (count, expected, index) =>
                count +
                Number(normalizeFillBlankValue(response.values[index] ?? '') === normalizeFillBlankValue(expected)),
              0
            )
          : 0;
      const score = scaleScoreByFraction(
        interaction.maxScore,
        correctCount / interaction.config.acceptedAnswers.length
      );
      autoScoreCents += Math.round(score * 100);
      interactionScores.push({ interactionId: block.id, score, maxScore: interaction.maxScore, grading: 'auto' });
      continue;
    }

    if (interaction.kind === 'word_bank') {
      // Same positional, case-insensitive rule as fill_blank; the bank only limits what
      // the candidate can put in a blank, not how a blank is marked.
      const response = validated.responsesByInteractionId.get(block.id);
      const correctCount =
        response?.kind === 'word_bank'
          ? interaction.config.correctAnswers.reduce(
              (count, expected, index) =>
                count +
                Number(
                  normalizeFillBlankValue(response.filledBlanks[index] ?? '') === normalizeFillBlankValue(expected)
                ),
              0
            )
          : 0;
      const score =
        interaction.config.correctAnswers.length > 0
          ? scaleScoreByFraction(interaction.maxScore, correctCount / interaction.config.correctAnswers.length)
          : 0;
      autoScoreCents += Math.round(score * 100);
      interactionScores.push({ interactionId: block.id, score, maxScore: interaction.maxScore, grading: 'auto' });
      continue;
    }

    if (interaction.kind === 'ordering') {
      // Exact match only. Like multiple choice, this scorer does not invent a
      // partial-credit rule the author never wrote.
      const response = validated.responsesByInteractionId.get(block.id);
      const score =
        response?.kind === 'ordering' &&
        interaction.config.correctOrder.length === response.orderedOptionIds.length &&
        interaction.config.correctOrder.every((optionId, index) => response.orderedOptionIds[index] === optionId)
          ? interaction.maxScore
          : 0;
      autoScoreCents += Math.round(score * 100);
      interactionScores.push({ interactionId: block.id, score, maxScore: interaction.maxScore, grading: 'auto' });
      continue;
    }

    if (interaction.kind === 'true_false_group') {
      const response = validated.responsesByInteractionId.get(block.id);
      const score = scoreTrueFalseGroupInteraction(
        interaction,
        response?.kind === 'true_false_group' ? response : undefined
      );
      autoScoreCents += Math.round(score * 100);
      interactionScores.push({ interactionId: block.id, score, maxScore: interaction.maxScore, grading: 'auto' });
      continue;
    }

    if (interaction.kind === 'choice') {
      const response = validated.responsesByInteractionId.get(block.id);
      let score = 0;
      if (response?.kind === 'choice') {
        if (interaction.config.scoreWeights) {
          const percentage = response.selectedOptionIds.reduce(
            (total, optionId) => total + (interaction.config.scoreWeights?.[optionId] ?? 0),
            0
          );
          score = scaleScoreByFraction(interaction.maxScore, Math.min(1, Math.max(0, percentage / 100)));
        } else if (hasExactChoiceResponse(interaction.config.correctOptionIds, response.selectedOptionIds)) {
          score = interaction.maxScore;
        }
      }
      autoScoreCents += Math.round(score * 100);
      interactionScores.push({ interactionId: block.id, score, maxScore: interaction.maxScore, grading: 'auto' });
      continue;
    }

    throw new Error(`Unsupported assessment vertical slice interaction: ${interaction.kind}`);
  }

  return {
    autoScore: autoScoreCents / 100,
    manualMaxScore: manualMaxScoreCents / 100,
    interactionScores
  };
}
