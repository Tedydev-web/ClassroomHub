type AssessmentPassageGroupBlock = {
  id: string;
  kind: 'content' | 'interaction';
};

type ContentBlockOf<TBlock extends AssessmentPassageGroupBlock> = Extract<TBlock, { kind: 'content' }>;
type InteractionBlockOf<TBlock extends AssessmentPassageGroupBlock> = Extract<TBlock, { kind: 'interaction' }>;

export type AssessmentPassageGroup<TBlock extends AssessmentPassageGroupBlock> = {
  id: string;
  passage: ContentBlockOf<TBlock> | null;
  interactions: InteractionBlockOf<TBlock>[];
};

/**
 * Groups an ordered assessment document into passage-led question groups.
 * Interactions before the first passage remain available in one unassigned
 * group so malformed drafts can still render without losing content.
 */
export function groupAssessmentBlocksByPassage<TBlock extends AssessmentPassageGroupBlock>(
  blocks: readonly TBlock[]
): AssessmentPassageGroup<TBlock>[] {
  const groups: AssessmentPassageGroup<TBlock>[] = [];
  let activeGroup: AssessmentPassageGroup<TBlock> | undefined;

  for (const block of blocks) {
    if (block.kind === 'content') {
      activeGroup = {
        id: block.id,
        passage: block as ContentBlockOf<TBlock>,
        interactions: []
      };
      groups.push(activeGroup);

      continue;
    }

    if (!activeGroup) {
      activeGroup = {
        id: block.id,
        passage: null,
        interactions: []
      };
      groups.push(activeGroup);
    }

    activeGroup.interactions.push(block as InteractionBlockOf<TBlock>);
  }

  return groups;
}
