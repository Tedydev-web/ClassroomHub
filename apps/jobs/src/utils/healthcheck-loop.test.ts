import { describe, expect, it, vi } from 'vitest';
import { startHealthcheckLoop } from './healthcheck-loop';

describe('healthcheck loop', () => {
  function harness() {
    let tick: (() => void) | null = null;
    const setIntervalStub = vi.fn((handler: () => void) => {
      tick = handler;
      return { unref: vi.fn() } as unknown as NodeJS.Timeout;
    }) as unknown as typeof setInterval;

    return { setIntervalStub, run: () => tick?.() };
  }

  it('keeps probing after the first attempt fails', async () => {
    // Redis answers LOADING for a moment after it starts, which is when the first probe
    // runs. That must not stop the loop before it has begun.
    const probe = vi.fn().mockRejectedValueOnce(new Error('LOADING')).mockResolvedValue(undefined);
    const onError = vi.fn();
    const { setIntervalStub, run } = harness();

    startHealthcheckLoop({ probe, intervalMs: 1000, onError, setInterval: setIntervalStub });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));

    run();
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
  });

  it('probes immediately rather than waiting for the first interval', () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    const { setIntervalStub } = harness();

    startHealthcheckLoop({ probe, intervalMs: 1000, onError: vi.fn(), setInterval: setIntervalStub });

    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('reports every failure instead of swallowing it', async () => {
    const probe = vi.fn().mockRejectedValue(new Error('down'));
    const onError = vi.fn();
    const { setIntervalStub, run } = harness();

    startHealthcheckLoop({ probe, intervalMs: 1000, onError, setInterval: setIntervalStub });
    run();

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
  });

  it('stops when asked', () => {
    const clearIntervalStub = vi.fn() as unknown as typeof clearInterval;
    const { setIntervalStub } = harness();

    const loop = startHealthcheckLoop({
      probe: vi.fn().mockResolvedValue(undefined),
      intervalMs: 1000,
      onError: vi.fn(),
      setInterval: setIntervalStub,
      clearInterval: clearIntervalStub
    });
    loop.stop();

    expect(clearIntervalStub).toHaveBeenCalledTimes(1);
  });
});
