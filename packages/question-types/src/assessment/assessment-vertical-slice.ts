import { getTextareaAnswerCharacterCount } from '../textarea-validation';
import type { AssessmentDeliveryDefinition } from './assessment-delivery-definition';
import { getAssessmentInteractionBlocks, type AssessmentItemDefinition } from './assessment-item-schema';
import {
  assessmentResponseEnvelopeSchema,
  type AssessmentResponseEnvelope,
  type ValidatedAssessmentResponses
} from './assessment-response-envelope';

const SUPPORTED_ASSESSMENT_VERTICAL_SLICE_INTERACTION_KINDS = new Set(['choice', 'text']);

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

    return isAssessmentVerticalSliceResponseComplete(
      { schemaVersion: definition.schemaVersion, blocks: [block] },
      { schemaVersion: 1, responses: matchingResponses }
    );
  }).length;

  return { answered, total: interactionBlocks.length };
}

/**
 * Phase 3 only supports deterministic choice scoring and manual extended text.
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

  let autoScore = 0;
  let manualMaxScore = 0;
  const interactionScores: AssessmentVerticalSliceInteractionScore[] = [];

  for (const block of getAssessmentInteractionBlocks(definition)) {
    const { interaction } = block;
    if (interaction.kind === 'text') {
      manualMaxScore += interaction.maxScore;
      interactionScores.push({
        interactionId: block.id,
        score: null,
        maxScore: interaction.maxScore,
        grading: 'manual'
      });
      continue;
    }

    if (interaction.kind !== 'choice') {
      throw new Error(`Unsupported assessment vertical slice interaction: ${interaction.kind}`);
    }

    const response = validated.responsesByInteractionId.get(block.id);
    const score =
      response?.kind === 'choice' &&
      hasExactChoiceResponse(interaction.config.correctOptionIds, response.selectedOptionIds)
        ? interaction.maxScore
        : 0;
    autoScore += score;
    interactionScores.push({ interactionId: block.id, score, maxScore: interaction.maxScore, grading: 'auto' });
  }

  return { autoScore, manualMaxScore, interactionScores };
}
