import {
  getAssessmentInteractionBlocks,
  type AssessmentInteraction,
  type AssessmentInteractionKind,
  type AssessmentItemDefinition
} from './assessment-item-schema';

export type AssessmentGradingMode = 'auto' | 'manual' | 'hybrid';

export interface AssessmentItemCapabilities {
  gradingMode: AssessmentGradingMode;
  autoGradable: boolean;
  supportsPartialCredit: boolean;
  manualGradingRequired: boolean;
  /** True when any interaction answers with a managed asset (file/video). */
  requiresManagedAssets: boolean;
}

/** Static per-kind grading capability; mirrors the legacy registry flags. */
const INTERACTION_KIND_GRADING: Record<AssessmentInteractionKind, 'auto' | 'manual'> = {
  choice: 'auto',
  text: 'manual',
  numeric: 'auto',
  fill_blank: 'auto',
  word_bank: 'auto',
  ordering: 'auto',
  file_upload: 'manual',
  link: 'manual',
  star_rating: 'auto',
  video_recording: 'manual'
};

const MANAGED_ASSET_KINDS: ReadonlySet<AssessmentInteractionKind> = new Set(['file_upload', 'video_recording']);

/** Partial-credit parity with the legacy registry (choice depends on cardinality). */
function interactionSupportsPartialCredit(interaction: AssessmentInteraction): boolean {
  switch (interaction.kind) {
    case 'choice':
      return interaction.config.cardinality === 'multiple';
    case 'numeric':
    case 'fill_blank':
    case 'word_bank':
    case 'ordering':
      return true;
    default:
      return false;
  }
}

export function roundToTwoDecimals(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;

  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Item maximum = sum of interaction maxima, computed in integer cents to avoid float drift. */
export function getItemMaxScore(definition: {
  blocks: ReadonlyArray<{ kind: 'content' } | { kind: 'interaction'; interaction: { maxScore: number } }>;
}): number {
  const totalCents = definition.blocks.reduce(
    (cents, block) => cents + (block.kind === 'interaction' ? Math.round(block.interaction.maxScore * 100) : 0),
    0
  );

  return totalCents / 100;
}

/**
 * Runtime capability derivation from the contained interactions. Callers with
 * no resolved definition fall back to the static registry metadata keyed by
 * the top-level question type.
 */
export function deriveItemCapabilities(definition: AssessmentItemDefinition): AssessmentItemCapabilities {
  const interactions = getAssessmentInteractionBlocks(definition).map((block) => block.interaction);

  const hasAuto = interactions.some((interaction) => INTERACTION_KIND_GRADING[interaction.kind] === 'auto');
  const hasManual = interactions.some((interaction) => INTERACTION_KIND_GRADING[interaction.kind] === 'manual');
  const gradingMode: AssessmentGradingMode = hasAuto && hasManual ? 'hybrid' : hasManual ? 'manual' : 'auto';

  // Multi-interaction items earn per-interaction subtotals, so they are
  // partial-credit by construction.
  const supportsPartialCredit = interactions.length > 1 || interactions.some(interactionSupportsPartialCredit);

  return {
    gradingMode,
    autoGradable: gradingMode === 'auto',
    supportsPartialCredit,
    manualGradingRequired: gradingMode !== 'auto',
    requiresManagedAssets: interactions.some((interaction) => MANAGED_ASSET_KINDS.has(interaction.kind))
  };
}
