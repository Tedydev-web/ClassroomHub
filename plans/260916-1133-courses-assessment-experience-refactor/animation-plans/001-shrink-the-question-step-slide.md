# 001 — Shrink the question-step slide to a short directional fade

- **Status**: DONE — 74727a968
- **Commit**: eca4a8163
- **Severity**: HIGH
- **Category**: 1. Purpose & frequency · 2. Easing & duration
- **Estimated scope**: 1 file, ~6 changed lines

## Problem

Every time a learner moves to the next or previous question in a course exercise, the whole
question slides **300px** across the screen for **300ms**, and the one leaving slides 300px the
other way at the same time. A learner working through a 40-question exercise watches roughly
twelve seconds of sliding. The audit rule for motion seen tens of times per session is "remove or
drastically reduce"; this is the largest movement the screen makes and it is on the most frequent
action.

It also uses the wrong curve for this repository. `cubicInOut` starts slow, which delays the exact
moment the learner is waiting for. The repository's own vocabulary
(`plans/260916-1133-courses-assessment-experience-refactor/motion-vocabulary.md`, table row
"Enter / Exit") says an entrance uses **ease-out** at `base`, an exit uses **ease-in** at `fast`,
and reserves ease-in-out for elements already on screen moving from A to B.

```svelte
<!-- apps/dashboard/src/lib/features/course/components/exercise/view-mode.svelte:7 — current -->
import { cubicInOut } from 'svelte/easing';
```

```svelte
<!-- apps/dashboard/src/lib/features/course/components/exercise/view-mode.svelte:1105-1106 — current -->
const flyX = $derived(slideDirection === 'next' ? 300 : -300);
const flyOutX = $derived(-flyX);
```

```svelte
<!-- apps/dashboard/src/lib/features/course/components/exercise/view-mode.svelte:1682-1683 — current -->
in:fly={{ x: flyX, duration: motionDuration(MOTION_DURATION.slow), easing: cubicInOut }}
out:fly={{ x: flyOutX, duration: motionDuration(MOTION_DURATION.slow), easing: cubicInOut }}
```

Both elements share one grid cell (`style="grid-template-areas: 'slot';"` on the parent, and
`[grid-area:slot]` on the element), so the leaving and arriving questions overlap while both
transitions run.

## Target

Keep the direction — next arrives from the right, previous from the left — because it tells the
learner which way they moved. Shrink the travel so it reads as a nudge, not a journey, and let the
fade that `fly` already applies carry most of the change.

```svelte
<!-- target: imports -->
import { cubicIn, cubicOut } from 'svelte/easing';

<!-- target: offsets -->
const flyX = $derived(slideDirection === 'next' ? 24 : -24);
const flyOutX = $derived(-flyX);

<!-- target: transitions -->
in:fly={{ x: flyX, duration: motionDuration(MOTION_DURATION.base), easing: cubicOut }}
out:fly={{ x: flyOutX, duration: motionDuration(MOTION_DURATION.fast), easing: cubicIn }}
```

Values: `MOTION_DURATION.base` is 200ms, `MOTION_DURATION.fast` is 150ms. Svelte's `fly` fades
opacity to 0 by default, so no separate fade is needed.

`24` is a starting value, not a measured one: it must be judged in the feel check below and may be
adjusted within 16–32.

## Repo conventions to follow

- Svelte transitions take a duration from `motionDuration(MOTION_DURATION.<token>)` imported from
  `$lib/utils/motion`. That helper returns 1ms under `prefers-reduced-motion`, which is already
  imported and used on these lines — keep it.
- Easing for Svelte transitions comes from `svelte/easing`.
- Exemplar: `apps/dashboard/src/lib/features/course/pages/marks.svelte:53` —
  `in:fly={{ y: 4, duration: motionDuration(MOTION_DURATION.fast), easing: cubicOut }}`.

## Steps

1. In `view-mode.svelte:7`, replace `import { cubicInOut } from 'svelte/easing';` with
   `import { cubicIn, cubicOut } from 'svelte/easing';`. Before doing so, search the file for any
   other use of `cubicInOut`; if one exists, keep `cubicInOut` in the import as well.
2. In `view-mode.svelte:1105`, change `300 : -300` to `24 : -24`.
3. In `view-mode.svelte:1682`, change the `in:fly` to
   `in:fly={{ x: flyX, duration: motionDuration(MOTION_DURATION.base), easing: cubicOut }}`.
4. In `view-mode.svelte:1683`, change the `out:fly` to
   `out:fly={{ x: flyOutX, duration: motionDuration(MOTION_DURATION.fast), easing: cubicIn }}`.
5. Leave the explanatory comment above the element in place; append one sentence saying the
   travel was reduced to a short nudge because the step is the most frequent action on the screen.

## Boundaries

- Touch only `apps/dashboard/src/lib/features/course/components/exercise/view-mode.svelte`.
- Do NOT touch any file listed in
  `plans/260916-1133-courses-assessment-experience-refactor/frozen-files.txt`.
- Do NOT change the grid-slot structure, `{#key}` block, or `slideDirection` logic.
- Do NOT add dependencies.
- If the lines above do not match the file (drift since commit `eca4a8163`), STOP and report.

## Verification

- **Mechanical**: `pnpm --filter @cio/dashboard exec svelte-check --threshold error` reports the
  same error count as before the change (343 at the time of writing). `pnpm --filter
  @cio/dashboard test -- --run` passes.
- **Feel check**: open a course exercise with at least five questions, take it, and step with Next
  and Previous.
  - The arriving question moves a short distance in the right direction and settles quickly; it
    must not feel like it travels.
  - Press Next five times as fast as possible. Watch for leaving questions stacking on top of each
    other in the same spot. If more than one outgoing question is visible at once, report it rather
    than improvising a fix — it is a separate finding.
  - In DevTools, Animations panel, set playback to 10% and confirm the overlap of leaving and
    arriving question lasts well under the full 200ms and does not read as two questions printed
    over each other.
  - In DevTools, Rendering panel, emulate `prefers-reduced-motion: reduce` and confirm the question
    swaps with no visible movement.
- **Done when**: the three edits are in, both checks pass, and stepping through ten questions
  feels like turning pages rather than watching a carousel.
