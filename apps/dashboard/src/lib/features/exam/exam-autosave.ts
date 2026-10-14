/**
 * Queues answers and sends them to the server, keeping the student honestly informed
 * about whether their work has actually left the browser.
 *
 * Kept free of any component so its failure modes can be tested directly. Those failure
 * modes are the whole reason it exists: a change made while a request is in flight, a
 * request that fails on a patchy connection, two changes a second apart. None of them are
 * visible in a component test, and all of them lose a student's work if they are wrong.
 *
 * One rule governs the rest: **never report saved while anything is outstanding.**
 */

export type PendingAnswer = { questionId: number; answerData: unknown };

export type AutosaveState = 'saved' | 'saving' | 'unsaved';

export type AutosaveQueue = {
  enqueue: (answer: PendingAnswer) => void;
  /** Sends everything pending. Resolves once the attempt has finished, succeed or fail. */
  flush: () => Promise<void>;
  state: () => AutosaveState;
  pendingCount: () => number;
  pending: () => PendingAnswer[];
};

export type AutosaveOptions = {
  send: (answers: PendingAnswer[]) => Promise<unknown>;
  debounceMs?: number;
  retryDelayMs?: number;
  maxRetries?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createAutosaveQueue(options: AutosaveOptions): AutosaveQueue {
  const { send, retryDelayMs = 1_000, maxRetries = 3 } = options;

  /**
   * Keyed by question, so two changes to the same answer coalesce while changes to
   * different questions both survive — the difference between "one request instead of
   * two" and "one answer instead of two".
   */
  const pending = new Map<number, PendingAnswer>();
  let state: AutosaveState = 'saved';
  let inFlight: Promise<void> | null = null;

  function enqueue(answer: PendingAnswer): void {
    pending.set(answer.questionId, answer);
    state = 'unsaved';
  }

  async function attempt(): Promise<void> {
    if (pending.size === 0) return;

    // Taken, not cleared: anything enqueued while this request is open stays in `pending`
    // and goes out next time, and if this request fails the batch returns to the queue.
    const batch = [...pending.values()];
    for (const answer of batch) pending.delete(answer.questionId);

    state = 'saving';

    for (let tries = 0; tries <= maxRetries; tries += 1) {
      try {
        await send(batch);
        state = pending.size > 0 ? 'unsaved' : 'saved';
        return;
      } catch {
        if (tries === maxRetries) break;
        await sleep(retryDelayMs * Math.pow(2, tries));
      }
    }

    // Gave up for now. The work goes back so a later flush — or the submit button — can
    // still send it, and the student is told plainly that it is not saved.
    for (const answer of batch) {
      if (!pending.has(answer.questionId)) pending.set(answer.questionId, answer);
    }
    state = 'unsaved';
  }

  async function flush(): Promise<void> {
    // Serialised, so two flushes cannot send overlapping batches and race each other.
    const run = (inFlight ?? Promise.resolve()).then(attempt);
    inFlight = run.catch(() => undefined);

    await run;
  }

  return {
    enqueue,
    flush,
    state: () => state,
    pendingCount: () => pending.size,
    pending: () => [...pending.values()]
  };
}

/**
 * The offset between the server's clock and this device's, measured once when the paper
 * opens.
 *
 * Phones commonly run minutes out. A countdown derived from `expiresAt - Date.now()` uses
 * the device clock for "now", so without this correction a skewed phone shows a countdown
 * that disagrees with the server that will actually end the paper.
 */
export function clockOffsetMs(serverNowIso: string, deviceNow = Date.now()): number {
  return new Date(serverNowIso).getTime() - deviceNow;
}

export function remainingSeconds(expiresAtIso: string | null, offsetMs: number, deviceNow = Date.now()): number | null {
  if (!expiresAtIso) return null;

  const corrected = deviceNow + offsetMs;
  return Math.max(0, Math.floor((new Date(expiresAtIso).getTime() - corrected) / 1000));
}
