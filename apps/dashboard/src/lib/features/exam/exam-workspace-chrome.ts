/**
 * How much of the viewport this page spends on things that are not the paper.
 *
 * The paper's renderer sizes its workspace at `100dvh` less `14rem` of assumed chrome, plus
 * whatever `--exercise-chrome-extra` names on top of that. The 14rem describes the course
 * page the renderer was built for. The exam page is barely half of it — a header and an
 * action bar, and nothing else — so passing the action bar alone subtracted around ninety
 * pixels of chrome that does not exist here. The workspace fell to its `28rem` floor and
 * left the room it was owed empty underneath, while the questions pane, which gets three
 * fifths of whatever is left, showed a single option at a time.
 *
 * So the number handed over is a correction rather than an addition, and on a phone it is
 * normally negative. That is within the variable's meaning: it says what this page's chrome
 * costs relative to the assumption, and this page costs less.
 */

/** The chrome the renderer assumes, in pixels: `14rem` at the browser default root size. */
export const RENDERER_ASSUMED_CHROME = 224;

/** The paper's own breathing room: `pt-6` above it, and `1rem` kept clear below. */
export const PAPER_PADDING = 24 + 16;

/**
 * The correction to hand the renderer, given the two heights this page measures.
 *
 * Both heights arrive as `0` on the first frame, before anything has been measured. Feeding
 * the arithmetic those zeroes would claim the page has almost no chrome at all and stretch
 * the workspace past the viewport for a frame. Until both are real, this falls back to what
 * the page passed before any of this existed: the action bar alone, which is never wrong by
 * more than the gap it was already leaving.
 */
export function workspaceChromeCorrection(headerHeight: number, actionBarHeight: number): number {
  if (headerHeight <= 0 || actionBarHeight <= 0) return actionBarHeight;

  return headerHeight + actionBarHeight + PAPER_PADDING - RENDERER_ASSUMED_CHROME;
}
