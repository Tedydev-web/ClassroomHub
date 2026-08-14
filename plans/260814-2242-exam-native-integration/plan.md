# Exam: native integration with the course

## Outcome

A teacher creates, opens, marks and monitors an exam without leaving the surfaces
they already use for the course, and those screens look and behave like the rest
of the dashboard.

## Why this exists

The exam feature shipped as an island. Two facts, both checked in the code:

- Twelve course pages use the `Page.*` shell (`analytics`, `marks`, `submissions`,
  `attendance`, `certificates`, `compliance`, `lessons`, `settings`, `people`, …).
  The four exam pages use none of it and each invents its own width —
  `max-w-3xl`, `max-w-5xl`, `max-w-6xl`. That is the measurable cause of the
  "inconsistent, unprofessional" complaint.
- The `.docx` exam import is already integrated the right way: it is launched
  from the content-create modal (`content-create-modal.svelte:250`) and has no
  sidebar entry. The exam feature did the opposite and added a top-level route.

## Decisions taken (2026-08-14)

| Question | Decision |
|---|---|
| Do exam scores enter the gradebook? | Yes, like an exercise |
| Who can score into it? | Only a sitter who was signed in while sitting. An anonymous sitting shows in the results table but never enters the gradebook |
| Where is an exam created? | The content-create modal, an exercise's own page, and the `.docx` import |
| The "Đề thi" sidebar item | Removed; folded into Submissions as a tab |

This partially reverses the 2026-08-12 decision that exam scores stay out of the
gradebook. The data separation it protected — the exam delivers a frozen detached
container, and enrolled students cannot open the paper untimed — stays exactly
as it is.

## Constraints

- Reuse `Page.*`, existing tables and filters, `ExerciseQuestion.*`. No new
  page-layout primitives.
- The public sitting page stays outside the app shell; it has no session.
- No breaking change to the exam API, which is live and working.

## Non-goals

- Live proctoring while a paper is being sat.
- Reworking the exercise grading experience.
- Changing the frozen-paper model.

## Phases

### Phase 1 — Put the exam screens in the app's own shell

The four teacher screens adopt `Page.Root / Header / HeaderContent / Title /
Action / Body`, and share one width rule with their neighbours: the list and the
results table follow `submissions`, the create form follows `marks`.

Verify: every exam screen renders a page title; no bespoke `max-w-*` remains in
the four routes.

### Phase 2 — Fold the route into Submissions

Remove the `EXAMS` sidebar entry. Submissions gains a tab for papers sat, beside
the exercise submissions a teacher already reads there.

Verify: no sidebar item; `/courses/{id}/exams` still resolves (deep links and
copied URLs keep working) but nothing in the UI points at it as a section.

### Phase 3 — Three ways to create an exam

- The content-create modal, beside Section / Lesson / Exercise.
- An action on an exercise page: publish this paper as an exam.
- The `.docx` import, which already produces a paper.

All three converge on the existing `paper-from-exercise` copy, so the frozen
container rule holds however the exam was started.

Verify: an exam can be created from each of the three, and each produces a
detached container.

### Phase 4 — The gradebook and the course statistics

The heaviest phase, and the one that touches data.

1. `exam-sitting.ts:145` hardcodes `profileId: null`, so today even a signed-in
   student sits anonymously. Record the profile when the request carries a
   session.
2. A sitting with a profile becomes a gradebook column beside the exercises;
   a sitting without one never does.
3. The course analytics gain the exam results alongside the exercise figures.

Verify: a signed-in sitting appears in the gradebook for that student; an
anonymous sitting on the same paper appears in the results table and nowhere in
the gradebook.

## Risks

- Phase 4 changes what a gradebook total means. A paper that mixes signed-in and
  anonymous sitters will look under-reported to a teacher who does not know the
  rule; the UI has to say so where the total is shown.
- Removing the sidebar entry hides a feature teachers have started using. Phase 2
  must land with the Submissions tab, not before it.
