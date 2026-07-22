import { describe, expect, it } from 'vitest';

import {
  addChoiceInteractionBlock,
  addContentBlock,
  addTextInteractionBlock,
  createAssessmentComposerState,
  removeAssessmentBlock,
  reorderAssessmentBlock,
  setChoiceCorrectOption,
  setChoiceInteractionCardinality
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

  it('preserves all correct answers for multiple choice and trims them for single choice', () => {
    const createId = createIdFactory();
    let state = createAssessmentComposerState();

    state = addChoiceInteractionBlock(state, createId);
    const choiceBlock = state.definition.blocks[0];
    if (!choiceBlock || choiceBlock.kind !== 'interaction' || choiceBlock.interaction.kind !== 'choice') {
      throw new Error('Expected a choice interaction');
    }
    const correctOptionIds = choiceBlock.interaction.config.options.map((option) => option.id);
    state = {
      ...state,
      definition: {
        ...state.definition,
        blocks: [
          {
            ...choiceBlock,
            interaction: {
              ...choiceBlock.interaction,
              config: { ...choiceBlock.interaction.config, correctOptionIds }
            }
          }
        ]
      }
    };

    state = setChoiceInteractionCardinality(state, choiceBlock.id, 'multiple');

    expect(state.definition.blocks[0]).toMatchObject({
      interaction: { config: { cardinality: 'multiple', correctOptionIds } }
    });

    state = setChoiceInteractionCardinality(state, choiceBlock.id, 'single');

    expect(state.definition.blocks[0]).toMatchObject({
      interaction: { config: { cardinality: 'single', correctOptionIds: [correctOptionIds[0]] } }
    });
  });

  it('replaces a previous correct answer for single choice and accumulates answers for multiple choice', () => {
    const createId = createIdFactory();
    let state = createAssessmentComposerState();

    state = addChoiceInteractionBlock(state, createId);
    const choiceBlock = state.definition.blocks[0];
    if (!choiceBlock || choiceBlock.kind !== 'interaction' || choiceBlock.interaction.kind !== 'choice') {
      throw new Error('Expected a choice interaction');
    }
    const [firstOption, secondOption] = choiceBlock.interaction.config.options;
    if (!firstOption || !secondOption) throw new Error('Expected two choice options');

    state = setChoiceCorrectOption(state, choiceBlock.id, firstOption.id, true);
    state = setChoiceCorrectOption(state, choiceBlock.id, secondOption.id, true);

    expect(state.definition.blocks[0]).toMatchObject({
      interaction: { config: { cardinality: 'single', correctOptionIds: [secondOption.id] } }
    });

    state = setChoiceInteractionCardinality(state, choiceBlock.id, 'multiple');
    state = setChoiceCorrectOption(state, choiceBlock.id, firstOption.id, true);

    expect(state.definition.blocks[0]).toMatchObject({
      interaction: { config: { cardinality: 'multiple', correctOptionIds: [secondOption.id, firstOption.id] } }
    });
  });
});
