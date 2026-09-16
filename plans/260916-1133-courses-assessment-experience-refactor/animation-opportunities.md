# Animation opportunities — teacher surfaces

A search pass over Courses, Exam and Exercise for moments that would genuinely benefit from
motion. The student sitting screen is out of scope and untouched.

The posture is restraint. This is a dense tool a teacher works in all day, so most candidates were
rejected — and the rejections below matter as much as the suggestions. Every value comes from the
tokens already installed, not from new numbers.

## Part 1 — Opportunities

| # | Location | Today | Purpose | Frequency | Suggested motion |
|---|---|---|---|---|---|
| 1 | `pages/exam-import-review.svelte:306-338` | Sixteen `{#if}` branches and **zero transitions**. After a wait that can run to ten minutes, the parsing view is replaced by the result in the same frame. | Preventing a jarring change | Rare | Fade the outgoing state at `ui:duration-(--ui-motion-duration-fast)` with `ease-ui-in`, bring the result in at `base` with `ease-ui-out` and `translateY(4px)`. Bridge only the status swap at `:306`; the inner findings list stays static. |
| 2 | Every primary action across the teacher surfaces — `exam-import-review.svelte` has **0** press states, and only one file in the whole `course` + `exam` tree uses `active:scale` against 79 `onclick` handlers in `components/exercise/` alone | A click produces nothing until the request returns | Feedback | Tens/day | `active:scale-[0.98]` with `ui:duration-(--ui-motion-duration-instant)` and `ease-ui-out`. Deliberately near-imperceptible: at this frequency anything larger reads as sluggish within a day. |
| 3 | `submissions.svelte:99,103` → `summary.svelte:69`, `individual.svelte:214`; `grading-loader.svelte` has no importer | `isLoading` is passed a hardcoded `false` and the spinners never render | — | — | **Withdrawn after checking.** Neither `Summary` nor `Individual` fetches anything: `submissions` arrives as an already-resolved prop from the page loader (`pages/exercise.svelte:807`). So `isLoading={false}` is *correct*, and the spinner branches are vestigial from when these components loaded their own data. The honest fix is to delete the dead prop and its branches, not to wire them — that belongs with the dead-code work, not here. |
| 4 | Error and empty states, including the two just added to marks and analytics | Appear instantly | Preventing a jarring change | Rare | Fade + `translateY(4px)` at `fast` with `ease-ui-out`. Deliberately the fast token, not `base`: an error must not saunter in while the user is already waiting. |
| 5 | Popovers and dropdowns across the teacher screens | Grow from their own centre | Spatial consistency | Occasional | Scale from `0.96` with `transform-origin` set to the trigger, `base` + `ease-ui-out`. Exit along the same path, `fast` + `ease-ui-in`. |

`transform` and `opacity` only, so every row composites on the GPU. The global
`prefers-reduced-motion` guard already neutralises all five.

## Part 2 — Rejected

- **Kanban drag on `submissions.svelte:222,232`** — already correct. `flipDurationMs = 300` happens
  to land exactly on the `slow` token, and `svelte-dnd-action` already handles the reorder bridge.
  Nothing to add; renaming the constant to the token is cosmetic and can wait.
- **Question reorder in `order-modal.svelte:8`** — same, already uses `flip`.
- **The gradebook table in `pages/marks.svelte`** — functional data a teacher is reading and acting
  on. Rejected on the function gate: motion on a mark being compared across students hinders.
- **`analytics-graph.svelte`** — animated line drawing on a chart. Same gate. The teacher is reading
  values, not watching a chart perform.
- **Course sidebar navigation (`course-sidebar-navigation.svelte`)** — used dozens of times per
  session to move between screens. Rejected on frequency: navigation that animates feels slower
  every single time after the first.
- **Tab switches inside the exam detail screen** — a direction-aware slide was tempting, but tabs
  here are a primary navigation control, not an occasional surface. Rejected on frequency.

## Part 3 — Verdict

This interface needs very little motion, and it is closer to right than the raw counts suggest — the
drag interactions are already correct and the durations already cluster on a real scale. What it
lacks is not animation but *feedback*: a click that does nothing visible, a wait that shows nothing,
and a result that teleports into place.

Highest leverage is row 2 — press feedback — because it is the one moment every teacher meets on
every screen, dozens of times a day, and it currently produces nothing at all. Row 1 is next: the
import wait is the longest the product ever asks anyone to sit through, and it ends in a teleport.

Row 3 is a reminder to check before fixing. It was written as "loading states exist but were never
wired", which was the wrong diagnosis: the components take resolved props, so the hardcoded `false`
is correct and the spinners are leftovers. A skeleton belongs where a screen genuinely waits on a
fetch, and that has to be established per screen rather than assumed from the presence of a spinner.
