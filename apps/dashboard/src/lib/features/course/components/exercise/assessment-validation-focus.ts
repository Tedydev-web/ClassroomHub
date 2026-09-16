/**
 * Where the cursor goes when a teacher saves an assessment item that will not validate.
 *
 * This is the part of the composer a teacher meets at their worst moment: they pressed save,
 * something is wrong, and the only useful answer is to put them *on the field that is wrong*.
 * Landing on the wrong control is worse than landing nowhere, because it says the problem is
 * somewhere it is not.
 *
 * It lived inside `assessment-item-composer.svelte` as a branch table reading four things out
 * of the closure, with no test covering any branch. Nothing here touches component state, so
 * it moves out whole and every branch becomes checkable.
 */

import type { AssessmentIssue, AssessmentItemDefinition } from '@cio/question-types';

type AssessmentBlock = AssessmentItemDefinition['blocks'][number];

/** Does the issue's path begin with these segments? */
export function issuePathStartsWith(issue: AssessmentIssue, path: Array<string | number>): boolean {
  return path.every((segment, index) => issue.path[index] === segment);
}

export function issuePathEquals(issue: AssessmentIssue, path: Array<string | number>): boolean {
  return issue.path.length === path.length && issuePathStartsWith(issue, path);
}

/** The composer's own DOM id. A composer with no question yet is the `new` one. */
export function getComposerDomId(questionId: number | null | undefined): string {
  return `assessment-${questionId ?? 'new'}`;
}

export function getBlockDomId(composerDomId: string, blockId: string, field: string): string {
  return `${composerDomId}-${blockId}-${field}`;
}

export interface ValidationFocusContext {
  composerDomId: string;
  blocks: AssessmentBlock[];
  /** Content blocks, in order. Only the first is used, as the passage layout's anchor. */
  passageBlocks: Array<{ id: string }>;
}

/**
 * The DOM id to focus for one validation issue.
 *
 * Falls back deliberately rather than returning nothing: an issue whose path names no block
 * goes to the composer's action row, which is where the teacher just clicked, and an issue
 * inside a block that names no field goes to the block itself. Both keep the teacher inside
 * the thing that is wrong even when the path is not specific enough to do better.
 */
export function getValidationFocusId(issue: AssessmentIssue, context: ValidationFocusContext): string {
  const { composerDomId, blocks, passageBlocks } = context;
  const blockDomId = (blockId: string, field: string) => getBlockDomId(composerDomId, blockId, field);

  // A layout complaint has no block of its own, so it points at the first passage — or at the
  // control that would create one, when the layout was chosen before any content existed.
  if (issuePathEquals(issue, ['presentation', 'layout'])) {
    const firstPassageBlock = passageBlocks[0];

    return firstPassageBlock ? blockDomId(firstPassageBlock.id, 'content') : `${composerDomId}-add-content`;
  }

  const blockIndex = issue.path[0] === 'blocks' && typeof issue.path[1] === 'number' ? issue.path[1] : null;
  if (blockIndex === null) return `${composerDomId}-actions`;

  const block = blocks[blockIndex];
  if (!block) return `${composerDomId}-actions`;

  if (issue.path.includes('prompt')) return blockDomId(block.id, 'prompt');
  if (issue.path.includes('maxScore')) return blockDomId(block.id, 'points');

  if (block.kind === 'interaction' && block.interaction.kind === 'choice') {
    const optionsPathIndex = issue.path.indexOf('options');
    const optionIndex = optionsPathIndex >= 0 ? issue.path[optionsPathIndex + 1] : null;
    if (typeof optionIndex === 'number') {
      const option = block.interaction.config.options[optionIndex];
      if (option) return blockDomId(option.id, 'label');
    }

    if (optionsPathIndex >= 0) return blockDomId(block.id, 'add-option');

    if (issue.path.includes('correctOptionIds')) {
      const firstOption = block.interaction.config.options[0];
      if (firstOption) return blockDomId(firstOption.id, 'correct');
    }
  }

  if (block.kind === 'interaction' && block.interaction.kind === 'true_false_group') {
    const statementsPathIndex = issue.path.indexOf('statements');
    const statementIndex = statementsPathIndex >= 0 ? issue.path[statementsPathIndex + 1] : null;
    if (typeof statementIndex === 'number') {
      const statement = block.interaction.config.statements[statementIndex];
      if (statement) return blockDomId(statement.id, 'label');
    }

    const tiersPathIndex = issue.path.indexOf('tiers');
    const tierIndex = tiersPathIndex >= 0 ? issue.path[tiersPathIndex + 1] : null;
    if (typeof tierIndex === 'number') return blockDomId(block.id, `tier-${tierIndex}`);
    if (tiersPathIndex >= 0) return blockDomId(block.id, 'tier-0');
  }

  return blockDomId(block.id, 'block');
}
