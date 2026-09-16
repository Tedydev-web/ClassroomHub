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
| Hardcoded palette colours in scope | **6**, down from 123 — and all six are the documented exclusions |
| The three oversized files | **4672** lines, down from 4837 |
| Frozen-file gate | 0 files changed, every commit |

### Every defect class, swept and counted

Run against the 375 in-scope files. A number here is either zero or exactly the exclusions this
programme has argued for in writing — nothing is merely unexamined.

| Class | Remaining | What it is |
|---|---|---|
| Hardcoded palette colours | **6** | the section colour picker (2), the certificate canvas (1), and two mentions inside an explanatory comment |
| Arbitrary font sizes | **24** | the course card's container-query compact tier (13) and certificate rendering (11) |
| Modals that open as wide as the window | **0** | |
| Dialog width classes that silently do nothing | **0** | was **35** — every unprefixed `w-*` lost to the base's `ui:w-full`, so no dialog had the width its author wrote. The guard only checked `max-w-*`; it now checks `w-*` too |
| Features switched off by a hardcoded constant | **0** | `USE_ASSESSMENT_WORKSPACE_PANEL` and its panel are deleted |
| Empty handlers and hidden affordances | **0** | |
| Translation keys that print their own path | **0** | |
| Click-only handlers with no keyboard equivalent | **0** | measured over every `.svelte` in the three roots; the first detector read only as far as `onclick=` and so could not see an `onkeydown` written after it, and reported a false positive |
| Accessibility suppressions in scope | **2** | both on the import review scrolling panes, both correct — a scrolling landmark needs `tabindex`, which is what the rule flags. Now documented in place rather than left bare |
| Failure rendered as emptiness | **0** | five swallowing `catch` blocks examined: three are correct (a missing draft is absent, not broken; blocked site storage is handled deliberately twice), one is a degraded-but-valid optional thumbnail, and one was a real defect — an unsupported `Intl.supportedValuesOf` rendered an empty timezone select — now fixed |
| Links pointing at routes that do not exist | **0** | |

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
- **Accidental** — the two-pane workspace for legacy questions, reverted and now deleted outright.

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

### Settled without asking

**The two-card meta layout stays.** It is upstream's own design and the fork differs from it by one
line; the burden is on any change, not on keeping it. Reworking it is a visual choice that belongs
with the screens awaiting review, not a gate on the programme.

**The parked workspace panel is deleted**, 261 lines including the state only it read. It was this
session's own mess, behind a constant that was never true, from a layout the owner rejected on
sight. Keeping a switched-off copy of a rejected idea is not optionality.

### Open, and blocked on the owner

| Decision | What it unblocks |
|---|---|
| `Page.Root` width variant — may it reach `org/` and `lms/`? | one shell across the app |

### Open, and needs someone looking at the screen

**Seven deployed screens nobody has looked at yet** — the gradebook, the analytics empty state, the
lesson list and content tree, the section editor, the document viewer in dark mode, the exercise
settings tab, the grading modal, and the certificate modal. Each was converted in its own commit so
any one can be reverted alone.

The gradebook was held back three times on the theory that its greys sat between the grade tints.
Reading it line by line showed otherwise: all 22 were table chrome, and the five grade tints come
from `gradeCellClass()`, untouched. The caution was right; the theory was not.

**The compact type tier.** `course-list-row.svelte` runs a container-query ramp whose roomy tier
already uses tokens; its compact tier needs a step below `2xs` or an explicit exemption.

### Not started

**`word_bank` and `ordering` are built** — model, renderer and composer, on 2026-09-16. `file_upload`
and `video_recording` remain, blocked on an API id bridge rather than on UI: the upload endpoints
exist but key on a legacy question id. `star_rating` is not recommended; the scorer has no path for
it.

**The remaining interaction kinds** — specified in `interaction-kinds-spec.md`, and the gap is smaller
than "not started" suggests. Six of the seven schema modules already know all five: validation,
scoring rules, delivery shape, response envelope, capabilities and the legacy adapter. **Only
`assessment-vertical-slice.ts`** does not, and that is one branch per kind in each of two pure
functions. What is genuinely absent is the composer and the renderer. `numeric` and `fill_blank`,
which the inherited plan listed as missing, are already done. The renderer's silent blank is fixed,
so an unbuilt kind fails visibly rather than rendering nothing, which means the three pieces can
land in any order safely.

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

## Screen-by-screen audit — all 21 course routes, 2026-09-16

Criterion 1 of "what done looks like" is *the shared shell, the route owning the title, and a
document title set*. Measured across every `+page.svelte` under `(app)/courses`:

| | Count |
|---|---|
| Route owns its `Page.Title` | 14 of 21 |
| Title comes from the layout | 1 |
| No title mechanism | 6 |
| **Document title set** | **2 of 21 — and neither sets it through the app's own mechanism** |

The second row is the finding. The root layout at `+layout.svelte:30` already merges
`page.data.pageMetaTags` over the site defaults through `resolveMetaTags`, which has its own
tests and its own bug history. **Not one of the twenty-one course routes passed it anything.**
Every screen therefore served `PUBLIC_APP_TITLE`, so a teacher with an exam, its source exercise
and a lesson open had three identical tabs and a browser history that could not tell them apart.

Fixed on the three screens whose loader already holds a name: the exam, the exercise and the
lesson.

**The attempt screen was attempted and reverted, and the reason is worth recording.** Its loader
calls `safeServerApi` with no success type, so `result.body` is `unknown` and the three existing
reads are already errors. Adding the candidate's name added two more. Narrowing the response by
hand made it worse — `svelte-check` went 343 → 354, because the hand-written shape threw away
what the page component was relying on. The honest prerequisite is typing that endpoint's
response, not casting at the call site.

The remaining fourteen screens need translated section names, and the translation store is a
module-level singleton: calling it inside a server `load` would share one locale across
concurrent requests. Those titles need the locale passed in explicitly, which is its own change.
