/**
 * Whether the up/down control beside a block in the composer should be enabled.
 *
 * Getting this wrong has two shapes and both are bad: an arrow that looks live but moves
 * nothing, or an arrow greyed out over a move that was legal. It lived in
 * `assessment-item-composer.svelte` reading four things from the closure, with no test on any
 * of its three branches — and the three branches disagree about what "next" even means.
 *
 * In the flat layout a block moves within one list of blocks. Under the passage layout the
 * list depends on what is being moved: a passage moves among passages, and a question moves
 * only within its own passage's questions. That last rule is the one worth writing down — a
 * question cannot reach another passage by pressing down enough times.
 */

export interface MovableBlock {
  id: string;
  kind: string;
}

export interface PassageGroup {
  passage: { id: string } | null;
  interactions: Array<{ id: string }>;
}

export interface BlockMovementContext {
  usesPassageLayout: boolean;
  blocks: MovableBlock[];
  passageGroups: PassageGroup[];
  /** `passageGroups` minus the group holding blocks that belong to no passage. */
  passageGroupsWithContent: PassageGroup[];
}

/** Is `index + offset` a real position in a list of `length` items? */
function landsInside(index: number, offset: -1 | 1, length: number): boolean {
  const destination = index + offset;

  return index >= 0 && destination >= 0 && destination < length;
}

export function canMoveBlock(blockId: string, offset: -1 | 1, context: BlockMovementContext): boolean {
  const { usesPassageLayout, blocks, passageGroups, passageGroupsWithContent } = context;

  const block = blocks.find((candidate) => candidate.id === blockId);
  if (!block) return false;

  // A passage moves among the other passages, not among the blocks between them.
  if (usesPassageLayout && block.kind === 'content') {
    const passageIndex = passageGroupsWithContent.findIndex((group) => group.passage?.id === blockId);

    return landsInside(passageIndex, offset, passageGroupsWithContent.length);
  }

  // A question moves inside its own passage only. Reaching the end of that passage is the end
  // of the road, not a hand-off to the next one.
  if (usesPassageLayout) {
    const passageGroup = passageGroups.find((group) =>
      group.interactions.some((interaction) => interaction.id === blockId)
    );
    const interactionIndex = passageGroup?.interactions.findIndex((interaction) => interaction.id === blockId) ?? -1;

    return landsInside(interactionIndex, offset, passageGroup?.interactions.length ?? 0);
  }

  const laneIndex = blocks.findIndex((candidate) => candidate.id === blockId);

  return landsInside(laneIndex, offset, blocks.length);
}
