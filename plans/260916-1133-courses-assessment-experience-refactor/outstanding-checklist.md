# What is still open — 2026-09-16

Compiled after the owner looked at the live authoring screen and rejected it. Everything here is
either measured in this repo or read from production; nothing is carried over on trust.

## 0. The correction that reframes the rest

**The Phase 1 flip shipped a screen the owner rejected on sight, and it has been reverted.**

That sentence is the whole justification. The owner conditionally approved the flip — *"Bật, tôi sẽ
tự xem rồi phản hồi"* — looked at it, and reported *"UI không hề ổn xíu nào"*. Terminal feedback on
a conditional approval. Nothing else is needed to warrant the revert.

**Do not use "upstream does not have it" as the test for drift.** An earlier draft of this section
did, and the reasoning is broken: `upstream/main` also has no `assessment-item-composer.svelte`, no
`exam-import-review.svelte`, and no canonical assessment model at all. Absence from upstream is the
fork's *entire premise*. Treat that measurement as context — it says where the fork stands, never
that a thing should be removed. Read as a rule, it would license stripping the exact feature this
programme exists to finish.

Measured against `upstream/main`, as context only:

| File | upstream | fork |
|---|---|---|
| `edit-mode.svelte` | 599 | 1043 |
| `view-mode.svelte` | 1125 | 1761 |
| `assessment-item-composer.svelte` | **does not exist** | 1840 |

`upstream/main`'s `edit-mode.svelte` contains **zero** occurrences of `grid-cols-[minmax`,
`workspacePanel` or `data-assessment-workspace`, and the page container is identical in both
(`lg:max-w-5xl`). Read that as placement, not as a verdict: the composer is absent from upstream
too, and it stays.

The flag I deleted carried its own explanation:

> *"Question authoring follows the upstream layout: every legacy question is edited in place inside
> its section, with no separate outline-and-editor split. The two-pane workspace panel below is kept
> intact behind this switch so it can be folded back in once the new authoring design is settled."*

Reverted in `9ac1ff2c3` and its pair; both reverts applied clean, verified with
`git apply --check -R` before running them.

**The distinction that was missing**, and that the rest of this programme should be organised
around: "divergence from upstream" is two unrelated things.

- **(a) Deliberate feature divergence** — the canonical assessment composer and file import. This is
  the product the fork set out to build. It is not drift and must not be "re-synced" away.
- **(b) Accidental layout divergence** — the two-pane outline workspace for *legacy* questions.
  This is what made the screen unlike upstream, and it was parked behind a flag for exactly that
  reason.

E1 was written about (a). I applied it to (b).

## 0b. How far the exercise screen actually diverges — measured after the revert

The complaint was that this screen looks nothing like upstream. Measured, it is almost entirely
upstream already:

| Thing | upstream | fork |
|---|---|---|
| `pages/exercise.svelte` | 944 lines | **945** |
| Tabs on the page | questions, settings, submissions | **identical** |
| The meta card (title, due date, description) | `pages/exercise.svelte:784` | **same file, same line** |
| `exercises/[exerciseId]/+page.svelte` | 74 | 100 — the +26 is the failure state added today |
| `edit-mode.svelte` snippets | 5 | 8 |

The three extra snippets are `compactCanonicalQuestionRow`, `assessmentComposerPane` and
`canonicalQuestionEditor` — all of them the canonical assessment feature, and nothing else
structural.

So the two-card stack the owner disliked is **upstream's own design**, line for line. What was
genuinely divergent was the two-pane workspace, now reverted. After that revert,
`edit-mode.svelte` is upstream's structure plus the feature the fork set out to build, which is
exactly what "re-sync with upstream while keeping what we added" means.

**Still in the file and worth a decision:** the parked workspace panel is roughly 190 lines that
no longer render. The comment says it is kept "until the new authoring design is settled". The
owner has now seen it and rejected it, so either it goes — committing to the upstream shape — or
it stays parked because there is an intention to return to it. Leaving it undecided is how dead
code accumulates.

**Screenshot row 5 resolved without needing a reload.** The clipped "Câu hỏi 11" header sat inside
the `USE_ASSESSMENT_WORKSPACE_PANEL` block at `edit-mode.svelte:775`, together with the
"Thêm tương tác" and "Thêm câu hỏi" buttons visible beside it. That block no longer renders, so
the clipped element does not exist.

## 1. Blocked on the owner — nothing proceeds without these

| # | Question | Blocks |
|---|---|---|
| 1 | Does AI ship in assessment while the gateway is off? Both env flags `false`, both model pins empty, circuit breaker `open` since 2026-09-09. Covers D5 (suggestion offered though unusable) and D6. **For D6 the question is now narrower than "build or delete" — see below.** | Phases 4–5 |
| 2 | May the exercise import path change appearance alongside the exam path, or must it stay pixel-stable? | whether the shared review screen is restyled once or gated by target |
| 3 | Is the exercise Submissions tab meant to be read-only, or is the missing grading entry a regression? (D3) | Phase 3 |
| 4 | Does publish belong in the composer header, or is the course-level publish flow authoritative? | composer header design |
| 5 | Is `certificates/editor` meant to stay full-screen outside the course shell? | Phase 6 |
| 6 | F6 — `Page.Root` width variant API. Touches 30 usages in `org/` and `lms/`, beyond this goal's stated scope. | Phase 0c |

**D6 measured, and one of its two options turns out not to exist.**

`mark-exercise-modal.svelte` is 450 lines, **95 of them commented out** — ten blocks between lines
138 and 251. `gradeWithAI()` at `:236` has an entirely commented body, wired to a button at `:425`
that carries `hidden!`. The flag it would set, `isGradeWithAI`, is threaded as a `$bindable` from
`submissions.svelte:37` through the modal and on into a grading child at `:295` — and the only line
that would ever set it `true` is the commented `:237`. So the flag is permanently `false` across
three files.

The decisive part: the commented body reads `question_type_id`, `open_answer` and
`data.questionAnswers`. Those are **pre-migration snake_case columns**. Grepping live code, they
survive only inside `packages/db/src/scripts/finalize-assessment-schema.ts`, the script that mapped
them to camelCase. Nothing in the application uses them any more.

So this code **cannot be uncommented and run**. "Build from it" was never an option; building AI
grading means writing it against the current schema, to which these 95 lines contribute nothing.
The real choice is *delete now* or *keep 95 lines that read as one uncomment away from working*.
Left for the owner because the feature is theirs to want, not because the code might still be
useful.

## 2. Defects visible on the screen the owner sent

| # | Defect | Evidence | State |
|---|---|---|---|
| 1 | Two-pane workspace does not match upstream | measured above | **fixed** — reverted |
| 2 | New question starts at 0 points and shows "Điểm phải lớn hơn 0" before anything is typed | `store.ts:475` was `points: 0`; upstream `store.ts:221` is `points: 1` | **fixed** |
| 3 | "Đến hạn bởi" — not Vietnamese anyone writes | `vi.json` at `…all_exercises.view_mode.due` | **fixed** → "Hạn nộp" |
| 4 | "bài nộp" lowercase beside "Câu hỏi" and "Cài đặt" | `vi.json` at `…all_exercises.submissions` | **fixed** → "Bài nộp" |
| 5 | "Câu hỏi 11" clipped to "u hỏi 11" at the card's left edge | screenshot | **open, cause unknown — the one item blocking the next step.** The obvious explanation was disproved: the grid needs 288+512=800px and the container gives ~976px, so it fits. Left-edge clipping is not what `truncate` or grid overflow produce. It may have sat inside the reverted panel, or it may live in the shared card or page container and still be on production. One line of feedback separates the two: reload the same URL after this deploy and say whether "Câu hỏi" is still cut. Do not design around it until that is known. |
| 6 | Two "Thêm câu hỏi" buttons, page header and card header | screenshot | **closed — not a defect.** Upstream has both by design: `addQuestionFromHeader` on the page header (`pages/exercise.svelte:657` upstream, `:642` here) and `onAddQuestion` per section. What the screenshot showed was *three* add affordances at once, because the panel contributed its own "Thêm tương tác" and "Thêm câu hỏi" pair in its header. With the panel off, the upstream pair remains. |
| 7 | Large dead vertical space under the question editor | screenshot | **closed.** It was the panel's own grid: `xl:min-h-[40rem]` on the two-pane container at `edit-mode.svelte:782`, which reserved 40rem of height whatever the editor held. That container no longer renders. |

## 2b. Strings that printed their own key path — swept, not stumbled on

D21 found one of these by accident while copying a pattern. A systematic sweep of every `$t(...)`
call against `en.json` found **118 keys referenced but never defined**, of which **18 are in
Courses, Exam or Exercise**. Each one renders its own key path on screen: the translations module
says so itself at `translations.ts:12` — *"Without a fallback, `$t` returns the key path"* — and
the fallback is `en`, so a key missing from `en` has nothing left to fall back to.

Two sat in the composer the owner is using right now: `common.remove` on a control's label and
`…shared_question.answer_key` on a field legend. `common` held only five keys and neither `remove`
nor `delete` was among them. Others covered the per-student exercise list's empty state, the
analytics CSV column headers, and the "course copied" confirmation.

All 18 are now defined in `en` and `vi`. Re-running the sweep returns **zero** in scope. The other
100 sit in `audience`, `automation`, `cohort`, `media`, `org` and `tag` — outside this goal, listed
here so nobody has to rediscover them.

## 2c. Sweeps that came back clean

Worth recording, because a negative result stops the next session repeating the search.

- **Dead links.** Every static `href`, `goto(` and `resolve(` target in Courses, Exam and Exercise
  was matched against the 108 real routes under `src/routes`. **Zero** point at a route that does
  not exist. The one candidate, `/course/${slug}` in `course-list-row.svelte:134`, resolves to
  `(org-site)/course/[slug]`, which is present — the matcher had truncated the interpolation.
  Acceptance criterion 5 holds for static links; runtime navigation is not covered by this.
- **Features wired off.** Only `USE_ASSESSMENT_WORKSPACE_PANEL` remains, and it is the one under
  discussion. The `isLoading={false}` family is gone with D9, and there are no empty `onclick`
  handlers.

## 3. Unfinished features

| # | Item | Measured state |
|---|---|---|
| 1 | **Five interaction kinds have a schema and nothing else** — `word_bank`, `ordering`, `star_rating`, `file_upload`, `video_recording`. A teacher cannot author them and a learner cannot see them. `numeric` and `fill_blank`, which E2 lists as missing, are **already done**. | the renderer's silent-blank half is fixed (`2ed7cb44c`); composer and renderer support are not built |
| 2 | **An exam never links to the exercise that holds its questions.** Corrected after checking: this is not a missing *gate* on `paper_is_fixed`, it is a missing *link*. `exam.exercise_id` exists and every exam points at a real container — G12 MOCK TEST 1 → "MOCK TEST 1", TEST 1 → "KEY- ĐỀ THI THPT 2026", and so on — but the loader never returns it and no exam screen offers a way there. Editing an exam's questions means editing that exercise, and nothing says so or takes you there. Worse for a draft: it has no frozen paper at all (the endpoint 409s), so the tab shows an empty paper under an alert saying the paper is fixed. | `exams/[examId]/+page.server.ts:76-79`, `+page.svelte:114-126`, verified against production |
| 3 | **No draft exam exists to test with.** All four exams are `open` or `closed` and every one has attempts: 20, 13, 1, 7. | queried production |
| 4 | D3 — grading unreachable from the Exercise surface | blocked on question 3 above |
| 5 | D17 — import polling ceiling hard-coded at ten minutes | low |

## 4. Code health

| # | Item | State |
|---|---|---|
| 1 | D20 — three files over 1000 lines | 1043 / 1761 / 1840, **4644** total, down from 4837. Four seams taken, each pure-function-only so the move is behaviour-preserving by construction, each with tests: `take-progress` (11), `assessment-validation-focus` (15), `question-type-transition` (10), `assessment-block-movement` (11). |
| 2 | Divergence from upstream in the two shared screens | `edit-mode` +74%, `view-mode` +57%. Some is feature, some is drift; nobody has separated them line by line. |

## 5. Phases not started

Phase 2 (interaction kinds), Phase 4 (exam authoring shell), Phase 5 (import review), Phase 6
(Courses shell consistency), Phase 7 (passage, responsive, accessibility, release proof).

## 6. The register's own reliability

Seven entries have been corrected this session by reading the code before acting on them: D14, D1,
D13, D11, D12, D9, and the Phase 2 definition itself — plus row 5 of the animation report, which I
wrote. The register was produced by a survey, and a survey is a hypothesis. **Read the site before
fixing it** is the standing rule for this programme.
