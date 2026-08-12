import { describe, expect, it, vi } from 'vitest';

import { createAutosaveQueue } from './exam-autosave';

/**
 * Autosave, as logic separated from any component — because this is where the data-loss
 * bugs live and none of them are visible in a component test.
 *
 * A student is never told their work is saved when it is not. That is the whole contract.
 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('the autosave queue', () => {
  it('coalesces two rapid changes into one request', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const queue = createAutosaveQueue({ send, debounceMs: 0 });

    queue.enqueue({ questionId: 1, answerData: 'A' });
    queue.enqueue({ questionId: 1, answerData: 'B' });
    await queue.flush();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toEqual([{ questionId: 1, answerData: 'B' }]);
  });

  it('keeps answers to different questions rather than replacing one with the other', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const queue = createAutosaveQueue({ send, debounceMs: 0 });

    queue.enqueue({ questionId: 1, answerData: 'A' });
    queue.enqueue({ questionId: 2, answerData: 'B' });
    await queue.flush();

    expect(send.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it('does not lose a change made while a save is in flight', async () => {
    const first = deferred<void>();
    const send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const queue = createAutosaveQueue({ send, debounceMs: 0 });

    queue.enqueue({ questionId: 1, answerData: 'A' });
    const flushing = queue.flush();

    // Arrives while the first request is still open.
    queue.enqueue({ questionId: 2, answerData: 'B' });
    first.resolve();
    await flushing;
    await queue.flush();

    const everythingSent = send.mock.calls.flatMap((call) => call[0] as Array<{ questionId: number }>);
    expect(everythingSent.map((answer) => answer.questionId)).toContain(2);
  });

  it('retries a failed save instead of dropping the work', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const queue = createAutosaveQueue({ send, debounceMs: 0, retryDelayMs: 0 });

    queue.enqueue({ questionId: 1, answerData: 'A' });
    await queue.flush();

    expect(send).toHaveBeenCalledTimes(2);
    expect(queue.state()).toBe('saved');
  });

  it('reports itself unsaved while a save is failing, never saved', async () => {
    const send = vi.fn().mockRejectedValue(new Error('offline'));
    const queue = createAutosaveQueue({ send, debounceMs: 0, retryDelayMs: 0, maxRetries: 1 });

    queue.enqueue({ questionId: 1, answerData: 'A' });
    await queue.flush();

    expect(queue.state()).toBe('unsaved');
  });

  it('keeps the work after giving up, so a later flush can still send it', async () => {
    const send = vi.fn().mockRejectedValue(new Error('offline'));
    const queue = createAutosaveQueue({ send, debounceMs: 0, retryDelayMs: 0, maxRetries: 1 });

    queue.enqueue({ questionId: 1, answerData: 'A' });
    await queue.flush();

    send.mockResolvedValue(undefined);
    await queue.flush();

    expect(queue.state()).toBe('saved');
  });

  it('sends nothing when there is nothing pending', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const queue = createAutosaveQueue({ send, debounceMs: 0 });

    await queue.flush();

    expect(send).not.toHaveBeenCalled();
  });

  it('starts out saved, because an untouched paper has nothing outstanding', () => {
    const queue = createAutosaveQueue({ send: vi.fn(), debounceMs: 0 });

    expect(queue.state()).toBe('saved');
  });
});
