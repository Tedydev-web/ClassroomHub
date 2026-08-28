import { describe, expect, it } from 'vitest';

import { updateExamSchema } from './exam';

/**
 * A patch must carry only what the caller sent.
 *
 * Deriving this schema with `.partial()` from the create schema looked equivalent and was
 * not: the create schema defaults nearly every field, and a partial over a defaulted field
 * still produces the default for an absent key. A request naming only the title would then
 * arrive holding every other field, and updating a title would reset the exam's mode,
 * attempt limit and visibility settings without saying so.
 */
describe('the shape of an exam settings patch', () => {
  it('keeps absent fields absent rather than filling them with defaults', () => {
    const parsed = updateExamSchema.parse({ title: 'Corrected title' });

    expect(Object.keys(parsed)).toEqual(['title']);
  });

  it('carries through a value the caller did send, including an explicit null', () => {
    const parsed = updateExamSchema.parse({ workingSeconds: null, maxAttempts: 3 });

    expect(parsed).toEqual({ workingSeconds: null, maxAttempts: 3 });
  });

  it('refuses the paper, which is not a setting', () => {
    const parsed = updateExamSchema.parse({ title: 'x', exerciseId: 'something' } as never);

    expect(parsed).not.toHaveProperty('exerciseId');
  });
});
