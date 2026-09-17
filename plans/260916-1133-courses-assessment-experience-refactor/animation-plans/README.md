# Animation plans — Courses, Exam and Exercise teacher surfaces

Produced by an `improve-animations` audit at commit `eca4a8163`, 2026-09-17. Scope: 378 files under
`apps/dashboard/src/lib/features/course`, `apps/dashboard/src/lib/features/exam` and
`packages/ui/src/custom/exercise-question`, excluding the seventeen frozen student-sitting files.

| # | Plan | Severity | Status |
|---|---|---|---|
| 001 | [Shrink the question-step slide to a short directional fade](001-shrink-the-question-step-slide.md) | HIGH | DONE `74727a968` |
| 002 | [Honour reduced motion in every drag-and-reorder list](002-reduced-motion-for-drag-and-reorder.md) | MEDIUM | DONE `74727a968` |
| 003 | [Replace `transition-all` with the one property that actually changes](003-replace-transition-all.md) | LOW | DONE `74727a968` |

## Found while executing 003

Plan 003 set the upload bar to `ui:duration-(--ui-duration-slow)`, and checking the class was emitted
showed it was not: `slow` and `deliberate`, and the `in`, `in-out` and `spring` easings, had never
been published as utilities, because nothing inside `packages/ui` used them. The upload bar had been
running at Tailwind's default since an earlier commit moved it onto `slow`. Fixed at the source in
`d7b8fd461` by publishing the whole scale with `@source inline`. Feel checks for 001 and 002 are
still owed on production: the 24px offset is a starting value, and reduced-motion drag behaviour
needs a real drop.

## Execution order

001, then 002, then 003. They share no lines. 001 first because it is the only feel-breaking one
and sits on the most frequent action a learner takes. 002 and 003 are independent of each other.

## Rejected during vetting

Recorded so the next audit does not raise them again.

- `apps/dashboard/src/lib/features/course/pages/exam-import-review.svelte:332` exits with
  `cubicIn`. Ease-in on UI is normally a finding, but `motion-vocabulary.md` (line 49 and the
  "Enter / Exit" row) documents ease-in for exits as a deliberate choice. Respected.
- `packages/ui/src/custom/exercise-question/renderers/word-bank/take.svelte:187` uses
  `in:scale`. Svelte's default start is 0, which would be a finding, but this call passes
  `start: 0.92`, inside the 0.9–0.97 range.
- `certificate/editor/panels/templates-panel.svelte:23,25` and `colors-panel.svelte:23,25` lift on
  hover with no hover media query. Not a finding: Tailwind v4 emits `hover:` inside
  `@media (hover:hover)`, confirmed in the built stylesheet
  (`@media (hover:hover){.hover\:-translate-y-0\.5:hover{…}}`).
- `course-header.svelte:76` transitions `width` and `height` linearly. This is the stock shadcn
  sidebar-inset header pattern, and the element resizes with the sidebar rather than entering.
- `packages/ui/src/custom/exercise-question/assessment-passage-rail.svelte:44` transitions `width`.
  The component has **no importer anywhere** in `packages/` or `apps/`, so nothing renders it.
  Dead code — mentioned, not removed.
- Six `animate-pulse` skeletons (assessment composer, textarea take and preview). Loading
  placeholders are the intended use, and the global reduced-motion rule caps their iteration count.

## Missed opportunities

None new beyond `../animation-opportunities.md`, which already ran the find pass on this surface
twice and recorded what it accepted and rejected. The motion here is close to right; the three plans
above are corrections, not additions.
