import { describe, expect, it } from 'vitest';

import {
  getBlockDomId,
  getComposerDomId,
  getValidationFocusId,
  issuePathEquals,
  issuePathStartsWith,
  type ValidationFocusContext
} from './assessment-validation-focus';

const issue = (path: Array<string | number>) => ({ path, code: 'invalid', message: '' }) as never;

function choiceBlock(id: string, optionIds: string[]) {
  return {
    id,
    kind: 'interaction',
    interaction: {
      kind: 'choice',
      maxScore: 1,
      config: { options: optionIds.map((optionId) => ({ id: optionId })) }
    }
  };
}

function trueFalseBlock(id: string, statementIds: string[]) {
  return {
    id,
    kind: 'interaction',
    interaction: {
      kind: 'true_false_group',
      maxScore: 1,
      config: { statements: statementIds.map((statementId) => ({ id: statementId })) }
    }
  };
}

function context(blocks: unknown[], passageBlocks: Array<{ id: string }> = []): ValidationFocusContext {
  return { composerDomId: 'assessment-7', blocks: blocks as never, passageBlocks };
}

describe('issue path matching', () => {
  it('startsWith matches a prefix, equals demands the whole path', () => {
    const blockPrompt = issue(['blocks', 0, 'prompt']);

    expect(issuePathStartsWith(blockPrompt, ['blocks', 0])).toBe(true);
    expect(issuePathEquals(blockPrompt, ['blocks', 0])).toBe(false);
    expect(issuePathEquals(blockPrompt, ['blocks', 0, 'prompt'])).toBe(true);
  });

  it('an empty path is a prefix of anything, which is what makes equals the stricter test', () => {
    expect(issuePathStartsWith(issue(['blocks', 0]), [])).toBe(true);
    expect(issuePathEquals(issue(['blocks', 0]), [])).toBe(false);
  });
});

describe('dom ids', () => {
  it('names a composer with no question yet `new`', () => {
    expect(getComposerDomId(null)).toBe('assessment-new');
    expect(getComposerDomId(undefined)).toBe('assessment-new');
    expect(getComposerDomId(7)).toBe('assessment-7');
  });

  it('builds a block field id from the composer id', () => {
    expect(getBlockDomId('assessment-7', 'b1', 'prompt')).toBe('assessment-7-b1-prompt');
  });
});

describe('getValidationFocusId', () => {
  it('sends a layout complaint to the first passage', () => {
    const focus = getValidationFocusId(issue(['presentation', 'layout']), context([], [{ id: 'p1' }]));

    expect(focus).toBe('assessment-7-p1-content');
  });

  it('sends a layout complaint to the add-content control when there is no passage yet', () => {
    expect(getValidationFocusId(issue(['presentation', 'layout']), context([]))).toBe('assessment-7-add-content');
  });

  it('falls back to the action row when the path names no block', () => {
    expect(getValidationFocusId(issue(['title']), context([]))).toBe('assessment-7-actions');
  });

  it('falls back to the action row when the path names a block that is not there', () => {
    expect(getValidationFocusId(issue(['blocks', 4, 'prompt']), context([choiceBlock('b1', [])]))).toBe(
      'assessment-7-actions'
    );
  });

  it('points at the prompt and the points field by name', () => {
    const ctx = context([choiceBlock('b1', [])]);

    expect(getValidationFocusId(issue(['blocks', 0, 'prompt']), ctx)).toBe('assessment-7-b1-prompt');
    expect(getValidationFocusId(issue(['blocks', 0, 'interaction', 'maxScore']), ctx)).toBe('assessment-7-b1-points');
  });

  it('points at the option that is wrong, not at the block', () => {
    const ctx = context([choiceBlock('b1', ['o1', 'o2'])]);

    expect(getValidationFocusId(issue(['blocks', 0, 'interaction', 'config', 'options', 1]), ctx)).toBe(
      'assessment-7-o2-label'
    );
  });

  it('points at add-option when the options list itself is the problem', () => {
    const ctx = context([choiceBlock('b1', [])]);

    expect(getValidationFocusId(issue(['blocks', 0, 'interaction', 'config', 'options']), ctx)).toBe(
      'assessment-7-b1-add-option'
    );
  });

  it('points at the first option when no answer is marked correct', () => {
    const ctx = context([choiceBlock('b1', ['o1', 'o2'])]);

    expect(getValidationFocusId(issue(['blocks', 0, 'interaction', 'config', 'correctOptionIds']), ctx)).toBe(
      'assessment-7-o1-correct'
    );
  });

  it('points at the statement that is wrong in a true/false group', () => {
    const ctx = context([trueFalseBlock('b1', ['s1', 's2'])]);

    expect(getValidationFocusId(issue(['blocks', 0, 'interaction', 'config', 'statements', 1]), ctx)).toBe(
      'assessment-7-s2-label'
    );
  });

  it('points at the numbered tier, and at the first tier when the list itself is the problem', () => {
    const ctx = context([trueFalseBlock('b1', ['s1'])]);

    expect(getValidationFocusId(issue(['blocks', 0, 'interaction', 'config', 'tiers', 2]), ctx)).toBe(
      'assessment-7-b1-tier-2'
    );
    expect(getValidationFocusId(issue(['blocks', 0, 'interaction', 'config', 'tiers']), ctx)).toBe(
      'assessment-7-b1-tier-0'
    );
  });

  it('falls back to the block when it knows which block but not which field', () => {
    const ctx = context([choiceBlock('b1', ['o1'])]);

    expect(getValidationFocusId(issue(['blocks', 0]), ctx)).toBe('assessment-7-b1-block');
  });
});
