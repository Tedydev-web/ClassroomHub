import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { holdScreenAwake } from './exam-wake-lock';

type Listener = () => void;

function setup({ supported = true }: { supported?: boolean } = {}) {
  const listeners = new Set<Listener>();
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn)
  };
  const release = vi.fn(async () => undefined);
  const request = vi.fn(async () => ({ release }));

  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', supported ? { wakeLock: { request } } : {});

  const setVisibility = (state: DocumentVisibilityState) => {
    doc.visibilityState = state;
    listeners.forEach((fn) => fn());
  };

  return { request, release, listeners, setVisibility };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('holdScreenAwake', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the browser to keep the screen on while the paper is sat', async () => {
    const { request } = setup();

    holdScreenAwake();
    await flush();

    expect(request).toHaveBeenCalledWith('screen');
  });

  it('takes the lock again when the paper becomes visible, since the browser drops it on hide', async () => {
    const { request, setVisibility } = setup();

    holdScreenAwake();
    await flush();
    setVisibility('hidden');
    setVisibility('visible');
    await flush();

    expect(request).toHaveBeenCalledTimes(2);
  });

  it('releases the lock and stops listening when the sitting ends', async () => {
    const { release, listeners } = setup();

    const stop = holdScreenAwake();
    await flush();
    stop();

    expect(release).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it('releases a lock that is granted after the sitting already ended', async () => {
    const { release } = setup();

    const stop = holdScreenAwake();
    stop();
    await flush();

    expect(release).toHaveBeenCalledTimes(1);
  });

  it('does nothing on a browser without the Wake Lock API', () => {
    setup({ supported: false });

    expect(() => holdScreenAwake()()).not.toThrow();
  });
});
