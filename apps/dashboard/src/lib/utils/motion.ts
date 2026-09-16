/**
 * Reduced motion for Svelte transitions.
 *
 * `packages/ui/src/index.css` carries a global `prefers-reduced-motion` rule, but that
 * only reaches CSS. Svelte's `fade`/`fly`/`slide` are JavaScript and run their own
 * timing regardless, so a transition added without consulting this helper ignores a
 * preference the rest of the app honours.
 *
 * Reduced motion does not mean no feedback. A fade still communicates that something
 * changed without implying movement, so the helper collapses duration and drops travel
 * rather than removing the transition outright.
 */

/** Whether this visitor asked for less motion. Safe during SSR, where it is false. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Durations mirroring the CSS scale in `packages/ui/src/index.css`.
 *
 * Svelte transitions take numbers and cannot read the custom properties, so the two are
 * kept in step by hand. That cost is itself a reason to prefer a CSS transition wherever
 * one will do.
 */
export const MOTION_DURATION = {
  instant: 100,
  fast: 150,
  base: 200,
  slow: 300,
  deliberate: 500
} as const;

/**
 * A duration to hand a Svelte transition, already reduced when asked.
 *
 * One millisecond rather than zero, because a zero-length transition is skipped outright
 * and takes its `introend`/`outroend` callbacks with it, which callers rely on firing.
 */
export function motionDuration(ms: number): number {
  return prefersReducedMotion() ? 1 : ms;
}
