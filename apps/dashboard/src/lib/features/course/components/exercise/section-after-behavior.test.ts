import { describe, expect, it } from 'vitest';

import { resolveSectionAfterBehavior, type SectionLike } from './section-after-behavior';

const sections: SectionLike[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('resolveSectionAfterBehavior', () => {
  it('submits when the section says to submit, even with sections left', () => {
    expect(resolveSectionAfterBehavior({ action: 'submit' }, sections, 0)).toEqual({ action: 'submit' });
  });

  it('goes to the named section, backwards as readily as forwards', () => {
    expect(resolveSectionAfterBehavior({ action: 'go_to_section', exerciseSectionId: 'c' }, sections, 0)).toEqual({
      action: 'go_to_section',
      index: 2
    });
    expect(resolveSectionAfterBehavior({ action: 'go_to_section', exerciseSectionId: 'a' }, sections, 2)).toEqual({
      action: 'go_to_section',
      index: 0
    });
  });

  it('falls through to the next section when the named one is gone, rather than trapping the learner', () => {
    const gone = { action: 'go_to_section', exerciseSectionId: 'deleted' };

    expect(resolveSectionAfterBehavior(gone, sections, 0)).toEqual({ action: 'go_to_section', index: 1 });
  });

  it('submits when the named section is gone and there is no next one either', () => {
    const gone = { action: 'go_to_section', exerciseSectionId: 'deleted' };

    expect(resolveSectionAfterBehavior(gone, sections, 2)).toEqual({ action: 'submit' });
  });

  it('falls through when go_to_section names nothing at all', () => {
    expect(resolveSectionAfterBehavior({ action: 'go_to_section' }, sections, 0)).toEqual({
      action: 'go_to_section',
      index: 1
    });
  });

  it('continues to the next section by default', () => {
    expect(resolveSectionAfterBehavior({ action: 'continue' }, sections, 0)).toEqual({
      action: 'go_to_section',
      index: 1
    });
    expect(resolveSectionAfterBehavior(null, sections, 1)).toEqual({ action: 'go_to_section', index: 2 });
    expect(resolveSectionAfterBehavior(undefined, sections, 0)).toEqual({ action: 'go_to_section', index: 1 });
  });

  it('submits at the end of the list — there is no finished-but-unsubmitted state', () => {
    expect(resolveSectionAfterBehavior({ action: 'continue' }, sections, 2)).toEqual({ action: 'submit' });
  });

  it('submits when there are no sections at all', () => {
    expect(resolveSectionAfterBehavior({ action: 'continue' }, [], 0)).toEqual({ action: 'submit' });
  });
});
