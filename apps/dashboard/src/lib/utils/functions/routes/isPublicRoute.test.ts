import { describe, expect, it } from 'vitest';

import { isPublicRoute } from './isPublicRoute';
import hideNavByRoute from './hideNavByRoute';

/**
 * The exam link is the whole feature: a sitter without an account opens it, types a name
 * and sits. `hooks.server.ts` sends anything that is not a public route to `/login`, so a
 * missing entry here does not fail loudly — it silently turns a public exam into a private
 * one, which is exactly how it shipped broken the first time.
 */
describe('the public exam link', () => {
  it('is reachable without a session', () => {
    expect(isPublicRoute('/exam/nm0-NlwmmPePaGVJqgsLYw')).toBe(true);
  });

  it('is reachable with the trailing slash a pasted link often carries', () => {
    expect(isPublicRoute('/exam/nm0-NlwmmPePaGVJqgsLYw/')).toBe(true);
  });

  it('hides the app navigation, so a sitter sees the paper and nothing else', () => {
    expect(hideNavByRoute('/exam/nm0-NlwmmPePaGVJqgsLYw')).toBe(true);
  });

  it('does not make the teacher-side exam pages public', () => {
    expect(isPublicRoute('/courses/be8b0ce5/exams')).toBe(false);
    expect(isPublicRoute('/courses/be8b0ce5/exams/64793c8f/results')).toBe(false);
  });
});
