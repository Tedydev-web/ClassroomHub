/**
 * Whether a paper can be started now, decided before the form is drawn.
 *
 * The server already refuses a start outside the window — `canStartNow` in
 * `exam-attempt-clock` — but it only refuses when the Start button is pressed. A candidate
 * arriving after the paper shut therefore filled in their name, their class and their
 * password, pressed Start, and only then learned there was nothing to sit. Deciding it here
 * lets the page say so on arrival.
 *
 * The rule is copied deliberately rather than shared: the two live in different apps, and a
 * screen that guessed a looser rule than the server's would send a candidate into a paper
 * the server then refuses. `exam-window.test.ts` pins them to the same boundaries.
 */

export type ExamWindowState = 'before' | 'open' | 'after';

/**
 * Postgres returns a `timestamptz` as `2026-09-02 15:41:41.278+00` — a space where the `T`
 * belongs, and an offset with no minutes, which V8 rejects outright.
 */
export function parseWindowStamp(value: string | null | undefined): Date | null {
  if (!value) return null;

  const iso = value.includes('T') ? value : value.replace(' ', 'T');
  const moment = new Date(/[+-]\d{2}$/u.test(iso) ? `${iso}:00` : iso);

  return Number.isNaN(moment.getTime()) ? null : moment;
}

export function examWindowState(
  window: { opensAt?: string | null; closesAt?: string | null },
  now: Date = new Date()
): ExamWindowState {
  const opensAt = parseWindowStamp(window.opensAt);
  const closesAt = parseWindowStamp(window.closesAt);

  // Both boundaries are inclusive, matching the server: a paper that opens at 08:00 can be
  // started at 08:00, and one that closes at 09:00 can still be started at 09:00 exactly.
  if (opensAt && now.getTime() < opensAt.getTime()) return 'before';
  if (closesAt && now.getTime() > closesAt.getTime()) return 'after';

  return 'open';
}
