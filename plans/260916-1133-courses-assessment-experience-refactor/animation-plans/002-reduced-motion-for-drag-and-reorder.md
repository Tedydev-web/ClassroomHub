# 002 — Honour reduced motion in every drag-and-reorder list

- **Status**: DONE — 74727a968
- **Commit**: eca4a8163
- **Severity**: MEDIUM
- **Category**: 6. Accessibility · 7. Cohesion & tokens
- **Estimated scope**: 7 files, 1–2 changed lines each

## Problem

Seven reorderable lists animate items moving to their new position with Svelte's `animate:flip`,
and pass the same duration to `svelte-dnd-action`'s `dndzone`. `flip` and the drag library are
JavaScript: they never see the global `@media (prefers-reduced-motion: reduce)` rule in
`packages/ui/src/index.css`, which only reaches CSS. None of the seven reads the preference, so a
teacher who asked their system for less motion still gets every item sliding across the list.

Each file declares a hardcoded constant and uses it in both places:

| File | Declared | Used by `dndzone` | Used by `animate:flip` |
|---|---|---|---|
| `apps/dashboard/src/lib/features/course/pages/submissions.svelte` | `:35 const flipDurationMs = 300;` | `:246` | `:236`, `:257` |
| `apps/dashboard/src/lib/features/course/components/reorder-material-tabs.svelte` | `:14 const flipDurationMs = 300;` | `:30` | `:41` |
| `apps/dashboard/src/lib/features/course/components/lesson/content-section-list.svelte` | `:409 const flipDurationMs = 200;` | `:448`, `:502` | `:528` |
| `apps/dashboard/src/lib/features/course/components/exercise/edit-mode.svelte` | `:68 const flipDurationMs = 200;` | `:732` | `:746` |
| `apps/dashboard/src/lib/features/course/components/exercise/order-modal.svelte` | `:16 const flipDurationMs = 300;` | `:94` | `:106` |
| `packages/ui/src/custom/exercise-question/renderers/ordering/take.svelte` | `:8 const flipDurationMs = 150;` | `:65` | `:83` |
| `packages/ui/src/custom/exercise-question/renderers/ordering/edit.svelte` | `:22 const flipDurationMs = 150;` | `:132` | `:150` |

The durations themselves are right — 150, 200 and 300 are exactly the repository's `fast`, `base`
and `slow` tokens, and `motion-vocabulary.md` assigns layout animation to `slow`. Only the missing
reduced-motion branch is the defect, plus the literal numbers that should name their tokens.

## Target

Change **only the declaration line** in each file. Every use site already reads `flipDurationMs`,
so both `flip` and `dndzone` follow automatically. The rendered duration is unchanged for
everyone who has not asked for reduced motion.

Dashboard files (`apps/dashboard/…`):

```ts
import { MOTION_DURATION, motionDuration } from '$lib/utils/motion';

const flipDurationMs = motionDuration(MOTION_DURATION.slow); // was 300
const flipDurationMs = motionDuration(MOTION_DURATION.base); // was 200
```

`packages/ui` files cannot import from the dashboard, so they read the preference directly:

```ts
// Reduced motion: flip and the drag library are JavaScript and do not see the stylesheet's
// prefers-reduced-motion rule. One millisecond rather than zero, matching the dashboard's
// motionDuration, so completion callbacks still fire.
const flipDurationMs =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 150;
```

## Repo conventions to follow

- Dashboard: `motionDuration(ms)` and `MOTION_DURATION` from `$lib/utils/motion`
  (`apps/dashboard/src/lib/utils/motion.ts`). It returns `1` under reduced motion, deliberately not
  `0`, because a zero-length transition is skipped and its end callbacks do not fire. Values:
  `fast` 150, `base` 200, `slow` 300.
- Exemplar in the dashboard: `apps/dashboard/src/lib/features/course/components/exercise/assessment-ordering-editor.svelte:82`.
- Exemplar in `packages/ui`: `packages/ui/src/custom/exercise-question/assessment-item-renderer.svelte:327-329`
  defines the same matchMedia check, and `:1002` uses it as `prefersReducedMotion() ? 1 : 150`.

## Steps

1. `submissions.svelte:35` → `const flipDurationMs = motionDuration(MOTION_DURATION.slow);` and add
   the `$lib/utils/motion` import if the file does not already have it.
2. `reorder-material-tabs.svelte:14` → same as step 1 (`slow`).
3. `content-section-list.svelte:409` → `motionDuration(MOTION_DURATION.base)`; add the import.
4. `edit-mode.svelte:68` → `motionDuration(MOTION_DURATION.base)`; add the import.
5. `order-modal.svelte:16` → `motionDuration(MOTION_DURATION.slow)`; add the import.
6. `ordering/take.svelte:8` → the `packages/ui` form shown in Target, with its comment.
7. `ordering/edit.svelte:22` → the same `packages/ui` form.

## Boundaries

- Change only the `flipDurationMs` declaration and, where missing, one import line per file.
- Do NOT change any `dndzone` option other than what the constant already feeds, and do NOT change
  `dropTargetStyle`.
- Do NOT touch any file listed in
  `plans/260916-1133-courses-assessment-experience-refactor/frozen-files.txt`.
- Do NOT add dependencies.
- If a declared value in the table does not match the file, STOP and report.

## Verification

- **Mechanical**: `pnpm --filter @cio/dashboard exec svelte-check --threshold error` reports the
  same error count as before (343 at the time of writing). `pnpm --filter @cio/dashboard test --
  --run` and `pnpm --filter @cio/ui test -- --run` both pass.
- **Feel check**, normal motion first: drag a card on the submissions board, reorder a lesson
  section, reorder questions in the exercise editor. Movement must look identical to before the
  change.
- **Feel check**, reduced motion: in DevTools, Rendering panel, emulate
  `prefers-reduced-motion: reduce`, then **reload the page** (the constant is read once when the
  component mounts) and repeat the same three drags.
  - Items jump to their new positions instead of sliding.
  - Dropping still completes: the item lands, the drop highlight clears, and the new order is kept
    after the save. `svelte-dnd-action` times its drop with `flipDurationMs`; if a drop hangs or the
    highlight stays, report it rather than changing the value.
- **Done when**: all seven declarations use a token or the reduced-motion form, and both feel
  checks pass.
