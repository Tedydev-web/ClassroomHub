import { getAssessmentInteractionBlocks, type AssessmentItemDefinition } from './assessment-item-schema';
import type { ValidatedAssessmentResponses } from './assessment-response-envelope';

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
