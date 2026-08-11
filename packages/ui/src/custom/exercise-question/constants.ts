/**
 * Width at which the passage workspace stops stacking and becomes two columns.
 * Matches the `lg` breakpoint the renderer styles against.
 *
 * Anything that has to agree with that switch reads this rather than repeating
 * the number — the questions pager below it, and the floating Ask AI bar, which
 * would otherwise sit on top of the pager's controls.
 */
export const SPLIT_LAYOUT_BREAKPOINT = 1024;
