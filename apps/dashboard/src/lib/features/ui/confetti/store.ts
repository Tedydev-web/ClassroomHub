import { writable } from 'svelte/store';

/**
 * Celebrating something, as an event rather than a state.
 *
 * This used to be a boolean that callers flipped: `toggleConfetti()` to start, and another
 * `toggleConfetti()` on a timer to put it back. That made the effect depend on parity — if
 * any caller flipped an odd number of times, or two celebrations overlapped, the next call
 * turned the flag *off* and nothing fired. "It works sometimes" was exactly that: the
 * previous celebration had left the flag raised.
 *
 * A counter cannot be left in the wrong state. Every call is one more than the last, so
 * every call fires, and there is nothing to reset afterwards.
 */
export const confettiStore = writable({ fired: 0 });

/** Fire one burst. Safe to call again immediately; each call is its own burst. */
export function celebrate(): void {
  confettiStore.update((confetti) => ({ fired: confetti.fired + 1 }));
}
