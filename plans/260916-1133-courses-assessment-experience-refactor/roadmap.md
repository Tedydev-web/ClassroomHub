# The programme, rewritten from what is now known — 2026-09-16

`plan.md` was written from a survey and has since accumulated nine corrections. This replaces its
navigation: the baseline below is measured, not carried over, and the phases are what is actually
left rather than what was originally guessed.

Read `outstanding-checklist.md` for the open items and `typography-audit.md` for the design-system
measurements. This file is the shape of the work.

## Baseline, measured today

| | |
|---|---|
| `svelte-check` | 344 errors — unchanged across all 84 commits this session |
| Tests in `features` | 362 passing, 44 files (296 at session start) |
| Hardcoded palette colours in scope | **28**, down from 123 |
| The three oversized files | **4672** lines, down from 4837 |
| Frozen-file gate | 0 files changed, every commit |

## What this programme is, stated plainly

The fork built two things upstream does not have: a **canonical assessment composer** and **file
import**. Neither is drift and neither gets re-synced away. What went wrong is everything around
them — flows that do not close, states that lie, a design system installed but not spent, and dead
code that reads as though it works.

So the work is: **finish the flows, make every state tell the truth, spend the design system, and
delete what cannot run.** That is the whole of it.

### The distinction that organises everything

"Divergence from upstream" is two unrelated things, and conflating them is how a session ends up
deleting the feature it was hired to finish.

- **Deliberate** — the composer, the import path, the canonical model. Keep and finish.
- **Accidental** — the two-pane workspace for legacy questions, now reverted.

Measured: `pages/exercise.svelte` differs from upstream by **one line**; the tabs are identical; the
two-card layout is upstream's own. After the revert, `edit-mode.svelte` is upstream's structure plus
three snippets, all of them the canonical feature.

## Phases, as they now stand

### Done

**Truth in every state.** Three loaders genuinely turned failure into emptiness (not thirteen); all
three converted. The course shell had no failure exit and spun forever; it has one. The gradebook
and analytics distinguish failure from emptiness.

**The design foundation, and the holes in it.** The `ui:` prefix decision, 31 unstyled usages, a
pre-commit guard. Then today: the type scale's three new steps **emitted no CSS at all** and are now
published; 25 modals opened as wide as the window and are now capped, with a second guard.

**Motion.** Vocabulary, four easings, five durations, a global reduced-motion guard, and the four
opportunities worth taking. The fifth was withdrawn after reading the code.

**Dead code.** 1,104 lines in the first pass; 200 more today — an AI grading feature that could not
run, because it targets a schema and an API route that no longer exist.

**Structure.** Six pure-function seams out of the three oversized files, 66 tests, each move
behaviour-preserving by construction.

### Open, and blocked on the owner

| Decision | What it unblocks |
|---|---|
| Does AI ship while the gateway is off? | D5 — the suggestion offered though unusable. D6 is already resolved by deletion. |
| The two-card meta layout — upstream's, kept or reworked? | the shape of the visual pass |
| Which of the five schema-only interaction kinds are wanted? | whether that is a phase or a footnote |
| `Page.Root` width variant — may it reach `org/` and `lms/`? | one shell across the app |
| The parked workspace panel — delete or keep? | 190 lines, and whether the two-pane idea returns |

### Open, and needs someone looking at the screen

**The last 28 colours**, 22 of them in `marks.svelte`, where greys sit between the grade tints and a
wrong substitution changes what a mark *means* rather than how it looks.

**The compact type tier.** `course-list-row.svelte` runs a container-query ramp whose roomy tier
already uses tokens; its compact tier needs a step below `2xs` or an explicit exemption.

### Not started

**The five interaction kinds** — `word_bank`, `ordering`, `star_rating`, `file_upload`,
`video_recording` have a schema and nothing else: no composer, no renderer. `numeric` and
`fill_blank`, which the inherited plan listed as missing, are already done. The renderer's silent
blank is fixed, so an unbuilt kind now fails visibly instead of rendering nothing.

**Component splitting.** Pure extraction has reached its limit — the composer is 812 script against
1028 template. Going further changes render structure rather than preserving it, and belongs where
someone can see the result.

## The rule this session earned

Nine claims in this programme's own documents did not survive being read: D14, D1, D13, D11, D12,
D9, the Phase 2 definition, row 5 of the animation report, and the typography audit's own count of
87. Three more surfaced while converting colours — a section colour picker that a blind sweep would
have destroyed, a ring offset coupled to a background, and a token that was never published.

**Read the site before fixing it.** A survey is a hypothesis. So is a grep. So, twice today, was a
detector I wrote myself.
