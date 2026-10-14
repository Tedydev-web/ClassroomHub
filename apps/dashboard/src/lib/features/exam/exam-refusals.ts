/**
 * Reading what the server said no to.
 *
 * Two of its refusals are not failures at all: the sitting is over. The server ends an
 * attempt on its own — the clock runs out, and the next read finalises it from whatever was
 * saved — so by the time the page tries to hand the paper in, the honest answer can be that
 * there is nothing left to hand in.
 *
 * Shown as an error under a paper whose buttons still work, that reads as "something went
 * wrong, keep trying". It is the opposite: nothing went wrong, and there is nothing to try.
 */

/** The exact English the API sends. It is matched here and translated by the caller. */
export const REFUSAL_KEYS: Record<string, string> = {
  'You have used all your attempts at this paper': 'attempts_used',
  'This exam is not open': 'not_open',
  'The time to start this exam has passed': 'start_window_passed',
  'Your time is up': 'time_up',
  'This attempt is already finished': 'already_finished',
  'Your full name is required': 'name_required',
  'Your class is required': 'class_required',
  'Your candidate number is required': 'candidate_required',
  'This exam needs the password your teacher gave you': 'password_required'
};

/** The refusals that mean the sitting has ended, rather than that it hit a problem. */
const TERMINAL = new Set(['Your time is up', 'This attempt is already finished']);

/**
 * The message the API sent, dug out of whatever shape it arrived in.
 *
 * The client throws on a 4xx before the page can read the body, and the thrown error
 * carries the response text — so a refusal reaches the page as an `Error` whose message is
 * JSON. A refusal that came back as a parsed body arrives as an object instead.
 */
export function refusalMessage(source: unknown): string {
  if (source && typeof source === 'object' && 'error' in source) {
    const value = (source as { error: unknown }).error;

    return typeof value === 'string' ? value.trim() : '';
  }

  const raw = source instanceof Error ? source.message : typeof source === 'string' ? source : '';
  if (!raw) return '';

  try {
    const parsed = JSON.parse(raw);

    return typeof parsed?.error === 'string' ? parsed.error.trim() : '';
  } catch {
    // Not JSON: a genuine network failure rather than a refusal.
    return '';
  }
}

/** Whether this refusal means the paper is over. */
export function isSittingOver(source: unknown): boolean {
  return TERMINAL.has(refusalMessage(source));
}

/** The translation key for a refusal, or `null` where we have no wording of our own. */
export function refusalKey(source: unknown): string | null {
  return REFUSAL_KEYS[refusalMessage(source)] ?? null;
}
