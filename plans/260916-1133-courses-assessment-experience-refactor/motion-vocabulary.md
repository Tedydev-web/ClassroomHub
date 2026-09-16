# Motion vocabulary — ClassroomHub dashboard

The shared language for movement, and the token set that enforces it. Phase 0b installs this;
every later phase spends it rather than inventing values.

Terminology follows the standard glossary (entrances, stagger, origin-aware animation,
press feedback, ease-out, reduced motion). Where a pattern below has a proper name, it is used.

## Why this exists

Measured before writing a line: **13 discrete durations** in use (0, 100, 120, 150, 180, 200, 250,
280, 300, 350, 400, 500, 700 ms) plus 2s–8s in keyframes, and **13 easings** including **seven
hand-written cubic-beziers, three of them near-duplicate back-out curves**. Nothing shared is
defined — `packages/ui/src/index.css:128-176` declares colour and radius in `@theme` and stops there.

The good news: the existing distribution already clusters on a real scale — `duration-200` ×26,
`duration-300` ×19, `duration-150` ×6, `duration-500` ×5, `duration-100` ×3. Tokenising is therefore
mostly *naming what is already there*, not a migration.

## The scale

Five durations. The rule that sets them is **frequency of use**: the more often a user sees a motion,
the shorter it must be.

| Token | Value | Use for | Seen |
|---|---|---|---|
| `--ui-duration-instant` | `100ms` | Press/tap feedback, hover effects, focus rings | Constantly |
| `--ui-duration-fast` | `150ms` | Colour and small state changes, tooltips, chips, checkbox ticks | Very often |
| `--ui-duration-base` | `200ms` | **Default.** Dropdowns, popovers, selects, tabs, most enter/exit | Often |
| `--ui-duration-slow` | `300ms` | Dialogs, sheets, drawers, accordion/collapse — anything with real travel | Occasionally |
| `--ui-duration-deliberate` | `500ms` | Page and view transitions, first-load reveals, celebration | Rarely |

Ambient loops (marquee, shimmer, orbit, the gradient border) keep their own long values and are not
part of this scale; they are continuous, not responses. Name them `--ui-duration-ambient-*` if a
second one is ever needed.

**Anything outside the scale must be justified in a comment or corrected.** Values like `120ms`,
`180ms`, `250ms`, `280ms`, `350ms` and `400ms` currently exist only because nobody had a scale to
reach for; they map onto the table above without a perceptible difference.

## The easings

Four curves plus linear. This collapses thirteen, and in particular replaces the three near-identical
back-out curves — `(0.34,1.15,0.64,1)`, `(0.68,-0.6,0.32,1.6)`, `(0.175,0.885,0.32,1.275)` — with one.

| Token | Curve | Use for |
|---|---|---|
| `--ui-ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | **Default.** Entrances and anything responding to the user. Starts fast, settles slow. |
| `--ui-ease-in` | `cubic-bezier(0.64, 0, 0.78, 0)` | Exits only. Never for an entrance — it feels sluggish. |
| `--ui-ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | Elements already on screen moving from A to B: layout animation, reorder, accordion. |
| `--ui-ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Pop in — a deliberate overshoot. Reserved for confirmation moments, never for routine chrome. |
| `--ui-ease-linear` | `linear` | Spinners, marquees, progress. Nothing else. |

Asymmetric easing is the reason entrances and exits use different curves: motion that accelerates and
decelerates at different rates reads as alive rather than mechanical.

## Installed and verified

Shipped in `packages/ui/src/index.css` — 84 lines added, nothing changed, so the frozen student
screen is untouched. The emitted CSS was read back to confirm each token resolves rather than
assuming the Tailwind v4 namespaces behave:

| Written | Emitted |
|---|---|
| `ui:duration-(--ui-duration-base)` | `transition-duration: var(--ui-duration-base)` |
| `ui:ease-ui-spring` | `cubic-bezier(.34, 1.56, .64, 1)` |
| `ui:text-2xs` | `font-size:.6875rem; line-height:1.45; letter-spacing:.01em` |

Note the duration syntax: the easings live in `@theme` and produce `ease-ui-*` utilities directly,
while durations are plain custom properties on `:root` and are spent through the arbitrary-property
form above. Both were confirmed in the built stylesheet.

## Token block (as installed)

```css
@theme inline {
  --ui-duration-instant: 100ms;
  --ui-duration-fast: 150ms;
  --ui-duration-base: 200ms;
  --ui-duration-slow: 300ms;
  --ui-duration-deliberate: 500ms;

  --ui-ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ui-ease-in: cubic-bezier(0.64, 0, 0.78, 0);
  --ui-ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --ui-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ui-ease-linear: linear;
}
```

## The reduced-motion guard

Today `prefers-reduced-motion` is honoured at **four sites, none of them in the dashboard product
surface**, while 131 tw-animate occurrences, 34 Svelte transitions and 9 keyframe animations — several
`infinite` — run unconditionally. That is an accessibility defect, not a polish item.

One global rule fixes the CSS layer. It keeps opacity changes, because a fade carries meaning without
implying movement, and it neutralises travel, spin and loop:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}
```

Svelte transitions are JavaScript and ignore that rule, so the same preference must be read in code.
There is already a working precedent to copy rather than invent:
`packages/ui/src/custom/exercise-question/assessment-item-renderer.svelte:299` reads it via
`matchMedia`. Phase 0b lifts that into one shared helper and the 34 transition sites consult it.

Note this file is inside the **frozen** shared component — the helper must be *extracted additively*
without changing what the student page renders.

## Patterns this product actually needs

Named so a reviewer can ask for one by name.

| Pattern | Where it belongs | Tokens |
|---|---|---|
| **Press feedback** — a subtle scale-down on click, so a control feels physical | Every button, card and row that acts on click | `instant` + `ease-out` |
| **Enter / Exit** — fade paired with a small slide or scale | Dropdowns, popovers, tooltips, toasts | `base` in with `ease-out`; `fast` out with `ease-in` |
| **Accordion / Collapse** — height animating open and shut | Section editors, the on-demand outline, settings groups | `slow` + `ease-in-out` |
| **Layout animation** — an element animating to its new position instead of snapping | Question reorder, drag-to-reorder lists, the Kanban board | `slow` + `ease-in-out` |
| **Stagger** — a cascade across a list, small delay between items | A question list or roster appearing; **cap at the first 6 items**, then show the rest at once | `fast` each, 30ms step |
| **Skeleton / shimmer** — placeholder with a moving sheen | Every screen that loads data — currently the biggest gap, since loading states exist as components but are not wired | `ambient`, `linear` |
| **Shake** — a short side-to-side jitter rejecting input | Validation failure on save or publish | `fast` + `ease-in-out` |
| **Origin-aware animation** — a surface growing out of the control that opened it | Popovers and dropdowns, which currently grow from their own centre | `base` + `ease-out` |
| **Direction-aware transition** — content sliding one way forward, the other way back | Tab changes inside the exam and exercise screens | `base` + `ease-out` |

## Rules

1. **Purposeful animation.** Motion orients, gives feedback, or shows a relationship. Decoration on a
   teacher's working screen is a cost, not a feature.
2. **Animate `transform` and `opacity`.** They composite on the GPU. Animating `width`, `height`, `top`
   or `left` causes layout thrashing and visible jank.
3. **Ease-out is the default.** Reach for another curve only with a reason from the table.
4. **One overshoot budget.** `ease-spring` is for confirmation moments. A screen where several things
   bounce reads as unserious — the wrong note for an exam tool.
5. **Never animate an error into view slowly.** Failure states use `fast`; the user is already waiting.
6. **Ambient loops stay off the working surface.** Infinite motion belongs on marketing pages, not
   beside a question a teacher is editing.
7. **The frozen student sitting screen receives none of this.** Tokens may be *defined* in shared CSS,
   but no frozen file changes and its rendered motion must stay identical.

## Exit criteria for Phase 0b

- The token block exists in `@theme` and resolves under the `ui` prefix.
- The global reduced-motion rule is present, and a shared JS helper exposes the same preference to
  Svelte transitions.
- The seven hand-written cubic-beziers are gone, replaced by token references.
- Off-scale durations either reference a token or carry a comment justifying the exception.
- The frozen-file check still returns empty.

## Spent on the Courses and Exam surface — 2026-09-16

The scale was installed and then not used here. Measured over every `.svelte` and `.ts` in the
three roots, excluding the seventeen frozen files: **21 raw motion values**.

| What | Count | Now |
|---|---|---|
| Tailwind `duration-150 / 200 / 300` | 11 | `ui:duration-(--ui-duration-fast / base / slow)` — a rename, because the scale was built from what the code already did |
| Stock `ease-in-out` | 3 | `ui:ease-ui-in-out` |
| `ease-linear` on the course header | 1 | kept; a width and height transition is the one place linear is right |
| Svelte `duration: 250 / 300 / 350 / 500` | 6 | `motionDuration(MOTION_DURATION.…)` |

**The six Svelte transitions are the finding, not the eleven classes.** A Svelte transition is
JavaScript and never sees the stylesheet's global `prefers-reduced-motion` rule, so all six ran at
full travel regardless of what the reader asked for. The largest was a whole question flying
across the screen on every step of an exercise — 350ms of horizontal translate, repeated once per
question, on the screen a learner spends the longest on.

Two raw durations remain and are correct: `exam-countdown.svelte:113` and
`exam-paper-navigator.svelte:49` are both frozen.

### Three translucent surfaces removed at the same time

`design-direction.md` rejects `backdrop-filter` on working screens, and three were still there:
the course header, and **both sticky headers of the analytics student table**. The table one
matters most — it was blurring the rows underneath the numbers a teacher is reading across. Solid
`ui:bg-muted` instead, which is what the rejection asks for.

A fourth find, unrelated to motion but in the same sweep: the course landing preview is a
full-viewport overlay that was `bg-white`, so it opened white in dark mode. Now `ui:bg-background`.
