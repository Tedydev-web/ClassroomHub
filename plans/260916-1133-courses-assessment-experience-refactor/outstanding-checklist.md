# What is still open — 2026-09-16

Compiled after the owner looked at the live authoring screen and rejected it. Everything here is
either measured in this repo or read from production; nothing is carried over on trust.

## 0. The correction that reframes the rest

**The Phase 1 flip moved the screen *away* from upstream, which is the opposite of the goal.**

Measured against `upstream/main`:

| File | upstream | fork |
|---|---|---|
| `edit-mode.svelte` | 599 | 1043 |
| `view-mode.svelte` | 1125 | 1761 |
| `assessment-item-composer.svelte` | **does not exist** | 1840 |

`upstream/main`'s `edit-mode.svelte` contains **zero** occurrences of `grid-cols-[minmax`,
`workspacePanel` or `data-assessment-workspace`. The outline-and-editor split is entirely a fork
invention. The page container is identical in both (`lg:max-w-5xl`).

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

## 1. Blocked on the owner — nothing proceeds without these

| # | Question | Blocks |
|---|---|---|
| 1 | Does AI ship in assessment while the gateway is off? Both env flags `false`, both model pins empty, circuit breaker `open` since 2026-09-09. Covers D5 (suggestion offered though unusable) and D6 (`hidden!` "Grade with AI" over a commented-out handler). | Phases 4–5 |
| 2 | May the exercise import path change appearance alongside the exam path, or must it stay pixel-stable? | whether the shared review screen is restyled once or gated by target |
| 3 | Is the exercise Submissions tab meant to be read-only, or is the missing grading entry a regression? (D3) | Phase 3 |
| 4 | Does publish belong in the composer header, or is the course-level publish flow authoritative? | composer header design |
| 5 | Is `certificates/editor` meant to stay full-screen outside the course shell? | Phase 6 |
| 6 | F6 — `Page.Root` width variant API. Touches 30 usages in `org/` and `lms/`, beyond this goal's stated scope. | Phase 0c |

## 2. Defects visible on the screen the owner sent

| # | Defect | Evidence | State |
|---|---|---|---|
| 1 | Two-pane workspace does not match upstream | measured above | **fixed** — reverted |
| 2 | New question starts at 0 points and shows "Điểm phải lớn hơn 0" before anything is typed | `store.ts:475` was `points: 0`; upstream `store.ts:221` is `points: 1` | **fixed** |
| 3 | "Đến hạn bởi" — not Vietnamese anyone writes | `vi.json` at `…all_exercises.view_mode.due` | **fixed** → "Hạn nộp" |
| 4 | "bài nộp" lowercase beside "Câu hỏi" and "Cài đặt" | `vi.json` at `…all_exercises.submissions` | **fixed** → "Bài nộp" |
| 5 | "Câu hỏi 11" clipped to "u hỏi 11" at the card's left edge | screenshot | **open** — cause not established; needs the live DOM, and it may go with the revert since it sat inside the reverted panel |
| 6 | Two "Thêm câu hỏi" buttons, page header and card header | screenshot | **open** — needs a decision on which one owns the action |
| 7 | Large dead vertical space under the question editor | screenshot | **open** — likely also inside the reverted panel |

## 3. Unfinished features

| # | Item | Measured state |
|---|---|---|
| 1 | **Five interaction kinds have a schema and nothing else** — `word_bank`, `ordering`, `star_rating`, `file_upload`, `video_recording`. A teacher cannot author them and a learner cannot see them. `numeric` and `fill_blank`, which E2 lists as missing, are **already done**. | the renderer's silent-blank half is fixed (`2ed7cb44c`); composer and renderer support are not built |
| 2 | **An exam's paper can never be edited.** The `paper_is_fixed` alert and the read-only paper tab render **unconditionally**, though the code's own comment says the paper freezes *on open*. A draft exam should be editable and is not. | `exams/[examId]/+page.svelte:114-126` |
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
