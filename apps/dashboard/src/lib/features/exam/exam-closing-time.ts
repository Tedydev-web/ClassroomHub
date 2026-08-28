/**
 * Working out when an exam closes.
 *
 * A teacher setting up a paper usually knows it in one of two shapes: the exact moment it
 * shuts, or how long it stays open from the moment it opens. Both end up as the same stored
 * closing time — the second is a way of saying it, not a second mechanism — so nothing
 * downstream has to know which one was typed.
 */

/**
 * `days` after `opensAt`, in the teacher's own local time.
 *
 * Days are added to the calendar date rather than as a fixed number of milliseconds, so a
 * paper opening on the 30th and running three days closes on the 2nd of the next month, and
 * a clock that shifts for daylight saving still closes at the hour it was opened at. Adding
 * `days * 86_400_000` gets both of those wrong, quietly, and only in some months.
 */
export function closingTimeAfterDays(opensAt: string, days: number): string | null {
  if (!opensAt || !Number.isFinite(days) || days <= 0) return null;

  const opened = new Date(opensAt);
  if (Number.isNaN(opened.getTime())) return null;

  const closes = new Date(opened);
  closes.setDate(closes.getDate() + days);

  return closes.toISOString();
}
