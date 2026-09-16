import { describe, expect, it } from 'vitest';

import {
  addOrderingOption,
  addWordBankDistractor,
  countTemplateBlanks,
  moveOrderingOption,
  removeOrderingOption,
  removeWordBankDistractor,
  syncWordBankAnswers
} from './assessment-kind-config';

const wordBank = { template: 'The ___ sat on the ___.', correctAnswers: ['cat', 'mat'], distractors: ['hat'] };
const ordering = {
  options: [
    { id: 'a', html: '<p>First</p>' },
    { id: 'b', html: '<p>Second</p>' },
    { id: 'c', html: '<p>Third</p>' }
  ],
  correctOrder: ['a', 'b', 'c']
};

describe('countTemplateBlanks', () => {
  it('counts runs of three or more underscores', () => {
    expect(countTemplateBlanks('___ and ____ and _____')).toBe(3);
  });

  it('ignores runs shorter than three', () => {
    expect(countTemplateBlanks('_ and __ and snake_case')).toBe(0);
  });
});

describe('syncWordBankAnswers', () => {
  it('leaves a template whose answers already match', () => {
    expect(syncWordBankAnswers(wordBank)).toBe(wordBank);
  });

  it('grows the answers when a blank is added, keeping what was typed', () => {
    const next = syncWordBankAnswers({ ...wordBank, template: 'The ___ sat on the ___ near the ___.' });

    expect(next.correctAnswers).toEqual(['cat', 'mat', '']);
  });

  it('shrinks the answers when a blank is removed', () => {
    const next = syncWordBankAnswers({ ...wordBank, template: 'The ___ sat.' });

    expect(next.correctAnswers).toEqual(['cat']);
  });

  it('keeps one answer field for a template with no blank at all', () => {
    const next = syncWordBankAnswers({ ...wordBank, template: 'No blanks here.' });

    expect(next.correctAnswers).toEqual(['cat']);
  });

  it('never mutates the config it was given', () => {
    const config = { ...wordBank, correctAnswers: [...wordBank.correctAnswers] };
    syncWordBankAnswers({ ...config, template: 'The ___ sat.' });

    expect(config.correctAnswers).toEqual(['cat', 'mat']);
  });
});

describe('word bank distractors', () => {
  it('adds an empty one', () => {
    expect(addWordBankDistractor(wordBank, 10).distractors).toEqual(['hat', '']);
  });

  it('refuses to pass the maximum', () => {
    expect(addWordBankDistractor(wordBank, 1)).toBe(wordBank);
  });

  it('removes by index', () => {
    expect(removeWordBankDistractor({ ...wordBank, distractors: ['a', 'b', 'c'] }, 1).distractors).toEqual(['a', 'c']);
  });
});

describe('moveOrderingOption', () => {
  it('swaps with the neighbour and rewrites the correct order with it', () => {
    const next = moveOrderingOption(ordering, 0, 1);

    expect(next.options.map((option) => option.id)).toEqual(['b', 'a', 'c']);
    expect(next.correctOrder).toEqual(['b', 'a', 'c']);
  });

  it('refuses to move past either end', () => {
    expect(moveOrderingOption(ordering, 0, -1)).toBe(ordering);
    expect(moveOrderingOption(ordering, 2, 1)).toBe(ordering);
  });
});

describe('ordering options', () => {
  it('adds one and extends the correct order', () => {
    const next = addOrderingOption(ordering, 'd', 10);

    expect(next.options.map((option) => option.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(next.correctOrder).toEqual(['a', 'b', 'c', 'd']);
  });

  it('refuses to pass the maximum', () => {
    expect(addOrderingOption(ordering, 'd', 3)).toBe(ordering);
  });

  it('removes one and drops it from the correct order', () => {
    const next = removeOrderingOption(ordering, 'b');

    expect(next.options.map((option) => option.id)).toEqual(['a', 'c']);
    expect(next.correctOrder).toEqual(['a', 'c']);
  });

  it('refuses to go below the two validation requires', () => {
    const two = removeOrderingOption(ordering, 'c');

    expect(removeOrderingOption(two, 'b')).toBe(two);
  });

  it('keeps the correct order an exact permutation of the options through any sequence', () => {
    let config = addOrderingOption(ordering, 'd', 10);
    config = moveOrderingOption(config, 3, -1);
    config = removeOrderingOption(config, 'a');

    expect([...config.correctOrder].sort()).toEqual([...config.options.map((option) => option.id)].sort());
  });
});
