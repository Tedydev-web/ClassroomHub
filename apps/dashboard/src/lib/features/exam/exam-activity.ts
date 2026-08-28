/**
 * What the paper can honestly know about a candidate leaving it, and what it cannot.
 *
 * The one signal worth watching is `visibilitychange`, not `blur`. They sound alike and
 * are not: `blur` fires whenever the window loses focus, which includes an autofill
 * prompt, a permission dialog, a click on a second monitor, and on some browsers the
 * on-screen keyboard opening — none of which mean the candidate left the paper.
 * `visibilitychange` fires when the document is actually hidden, which is the tab or app
 * switch we are trying to describe. Watching the noisier signal would produce more numbers
 * and less meaning.
 *
 * Even so, this is a description and never a verdict. A hidden document means a phone call
 * arrived just as often as it means an answer was looked up, and nothing here can tell the
 * two apart. What it can do is measure them differently: a call is one long absence, a
 * lookup is several medium ones.
 */

export type ActivityEvent = {
  kind: 'left' | 'returned';
  /** ISO 8601, taken from the device and therefore only as good as the device's clock. */
  at: string;
};

export type FocusSummary = {
  /** How many times the paper was hidden. */
  leaves: number;
  /** Seconds spent away, summed over absences that ended. */
  totalAwaySeconds: number;
  /** The longest single absence that ended, in seconds. */
  longestAwaySeconds: number;
  /**
   * True when the paper was hidden and never seen to come back — a closed tab, a flat
   * battery, a submit from somewhere else. It has no duration, so it is reported rather
   * than folded into the totals it would distort.
   */
  endedAway: boolean;
};

const EMPTY: FocusSummary = { leaves: 0, totalAwaySeconds: 0, longestAwaySeconds: 0, endedAway: false };

/**
 * Pairs each departure with the return that followed it.
 *
 * Events arrive from a device that may have been asleep, so the log is not guaranteed to
 * alternate: two departures in a row mean a return was never recorded, and a return with
 * no departure before it means the log began mid-absence. Both are ignored rather than
 * guessed at — a summary that invents a duration is worse than one that omits it.
 */
export function summariseFocus(events: ActivityEvent[]): FocusSummary {
  if (events.length === 0) return EMPTY;

  const ordered = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  let leaves = 0;
  let totalAwayMs = 0;
  let longestAwayMs = 0;
  let leftAt: number | null = null;

  for (const event of ordered) {
    const at = Date.parse(event.at);
    if (Number.isNaN(at)) continue;

    if (event.kind === 'left') {
      leaves += 1;
      // A second departure without a return: the first absence has no measurable end, so
      // its duration is dropped and the count keeps both.
      leftAt = at;

      continue;
    }

    if (leftAt === null) continue;

    const away = Math.max(0, at - leftAt);
    totalAwayMs += away;
    longestAwayMs = Math.max(longestAwayMs, away);
    leftAt = null;
  }

  return {
    leaves,
    totalAwaySeconds: Math.round(totalAwayMs / 1000),
    longestAwaySeconds: Math.round(longestAwayMs / 1000),
    endedAway: leftAt !== null
  };
}

/**
 * Watches the document and reports departures and returns.
 *
 * Returns its own teardown. The listener is on `document`, so it survives the paper paging
 * between questions; it is removed when the sitting ends.
 */
export function watchFocus(handlers: {
  onLeft: (at: string) => void;
  onReturned: (at: string, awaySeconds: number) => void;
}): () => void {
  if (typeof document === 'undefined') return () => {};

  let leftAt: number | null = null;

  const onVisibilityChange = () => {
    const now = Date.now();

    if (document.visibilityState === 'hidden') {
      leftAt = now;
      handlers.onLeft(new Date(now).toISOString());

      return;
    }

    // A return without a departure happens when the paper is opened into an already
    // visible tab; there is nothing to report.
    if (leftAt === null) return;

    const awaySeconds = Math.max(0, Math.round((now - leftAt) / 1000));
    leftAt = null;
    handlers.onReturned(new Date(now).toISOString(), awaySeconds);
  };

  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => document.removeEventListener('visibilitychange', onVisibilityChange);
}
