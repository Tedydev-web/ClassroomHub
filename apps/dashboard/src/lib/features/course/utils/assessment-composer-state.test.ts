import { describe, expect, it } from 'vitest';

import {
  addChoiceInteractionBlock,
  addContentBlock,
  addTextInteractionBlock,
  createAssessmentComposerState,
  removeAssessmentBlock,
  reorderAssessmentBlock
} from './assessment-composer-state';

function createIdFactory() {
  let nextId = 0;

  return () => {
    nextId += 1;
    return `block-${nextId}`;
  };
}

describe('assessment composer state', () => {
  it('creates content and interaction blocks with stable ids and selects each new block', () => {
    const createId = createIdFactory();
    let state = createAssessmentComposerState();

    state = addContentBlock(state, createId);
    state = addChoiceInteractionBlock(state, createId);
    state = addTextInteractionBlock(state, createId);

    expect(state.definition.blocks.map((block) => block.id)).toEqual(['block-1', 'block-2', 'block-5']);
    expect(state.definition.blocks[0]?.kind).toBe('content');
    expect(state.definition.blocks[1]).toMatchObject({
      kind: 'interaction',
      interaction: {
        kind: 'choice',
        config: { cardinality: 'single', options: [{ id: 'block-3' }, { id: 'block-4' }] }
      }
    });
    expect(state.definition.blocks[2]).toMatchObject({ kind: 'interaction', interaction: { kind: 'text' } });
    expect(state.selectedBlockId).toBe('block-5');
  });

  it('reorders by block id without changing selection or block identity', () => {
    const createId = createIdFactory();
    let state = createAssessmentComposerState();

    state = addContentBlock(state, createId);
    state = addChoiceInteractionBlock(state, createId);
    state = reorderAssessmentBlock(state, 'block-2', 0);

    expect(state.definition.blocks.map((block) => block.id)).toEqual(['block-2', 'block-1']);
    expect(state.selectedBlockId).toBe('block-2');
  });

  it('removes the selected block and selects its nearest remaining sibling', () => {
    const createId = createIdFactory();
    let state = createAssessmentComposerState();

    state = addContentBlock(state, createId);
    state = addTextInteractionBlock(state, createId);
    state = addContentBlock(state, createId);
    state = removeAssessmentBlock(state, 'block-2');

    expect(state.definition.blocks.map((block) => block.id)).toEqual(['block-1', 'block-3']);
    expect(state.selectedBlockId).toBe('block-3');
  });
});
