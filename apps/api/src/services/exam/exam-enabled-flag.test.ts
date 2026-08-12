import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ env: { EXAM_ENABLED: undefined as string | undefined } }));

vi.mock('@cio/core/config/env', () => ({ env: mocks.env }));

/**
 * A merge to main deploys, so these routes exist the moment they are merged while the
 * rate limits and retention rules of phase 7 land later. This flag is the thing that
 * actually holds the feature back — a note in a plan holds back nothing — so its
 * default matters as much as its behaviour.
 */
describe('exam feature flag', () => {
  afterEach(() => {
    mocks.env.EXAM_ENABLED = undefined;
    vi.resetModules();
  });

  async function loadGuard() {
    const { requireExamsEnabled } = await import('./exam');
    return requireExamsEnabled;
  }

  it('is off when nothing sets it, so an unfinished feature cannot be reached by accident', async () => {
    const requireExamsEnabled = await loadGuard();

    expect(() => requireExamsEnabled()).toThrow();
  });

  it('refuses anything other than the exact string, so a typo fails closed', async () => {
    for (const value of ['false', 'TRUE', '1', 'yes', '']) {
      mocks.env.EXAM_ENABLED = value;
      vi.resetModules();
      const requireExamsEnabled = await loadGuard();

      expect(() => requireExamsEnabled()).toThrow();
    }
  });

  it('answers as if the feature does not exist rather than as if it is broken', async () => {
    const requireExamsEnabled = await loadGuard();

    // 404, not 503: a disabled feature should be indistinguishable from one never built,
    // so a probe learns nothing about what is coming.
    expect(() => requireExamsEnabled()).toThrow(expect.objectContaining({ statusCode: 404 }));
  });

  it('opens only for the exact string', async () => {
    mocks.env.EXAM_ENABLED = 'true';
    vi.resetModules();
    const requireExamsEnabled = await loadGuard();

    expect(() => requireExamsEnabled()).not.toThrow();
  });
});
