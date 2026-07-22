import type {
  AssessmentBlock,
  AssessmentContentBlock,
  AssessmentInteractionBlock,
  AssessmentItemDefinition,
  ItemFeedback
} from '@cio/question-types';

export type AssessmentComposerDraft = Omit<AssessmentItemDefinition, 'blocks' | 'feedback'> & {
  blocks: AssessmentBlock[];
  feedback: ItemFeedback[];
};

export type AssessmentComposerState = {
  definition: AssessmentComposerDraft;
  selectedBlockId: string | null;
};

export type AssessmentComposerIdFactory = () => string;

export function createAssessmentComposerState(): AssessmentComposerState {
  return {
    definition: {
      schemaVersion: 1,
      blocks: [],
      feedback: []
    },
    selectedBlockId: null
  };
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
  createId: AssessmentComposerIdFactory
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

  return appendBlock(state, block);
}

export function addTextInteractionBlock(
  state: AssessmentComposerState,
  createId: AssessmentComposerIdFactory
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

  return appendBlock(state, block);
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
