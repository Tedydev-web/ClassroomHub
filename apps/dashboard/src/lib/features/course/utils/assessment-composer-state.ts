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
