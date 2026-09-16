import { describe, expect, it } from 'vitest';

import { canMoveBlock, type BlockMovementContext, type PassageGroup } from './assessment-block-movement';

const content = (id: string) => ({ id, kind: 'content' });
const interaction = (id: string) => ({ id, kind: 'interaction' });

function flat(ids: string[]): BlockMovementContext {
  return {
    usesPassageLayout: false,
    blocks: ids.map(interaction),
    passageGroups: [],
    passageGroupsWithContent: []
  };
}

/** Passages, each holding its own questions, plus whatever belongs to no passage. */
function passages(groups: Array<{ passage: string | null; interactions: string[] }>): BlockMovementContext {
  const passageGroups: PassageGroup[] = groups.map((group) => ({
    passage: group.passage ? { id: group.passage } : null,
    interactions: group.interactions.map((id) => ({ id }))
  }));

  return {
    usesPassageLayout: true,
    blocks: groups.flatMap((group) => [
      ...(group.passage ? [content(group.passage)] : []),
      ...group.interactions.map(interaction)
    ]),
    passageGroups,
    passageGroupsWithContent: passageGroups.filter((group) => group.passage !== null)
  };
}

describe('canMoveBlock — a block that is not there', () => {
  it('refuses rather than guessing a position', () => {
    expect(canMoveBlock('missing', 1, flat(['a', 'b']))).toBe(false);
  });
});

describe('canMoveBlock — flat layout', () => {
  const context = flat(['a', 'b', 'c']);

  it('cannot move the first up or the last down', () => {
    expect(canMoveBlock('a', -1, context)).toBe(false);
    expect(canMoveBlock('c', 1, context)).toBe(false);
  });

  it('can move anything that has a neighbour that way', () => {
    expect(canMoveBlock('a', 1, context)).toBe(true);
    expect(canMoveBlock('b', -1, context)).toBe(true);
    expect(canMoveBlock('b', 1, context)).toBe(true);
    expect(canMoveBlock('c', -1, context)).toBe(true);
  });

  it('refuses both directions when there is only one block', () => {
    const lonely = flat(['only']);

    expect(canMoveBlock('only', -1, lonely)).toBe(false);
    expect(canMoveBlock('only', 1, lonely)).toBe(false);
  });
});

describe('canMoveBlock — passage layout, moving a passage', () => {
  const context = passages([
    { passage: 'p1', interactions: ['q1', 'q2'] },
    { passage: 'p2', interactions: ['q3'] }
  ]);

  it('moves among passages, ignoring the questions between them', () => {
    expect(canMoveBlock('p1', 1, context)).toBe(true);
    expect(canMoveBlock('p2', -1, context)).toBe(true);
  });

  it('stops at the ends of the passage list', () => {
    expect(canMoveBlock('p1', -1, context)).toBe(false);
    expect(canMoveBlock('p2', 1, context)).toBe(false);
  });
});

describe('canMoveBlock — passage layout, moving a question', () => {
  const context = passages([
    { passage: 'p1', interactions: ['q1', 'q2'] },
    { passage: 'p2', interactions: ['q3'] }
  ]);

  it('moves within its own passage', () => {
    expect(canMoveBlock('q1', 1, context)).toBe(true);
    expect(canMoveBlock('q2', -1, context)).toBe(true);
  });

  it('will not cross into the next passage, however many times it is pressed', () => {
    expect(canMoveBlock('q2', 1, context)).toBe(false);
    expect(canMoveBlock('q3', -1, context)).toBe(false);
  });

  it('refuses a lone question in its passage, in both directions', () => {
    expect(canMoveBlock('q3', 1, context)).toBe(false);
    expect(canMoveBlock('q3', -1, context)).toBe(false);
  });
});

describe('canMoveBlock — passage layout with unassigned questions', () => {
  const context = passages([
    { passage: null, interactions: ['loose1', 'loose2'] },
    { passage: 'p1', interactions: ['q1'] }
  ]);

  it('lets loose questions move among themselves', () => {
    expect(canMoveBlock('loose1', 1, context)).toBe(true);
    expect(canMoveBlock('loose2', -1, context)).toBe(true);
    expect(canMoveBlock('loose2', 1, context)).toBe(false);
  });

  it('counts only passages that exist when moving a passage', () => {
    // One real passage, so it has nowhere to go even though there are two groups.
    expect(canMoveBlock('p1', -1, context)).toBe(false);
    expect(canMoveBlock('p1', 1, context)).toBe(false);
  });
});
