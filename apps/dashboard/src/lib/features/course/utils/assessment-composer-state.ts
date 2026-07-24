import type {
  AssessmentBlock,
  AssessmentContentBlock,
  AssessmentInteractionBlock,
  AssessmentItemDefinition,
  ItemFeedback
} from '@cio/question-types';
import { canonicalizeAssessmentItemDefinition, groupAssessmentBlocksByPassage } from '@cio/question-types';

export type AssessmentComposerDraft = Omit<AssessmentItemDefinition, 'blocks' | 'feedback'> & {
  blocks: AssessmentBlock[];
  feedback: ItemFeedback[];
};

export type AssessmentComposerState = {
  definition: AssessmentComposerDraft;
  selectedBlockId: string | null;
};

export type AssessmentComposerIdFactory = () => string;
export type AssessmentItemPresentationLayout = NonNullable<AssessmentItemDefinition['presentation']>['layout'];

export interface AssessmentComposerSaveReconciliation {
  persistedSnapshot: string;
  shouldApplySavedDefinition: boolean;
}

export function getAssessmentComposerSnapshot(title: string, definition: AssessmentItemDefinition): string {
  return `${JSON.stringify(title)}:${canonicalizeAssessmentItemDefinition(definition)}`;
}

export function reconcileAssessmentComposerSave(input: {
  currentTitle: string;
  currentDefinition: AssessmentItemDefinition;
  submittedSnapshot: string;
  submittedTitle: string;
  savedDefinition: AssessmentItemDefinition;
}): AssessmentComposerSaveReconciliation {
  const currentSnapshot = getAssessmentComposerSnapshot(input.currentTitle, input.currentDefinition);
  const persistedSnapshot = getAssessmentComposerSnapshot(input.submittedTitle, input.savedDefinition);

  return {
    persistedSnapshot,
    shouldApplySavedDefinition: currentSnapshot === input.submittedSnapshot
  };
}

export function createAssessmentComposerState(): AssessmentComposerState {
  return {
    definition: {
      schemaVersion: 1,
      presentation: { layout: 'flow' },
      blocks: [],
      feedback: []
    },
    selectedBlockId: null
  };
}

export function setAssessmentItemPresentationLayout(
  state: AssessmentComposerState,
  layout: AssessmentItemPresentationLayout
): AssessmentComposerState {
  return {
    ...state,
    definition: {
      ...state.definition,
      presentation: { layout }
    }
  };
}

export function initializeAssessmentPassageLayout(
  state: AssessmentComposerState,
  createId: AssessmentComposerIdFactory
): AssessmentComposerState {
  let nextState = setAssessmentItemPresentationLayout(state, 'passage_split');
  if (nextState.definition.blocks.length > 0) return nextState;

  nextState = addContentBlock(nextState, createId);
  nextState = addChoiceInteractionBlock(nextState, createId);
  return nextState;
}

function appendBlock(state: AssessmentComposerState, block: AssessmentBlock): AssessmentComposerState {
  return {
    definition: {
      ...state.definition,
      blocks: [...state.definition.blocks, block]
    },
    selectedBlockId: block.id
  };
}

function insertInteractionBlock(
  state: AssessmentComposerState,
  block: AssessmentInteractionBlock,
  passageId?: string
): AssessmentComposerState {
  if (!passageId) return appendBlock(state, block);

  const passageIndex = state.definition.blocks.findIndex(
    (candidate) => candidate.id === passageId && candidate.kind === 'content'
  );
  if (passageIndex < 0) return appendBlock(state, block);

  let insertionIndex = passageIndex + 1;
  while (state.definition.blocks[insertionIndex]?.kind === 'interaction') {
    insertionIndex += 1;
  }

  const blocks = [...state.definition.blocks];
  blocks.splice(insertionIndex, 0, block);

  return {
    definition: { ...state.definition, blocks },
    selectedBlockId: block.id
  };
}

export function addContentBlock(
  state: AssessmentComposerState,
  createId: AssessmentComposerIdFactory
): AssessmentComposerState {
  const block: AssessmentContentBlock = {
    id: createId(),
    kind: 'content',
    content: { format: 'html', html: '' }
  };

  return appendBlock(state, block);
}

export function addChoiceInteractionBlock(
  state: AssessmentComposerState,
  createId: AssessmentComposerIdFactory,
  passageId?: string
): AssessmentComposerState {
  const block: AssessmentInteractionBlock = {
    id: createId(),
    kind: 'interaction',
    interaction: {
      kind: 'choice',
      prompt: { format: 'html', html: '' },
      required: true,
      maxScore: 1,
      config: {
        cardinality: 'single',
        presentation: 'list',
        options: [
          { id: createId(), html: '' },
          { id: createId(), html: '' }
        ],
        correctOptionIds: []
      }
    }
  };

  return insertInteractionBlock(state, block, passageId);
}

export function addTextInteractionBlock(
  state: AssessmentComposerState,
  createId: AssessmentComposerIdFactory,
  passageId?: string
): AssessmentComposerState {
  const block: AssessmentInteractionBlock = {
    id: createId(),
    kind: 'interaction',
    interaction: {
      kind: 'text',
      prompt: { format: 'html', html: '' },
      required: true,
      maxScore: 1,
      config: { format: 'rich' }
    }
  };

  return insertInteractionBlock(state, block, passageId);
}

export function setChoiceInteractionCardinality(
  state: AssessmentComposerState,
  blockId: string,
  cardinality: 'single' | 'multiple'
): AssessmentComposerState {
  return {
    ...state,
    definition: {
      ...state.definition,
      blocks: state.definition.blocks.map((block) => {
        if (block.id !== blockId || block.kind !== 'interaction' || block.interaction.kind !== 'choice') {
          return block;
        }

        const correctOptionIds =
          cardinality === 'single'
            ? block.interaction.config.correctOptionIds.slice(0, 1)
            : block.interaction.config.correctOptionIds;
        return {
          ...block,
          interaction: {
            ...block.interaction,
            config: { ...block.interaction.config, cardinality, correctOptionIds }
          }
        };
      })
    }
  };
}

export function setChoiceCorrectOption(
  state: AssessmentComposerState,
  blockId: string,
  optionId: string,
  checked: boolean
): AssessmentComposerState {
  return {
    ...state,
    definition: {
      ...state.definition,
      blocks: state.definition.blocks.map((block) => {
        if (block.id !== blockId || block.kind !== 'interaction' || block.interaction.kind !== 'choice') {
          return block;
        }

        const isKnownOption = block.interaction.config.options.some((option) => option.id === optionId);
        if (!isKnownOption) return block;

        const correctOptionIds = !checked
          ? block.interaction.config.correctOptionIds.filter((correctOptionId) => correctOptionId !== optionId)
          : block.interaction.config.cardinality === 'single'
            ? [optionId]
            : Array.from(new Set([...block.interaction.config.correctOptionIds, optionId]));
        return {
          ...block,
          interaction: {
            ...block.interaction,
            config: { ...block.interaction.config, correctOptionIds }
          }
        };
      })
    }
  };
}

export function reorderAssessmentBlock(
  state: AssessmentComposerState,
  blockId: string,
  destinationIndex: number
): AssessmentComposerState {
  const sourceIndex = state.definition.blocks.findIndex((block) => block.id === blockId);
  if (sourceIndex < 0 || !Number.isInteger(destinationIndex)) return state;

  const blocks = [...state.definition.blocks];
  const [block] = blocks.splice(sourceIndex, 1);
  if (!block) return state;

  const clampedDestinationIndex = Math.max(0, Math.min(destinationIndex, blocks.length));
  blocks.splice(clampedDestinationIndex, 0, block);

  return {
    ...state,
    definition: { ...state.definition, blocks }
  };
}

export function moveAssessmentBlockWithinKind(
  state: AssessmentComposerState,
  blockId: string,
  offset: -1 | 1
): AssessmentComposerState {
  const block = state.definition.blocks.find((candidate) => candidate.id === blockId);
  if (!block) return state;

  const laneBlocks = state.definition.blocks.filter((candidate) => candidate.kind === block.kind);
  const sourceLaneIndex = laneBlocks.findIndex((candidate) => candidate.id === blockId);
  const destinationLaneIndex = sourceLaneIndex + offset;
  if (sourceLaneIndex < 0 || destinationLaneIndex < 0 || destinationLaneIndex >= laneBlocks.length) return state;

  const reorderedLaneBlocks = [...laneBlocks];
  const [movedBlock] = reorderedLaneBlocks.splice(sourceLaneIndex, 1);
  if (!movedBlock) return state;

  reorderedLaneBlocks.splice(destinationLaneIndex, 0, movedBlock);
  let laneIndex = 0;
  const blocks = state.definition.blocks.map((candidate) => {
    if (candidate.kind !== block.kind) return candidate;

    const nextBlock = reorderedLaneBlocks[laneIndex];
    laneIndex += 1;

    return nextBlock ?? candidate;
  });

  return {
    ...state,
    definition: { ...state.definition, blocks }
  };
}

export function moveAssessmentInteractionWithinPassage(
  state: AssessmentComposerState,
  blockId: string,
  offset: -1 | 1
): AssessmentComposerState {
  const group = groupAssessmentBlocksByPassage(state.definition.blocks).find((candidate) =>
    candidate.interactions.some((interaction) => interaction.id === blockId)
  );
  if (!group) return state;

  const sourceIndex = group.interactions.findIndex((interaction) => interaction.id === blockId);
  const destinationIndex = sourceIndex + offset;
  if (sourceIndex < 0 || destinationIndex < 0 || destinationIndex >= group.interactions.length) return state;

  const sourceBlock = group.interactions[sourceIndex];
  const destinationBlock = group.interactions[destinationIndex];
  if (!sourceBlock || !destinationBlock) return state;

  const sourceBlockIndex = state.definition.blocks.findIndex((block) => block.id === sourceBlock.id);
  const destinationBlockIndex = state.definition.blocks.findIndex((block) => block.id === destinationBlock.id);
  if (sourceBlockIndex < 0 || destinationBlockIndex < 0) return state;

  const blocks = [...state.definition.blocks];
  blocks[sourceBlockIndex] = destinationBlock;
  blocks[destinationBlockIndex] = sourceBlock;

  return {
    ...state,
    definition: { ...state.definition, blocks }
  };
}

export function moveAssessmentPassageGroup(
  state: AssessmentComposerState,
  passageId: string,
  offset: -1 | 1
): AssessmentComposerState {
  const groups = groupAssessmentBlocksByPassage(state.definition.blocks);
  const passageGroups = groups.filter((group) => group.passage !== null);
  const sourceIndex = passageGroups.findIndex((group) => group.passage?.id === passageId);
  const destinationIndex = sourceIndex + offset;
  if (sourceIndex < 0 || destinationIndex < 0 || destinationIndex >= passageGroups.length) return state;

  const reorderedGroups = [...passageGroups];
  const [movedGroup] = reorderedGroups.splice(sourceIndex, 1);
  if (!movedGroup) return state;

  reorderedGroups.splice(destinationIndex, 0, movedGroup);
  const unassignedBlocks = groups[0]?.passage === null ? groups[0].interactions : [];
  const blocks: AssessmentBlock[] = [...unassignedBlocks];
  for (const group of reorderedGroups) {
    if (group.passage) blocks.push(group.passage);
    blocks.push(...group.interactions);
  }

  return {
    ...state,
    definition: { ...state.definition, blocks }
  };
}

export function removeAssessmentBlocks(
  state: AssessmentComposerState,
  blockIds: readonly string[]
): AssessmentComposerState {
  const removedIds = new Set(blockIds);
  const firstRemovedIndex = state.definition.blocks.findIndex((block) => removedIds.has(block.id));
  if (firstRemovedIndex < 0) return state;

  const blocks = state.definition.blocks.filter((block) => !removedIds.has(block.id));
  const selectedBlockId =
    state.selectedBlockId && removedIds.has(state.selectedBlockId)
      ? (blocks[Math.min(firstRemovedIndex, blocks.length - 1)]?.id ?? null)
      : state.selectedBlockId;

  return {
    definition: { ...state.definition, blocks },
    selectedBlockId
  };
}

export function restoreAssessmentBlocks(
  state: AssessmentComposerState,
  restoredBlocks: readonly AssessmentBlock[],
  destinationIndex: number
): AssessmentComposerState {
  if (restoredBlocks.length === 0) return state;

  const restoredIds = new Set(restoredBlocks.map((block) => block.id));
  if (state.definition.blocks.some((block) => restoredIds.has(block.id))) return state;

  const blocks = [...state.definition.blocks];
  const clampedDestinationIndex = Math.max(0, Math.min(destinationIndex, blocks.length));
  blocks.splice(clampedDestinationIndex, 0, ...restoredBlocks);

  return {
    definition: { ...state.definition, blocks },
    selectedBlockId: restoredBlocks[0]?.id ?? state.selectedBlockId
  };
}

export function removeAssessmentBlock(state: AssessmentComposerState, blockId: string): AssessmentComposerState {
  const removedIndex = state.definition.blocks.findIndex((block) => block.id === blockId);
  if (removedIndex < 0) return state;

  const blocks = state.definition.blocks.filter((block) => block.id !== blockId);
  const selectedBlockId =
    state.selectedBlockId === blockId
      ? (blocks[Math.min(removedIndex, blocks.length - 1)]?.id ?? null)
      : state.selectedBlockId;

  return {
    definition: { ...state.definition, blocks },
    selectedBlockId
  };
}

export function restoreAssessmentBlock(
  state: AssessmentComposerState,
  block: AssessmentBlock,
  destinationIndex: number
): AssessmentComposerState {
  if (state.definition.blocks.some((candidate) => candidate.id === block.id)) return state;

  const blocks = [...state.definition.blocks];
  const clampedDestinationIndex = Math.max(0, Math.min(destinationIndex, blocks.length));
  blocks.splice(clampedDestinationIndex, 0, block);

  return {
    definition: { ...state.definition, blocks },
    selectedBlockId: block.id
  };
}
