/**
 * The exam clock, expressed as arithmetic so it can be tested at its boundaries.
 *
 * Every function here takes the instant it should treat as "now". None of them reads the
 * clock: a function that does cannot be tested at the moment that matters, and the moment
 * that matters is exactly when a paper ends.
 *
 * The browser counts down for display only. It has no say in when an attempt dies.
 */

/**
 * A final save on a phone network can legitimately still be in flight when the clock
 * strikes. Short enough to be worthless as extra time, long enough that a slow request is
 * not punished — and deliberately not configurable, because a configurable grace becomes
 * a negotiated one.
 */
export const GRACE_SECONDS = 30;

/**
 * `min(startedAt + workingTime, closesAt)`.
 *
 * Both parts fall out of one rule: a sitter gets their working time, but never past the
 * moment the paper closes. Somebody entering ten minutes before the close gets ten
 * minutes, which is the behaviour Azota describes as exam time being the moment of access
 * plus the working time.
 */
export function computeExpiry(input: {
  startedAt: Date;
  workingSeconds: number | null;
  closesAt: Date | null;
}): Date | null {
  const { startedAt, workingSeconds, closesAt } = input;

  if (workingSeconds === null && closesAt === null) return null;
  if (workingSeconds === null) return closesAt;

  const workingDeadline = new Date(startedAt.getTime() + workingSeconds * 1000);
  if (closesAt === null) return workingDeadline;

  return workingDeadline.getTime() <= closesAt.getTime() ? workingDeadline : closesAt;
}

/** Whether a save or a submit arriving now is still allowed. */
export function isWithinWritingWindow(expiresAt: Date | null, now: Date): boolean {
  if (expiresAt === null) return true;

  return now.getTime() <= expiresAt.getTime() + GRACE_SECONDS * 1000;
}

/** Whether the exam is open for a new sitter to begin. */
export function canStartNow(window: { opensAt: Date | null; closesAt: Date | null }, now: Date): boolean {
  if (window.opensAt && now.getTime() < window.opensAt.getTime()) return false;
  if (window.closesAt && now.getTime() > window.closesAt.getTime()) return false;

  return true;
}

/** Seconds a sitter has left, for the countdown the browser renders. Never negative. */
export function secondsRemaining(expiresAt: Date | null, now: Date): number | null {
  if (expiresAt === null) return null;

  return Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
}
