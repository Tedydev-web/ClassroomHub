---
title: "Courses / Exam / Exercise experience refactor"
status: draft
priority: P1
blockedBy: []
blocks: []
---

# Courses / Exam / Exercise experience refactor

Umbrella programme that finishes and unifies the fork's teacher-facing assessment surfaces.
It inherits three in-flight plans rather than competing with them.

Evidence base: three parallel read-only scouts over the Courses shell, the Exam authoring and
import surface, and the Exercise surface plus the shared design system. Every claim below
carries a `path:line`.

## Premise correction 1 — "make it look like TAO CE" cannot be executed as stated

This repo already investigated it. `plans/reports/research-260730-1605-authoring-platform-comparative.md`
read OAT's published TAO source and concluded there is **no public evidence of TAO CE's
authoring interface**. `plans/reports/research-260730-1702-authoring-workbench-comparative-gates.md`
states the rule: *"Do not copy a test-runner navigator into the composer or infer TAO's
authoring UI from it."*

What transfers from TAO is **workflow, not visuals**: item and test are separate in the model;
validate and sanitise before save; preview executes the learner's own scoring semantics; save,
preview and publish are three distinct moments.

Consequence: any speculative "TAO-looking" visual imported on that premise is a thing to
**remove**, not extend. Visual quality comes from a deliberate design system.

## Premise correction 2 — the code is not rotten; the product is unfinished

Across all three scopes: **0** `TODO`/`FIXME`/`HACK` in live code (the only 4 TODOs sit in a
dead file), **0** `@ts-ignore`/`@ts-expect-error`, **0** `: any` in production code, **0** empty
catches. Type safety is genuinely clean and there are 15+ co-located test files.

The defects are one level up — unfinished flows, states that lie, and a design foundation with
holes. Planning this as "clean up the mess" would find little to delete. Plan it as *finish the
flows, tell the truth in every state, and impose one visual system*.

## Outcome

The teacher-facing Courses, Exam and Exercise surfaces become one coherent, production-grade
product: one page shell and visual language, flows that always say what happened and always
offer a way back, states that never disguise failure as emptiness, and a motion vocabulary that
is deliberate — with the student exam-sitting experience unchanged.

## Constraints

1. **The student exam-sitting UI is frozen.** Verified boundary below. No visual, DOM or
   behavioural change reaches it.
2. **Shared primitives change additively only.** `AssessmentItemRenderer` and `QuestionNavigation`
   are imported by the frozen student page *and* three teacher surfaces. New behaviour arrives as
   opt-in props/snippets; defaults never change.
3. **No new interaction families.** Finish the kinds that already exist.
4. **Public contracts hold** — routes, the `?tab=` contract, response envelopes, and the four
   legacy redirect routes that preserve bookmarks.
5. **The print/PDF template is not a screen.** `exams/[examId]/print/+page@.svelte` renders
   headlessly for PDF export; its raw hex is correct and `exam-export-paper.test.ts` asserts on its
   source. Excluded from visual sweeps.
6. Spacing is already healthy (21 steps, 6 arbitrary values). **Do not "fix" it.**
7. No schema change without a backup; deploys go through the existing production path.

## Non-goals

- Redesigning the student sitting experience, Standard Flow, or the learner renderer.
- Question bank, autosave, a third persistent pane, drag-and-drop canvas, QTI import/export.
- New AI capability. Gating the existing affordance honestly is in scope; building more is not.
- Breadcrumbs. None exist anywhere; adding them means designing the course hierarchy model
  (course → section → lesson → student) from scratch. That is design work, not cleanup.
- Upstream re-alignment for its own sake.

## Acceptance criteria

1. **Freeze proven, not asserted.** The frozen set is listed in `frozen-files.txt` beside this
   plan (17 files, all verified to exist). Run before every commit:

   ```bash
   git diff --name-only main HEAD -- $(tr '\n' ' ' < plans/260916-1133-courses-assessment-experience-refactor/frozen-files.txt)
   ```

   Non-empty output means the freeze broke. In addition, the student sitting screen renders
   identically at 375/768/1280/1600 px before and after.
2. **No state lies.** Every server loader in scope distinguishes failure from emptiness; no screen
   renders "no data" for a failed fetch.
3. **One page shell.** Every teacher screen uses the same shell primitive with a variant API, one
   title mechanism, and a document title.
4. **Tokens actually apply.** Zero token utilities that emit no CSS; zero hardcoded palette colours
   in in-scope components (SVG icon fills and the print template excluded).
5. **Every flow closes.** Success lands where the user expects; failure is visible with a recovery
   action; there is always a way back. No affordance leads to a wall.
6. **No silent high-stakes mutation.** Changing a mark, publishing an import, deleting an exam:
   each shows what happened and offers undo or explicit confirmation.
7. **Motion is a vocabulary** — a documented duration and easing set, applied consistently, with a
   global `prefers-reduced-motion` guard.
8. Build, typecheck, unit and component tests green; the exercise import path, which shares the
   review screen, is covered by a test so it cannot regress silently.

## Frozen boundary (verified)

Routes: `apps/dashboard/src/routes/(org-site)/exam/[slug]/+page.svelte` and `+page.server.ts`
(the only two files under that route).

Student-only modules under `apps/dashboard/src/lib/features/exam/`, each imported by the sitting
page and nothing else: `exam-countdown.svelte`, `exam-entry-form.svelte`, `exam-window-notice.svelte`,
`exam-start-confirm.svelte`, `exam-submit-confirm.svelte`, `exam-resume-offer.svelte`,
`exam-resume-owner.ts`, `exam-left-warning.svelte`, `exam-activity.ts`, `exam-activity-outbox.ts`,
`exam-autosave.ts`, `exam-refusals.ts`, `exam-paper-navigator.svelte`, `exam-annotations.ts`,
`exam-link-preview.ts`.

Shared hazards — reached by the frozen page *and* by teacher surfaces:

| Module | Teacher consumers | Rule |
|---|---|---|
| `packages/ui/src/custom/exercise-question/` (`AssessmentItemRenderer`, `QuestionNavigation`) | `assessment-item-composer.svelte`, `exam-import-question-card.svelte`, `attempts/[attemptId]/+page.svelte` | Opt-in props/snippets only. The component already exposes `showItemHeader`, `showContainer`, `fillsParent`, `revealsKey`, `questionNumberActive` — extend that pattern; never change a default. |
| `lib/features/exam/paper-outline.ts` | `attempts/[attemptId]`, `exam-paper-tab.svelte` | Pure logic; may extend, return shape fixed. |
| `lib/features/exam/exam-window.ts` | `exams/[examId]/+page.server.ts`, `exam-list.svelte` | Pure logic; may extend. |

## Foundation blockers — these gate everything visual

**F1. The `ui:` prefix split silently deletes CSS.** `packages/ui/src/index.css:1` compiles with
`@import 'tailwindcss' prefix(ui)`. `apps/dashboard/src/app.css:3-5` imports plain `tailwindcss`
plus that compiled output and defines **no `@theme` of its own**. Verified against the built
artifact `apps/dashboard/.svelte-kit/output/client/_app/immutable/assets/0.BLNOH5qU.css`:
`.ui\:bg-primary` is present; `.bg-primary`, `.text-muted-foreground`, `.bg-card`, `.border-border`
are absent. Plain utilities like `.flex` and `.text-sm` do work.

So every token utility must be written `ui:`-prefixed in the dashboard, and **40 occurrences
across 22 files are unprefixed and currently render unstyled** — worst `lib/features/exam/exam-answer-summary.svelte`
(9, e.g. `:50,73,79,81`). This must be decided — adopt, remove, or bridge — before any new UI is
written, or the redesign inherits a silent-failure mode.

**F2. No typography scale.** Colour and radius tokens are complete in OKLCH with full dark coverage
(`packages/ui/src/index.css:58-176`), but there is no type scale in `@theme`. Usage: 8 Tailwind
steps against **≥20 arbitrary pixel sizes** (~200 occurrences) including `text-[13.5px]`,
`text-[11.5px]`, `text-[9.5px]` — half-pixel values are eyeballed fitting, not a scale.

**F3. No motion tokens.** 13 discrete durations and 13 easings are in use, including **7
hand-written cubic-beziers, three of them near-duplicate back-out curves**. Nothing shared is
defined.

**F4. `prefers-reduced-motion` is effectively unimplemented.** Four sites exist, **none in the
dashboard product surface**, and there is no global guard in `index.css` or `app.css`. 131
tw-animate occurrences, 34 Svelte transitions and 9 keyframe animations (several `infinite`) run
regardless. This is an accessibility defect.

**F5. Error masquerades as empty.** 13 of 15 course server loaders collapse a fetch failure into
`null`, which the UI renders as the empty state: `marks/+page.server.ts:17` → `pages/marks.svelte:102`
tells a teacher the course has no students; `analytics/+page.server.ts:24` → `pages/analytics.svelte:46-52`
likewise. The one correct pattern already exists at `people/[personId]/+layout.server.ts:31,37`
(`loadFailed`). **Normalising empty states before fixing loaders would cement the lie.**

**F6. `Page.Root` width is an app-wide gap, not a courses bug.** Seven distinct width recipes across
11 course usages, plus 30 more `Page.Root` usages elsewhere in the app with their own variants. The
fix belongs in `packages/ui/src/base/page/` as a variant API. Normalising only Courses would create a
third dialect.

**F7. `--font-cio` is not bound to Geist.** `packages/ui/src/index.css:129` has the Geist stack
commented out; `:130` falls through to `var(--font-sans)`. Geist is self-hosted at
`apps/dashboard/src/app.css:12-42` but nothing connects the two. Verify in a browser before assuming
any type baseline.

## Defect register

| # | Defect | Evidence | Severity |
|---|---|---|---|
| D1 | Loaders turn failure into emptiness (F5) | 13 of 15 loaders; `marks/+page.server.ts:17`, `analytics/+page.server.ts:24` | Critical |
| D2 | Unprefixed token utilities render unstyled (F1) | 40 sites, 22 files; `exam-answer-summary.svelte:50,73,79,81` | Critical |
| D3 | Grading is unreachable from the Exercise surface. `MarkExerciseModal` mounts only at `pages/submissions.svelte:208`; the exercise's own Submissions tab has zero buttons or links | `individual.svelte` — one `onclick` at `:220`, for attempt selection | High |
| D4 | Marking has no undo and no rollback; total is server-owned | `attempts/[attemptId]/+page.svelte:73`, total recomputed `:92` | High |
| D5 | "Suggest with AI" is offered while AI is off — two clicks and a round-trip to a permanently disabled dialog quoting costs for a model it cannot name | `apps/api/src/services/exam-import/exam-import.ts:244` populates `aiSuggestionQuestionIds` ungated; production flags are `false` with empty model pins | High (crosses the API boundary) |
| D6 | A shipped dead feature: "Grade with AI" button is `hidden!` over a fully commented-out handler plus ~70 commented lines | `mark-exercise-modal.svelte:425`, `:236-250`, `:167-234` | High |
| D7 | The course shell has no failure exit — a course that fails to load spins forever, and the loading copy is untranslated English | `courses/[id]/+layout.svelte:241-258`, strings at `:244-245` | High |
| D8 | The unsaved-changes guard — the most safety-critical interaction in an authoring tool — is a native `window.confirm()` | `lib/features/ui/unsaved-changes.svelte:25` | High |
| D9 | Loading states exist but are not wired: `isLoading` is hardcoded `false` through the submissions branch, so `summary.svelte:69` and `individual.svelte:214` spinners are unreachable; `grading-loader.svelte` has no importer | `submissions.svelte:99,103` | Medium |
| D10 | Creating an exam does a full page reload and lands on the list, not the exam just created | `exams/new/+page.svelte:88` (`window.location.href`) | Medium |
| D11 | Cancelling an import orphans the row: no re-open, no retry of the same file | `exam-import-review.svelte:196`, canceled branch `:319` | Medium |
| D12 | A PDF whose stylesheet failed is delivered unstyled with no warning; the failure is server-console only | `print/pdf/+server.ts:90` | Medium |
| D13 | Two competing entry points render the same exam list in two different page shells | `exams/+page.svelte:9-13` (self-documented legacy), `submissions/+page.svelte:3-4` | Medium |
| D14 | Save failures surface as a keyless toast — `snackbar.error()` with no message | `pages/settings.svelte:296,314` | Medium |
| D15 | `analytics/+page.svelte:28` uses `max-auto`, which is not a Tailwind class — the page is not centred | — | Low (one word) |
| D16 | Public-course authoring silently filters the question-type list to auto-gradable only, with no explanation | `edit-mode.svelte:102-104` | Low |
| D17 | Import polling ceiling hard-coded at ten minutes; exceeding it offers a retry that restarts the whole poll | `exam-import.svelte.ts:36-37` | Low |
| D18 | ~900 lines of verified dead code inflate every estimate: stale `components/people/` fork (6 files), `components/list.svelte` (holds all 4 TODOs), `list-loader.svelte`, `course-content-sidebar-navigation.svelte` (99), `utils/submissions-utils.ts`, `ceritficate/reports.svelte` + `mockData.ts` (ships fake numbers), unreachable `analytics-skeleton.svelte` | each verified by grepping the import specifier and exported symbol | Medium (blocks estimation) |
| D19 | `lib/features/course/components/ceritficate/` is misspelled — 22 files, referenced by path from 6+ sites | `certificates/editor/+page.svelte:7` | Low (do alone, own commit) |
| D20 | Three exercise files exceed 1000 LOC and hold 47% of a 10.3k-LOC surface: `assessment-item-composer.svelte` 1897, `view-mode.svelte` 1843, `edit-mode.svelte` 1097 | — | Medium (blocks safe restyling) |

| D21 | The one correct error state in the codebase printed raw key paths: `audience.user_analytics.load_failed_title`, `load_failed_description` and `retry` existed in **none of the ten translation files, including `en`**, so the documented `en` fallback missed too. Found while copying that pattern for marks. | `people/[personId]/+page.svelte:25-34` | High — fixed |

## Progress

| Item | State |
|---|---|
| D15 `max-auto` | **done** — commit `385992240` |
| D18 dead code | **done** — 12 files, 1,104 lines, each verified by grepping the import specifier and the exported symbol; commit `385992240` |
| D21 missing i18n | **done** — strings added in `en` and `vi`; commit `f6d6794e5` |
| D1 loaders | **marks done** as the exemplar (loader returns `loadFailed`, page renders a distinct error with retry); commit `f6d6794e5`. Twelve loaders remain, same recipe. |
| Design artefacts | **done** — `motion-vocabulary.md`, `design-direction.md`, `frozen-files.txt` |
| F2 type tokens | **done** — scale installed with leading and tracking paired; commit `b32c25b4e` |
| F3 motion tokens | **done** — four easings, five durations; the twelve hand-written cubic-beziers now spend them; commits `b32c25b4e`, `18751110f` |
| F4 reduced motion | **done** — global guard shipped; the JS helper for Svelte transitions remains |
| F1 prefix / D2 | **done** — 31 usages across 12 files were emitting no CSS; three carried variants and needed the prefix outermost. Proven against the built stylesheet: unprefixed forms appear zero times against 2,510 prefixed classes. A `dashboard-token-prefix` pre-commit guard now blocks recurrence, verified in both directions. It matches token names only rather than reusing `add-ui-prefix.cjs`, which prefixes every Tailwind class — plain utilities work unprefixed in the dashboard and must stay that way. |
| D1 analytics | **done** — second loader converted; same defect as the gradebook |
| D1 remainder | **surveyed, then done where it was real.** The register said "13 of 15 loaders". Counting them: four throw `error()`, which is a legitimate failure surface, and four carry no fetched data at all. Three genuinely swallowed failure, and all three are now converted: `exams/new` (told a teacher the course had no container and offered to create one), `exercises/[exerciseId]` (**the worst case in the family** — a null exercise reached the authoring screen as an *empty* one, and saving would have written it over the real exercise), and `submissions` (one of its three tabs already distinguished failure; the other two did not). Two `console.log` calls firing on every request of the exercise route were removed with it. |
| E1 workspace | **done** — Phase 1; the composer authors inside the outline-and-editor pane, the parked panel is live, the in-place fallback is gone |
| D8 unsaved guard | **done** — `window.confirm` replaced by a focus-trapped dialog. `beforeNavigate` cancels and `goto` resumes after confirming; closing the dialog by Escape or overlay means *stay*, because dismissal must never be the destructive branch. Tab close keeps the browser's own prompt, which cannot be replaced. |
| D7 course shell | **done** — `ensureCourse` resolves `null` on failure and leaves the store empty, which the shell could not tell from "still loading", so it spun forever. The shell now records the failure and offers a retry, and the two English loading strings are translated. |
| D10 exam create | **done** — `goto` to the exam just created, instead of a full reload onto the list that also discarded the course store |
| D14 save failures | **corrected, then done** — the register said "keyless toast". It is not: `snackbar/store.ts:34` defaults to `snackbar.something`, which exists in both `en` and `vi`. The real defect is weaker — the message is generic. Both sites now name what failed. |
| D16 public-course filter | **done** — the shorter type list now says why it is shorter |
| Motion rows 1, 2, 4 | **done** — see `animation-opportunities.md`. Row 2 (press feedback) needed an owner-granted exception to the freeze, because the shared `Button` is used seven times on the student sitting page and by six more frozen modules; it is the only visual change to that screen in this programme. |
| F7 font | **resolved — do not bind.** The plan offered "bind `--font-cio` to Geist, or delete the dead declaration", assuming the choice was taste. It is not. Geist is self-hosted with three subsets; Vietnamese precomposed characters live at U+1EA0-1EF9 and **82 of those 90 codepoints fall outside every declared `unicode-range`**. Binding would render Ạ ả ấ ầ ậ ắ ằ ặ and the rest in a fallback face — a typeface change mid-word, in a Vietnamese-first product. The commented-out stack is gone and the measurement is recorded at `index.css:129` so no future session re-enables it. Binding needs a Geist build with a Vietnamese subset, which is a font problem, not a CSS one. |
| D13 two exam entry points | **corrected, then done.** The register said "two different page shells". They are not: both use `Page.Root` with the identical class `mx-auto flex w-full md:w-[calc(95vw-var(--sidebar-width))]!`. The real divergence was permission — `submissions` wraps in `RoleBasedSecurity allowedRoles={[1, 2]}`, `exams` wrapped in nothing. The API's `courseTeamMemberMiddleware` kept the data safe, so this was never a leak, but a learner following an old bookmark met a 404 instead of an answer about permission. Now guarded the same way. |
| D19 misspelled directory | **done** — 18 files moved with `git mv`, five import lines across three files updated, no internal self-references. Build passes. |
| D11 cancelled import | **narrowed, then done.** The register asked for "re-open, retry of the same file". Neither is buildable at the UI: the import API exposes only `uploadAndCreate` and `cancel`, there is no re-run endpoint, and the file only ever existed in the browser that uploaded it. What *was* wrong is that `cancelImport()` fired on one unguarded click, destroying a parse that can run to ten minutes with no undo and no exit but finding the document again. It now asks first, and says that in the question. A true retry needs the API to keep the source document — backend work, not a refactor. |
| D4 marking undo | **partly done — the buildable half.** Reverting a mark that was already *saved* needs the API to keep a history of marks, and it does not: `answerLog` records what the sitter changed, not what the marker did. That is backend work. What was buildable and is now done: typing over a mark was one-way, so a marker who overwrote 8 with 3 had nothing on screen to put 8 back. A revert control appears while an unsaved edit exists. Building it surfaced a second defect in the same handler — `saveMark` never cleared `edited`, so a naive revert would have restored the value the server held *at page load*, not the one just written. A `committed` overlay now carries what this page has actually saved, so `marks` reads manualScores ← committed ← edited and the revert target is true in both cases. |
| UI library | **settled — `ui-library-decision.md`.** Keep bits-ui, add nothing. The number that settles it: **zero files outside `packages/ui` import `bits-ui` directly**, so the dependency is fully encapsulated and there is no leakage pressure forcing a swap. 28 of 48 `base/` components wrap it; the other 20 are presentational and need no behaviour library. Adding a second component library would reintroduce the unprefixed-class failure this programme already fixed in 31 places, because `index.css` compiles with `prefix(ui)` and unprefixed token classes emit no CSS. One real finding came out of it: `tippy.js` was declared with **zero import sites**, left behind by the TipTap v2 → v3 move, and is now removed along with its `@popperjs/core` transitive. |
| D20 file size | **started — first seam taken.** `view-mode.svelte` 1843 → 1766 lines; twelve helpers and the `TakeItem` union now live in `take-progress.ts` (155 lines) with `take-progress.test.ts` (11 tests). Chosen because it is the safest possible split: every function moved was already a pure function of its arguments, so the move is behaviour-preserving by construction. The two progress helpers were the exception — they read `$questionnaireMetaData` directly — and take the answers as an argument now, which is why the module needs no browser. `view-mode.svelte` keeps two thin wrappers so the ~30 call sites did not change shape, and the store access sits in one place. Two mistakes were made and caught by the typechecker: the alias `exerciseQuestionProgress` collided with an existing `$derived` of that name, and `CanonicalQuestion` had to be re-exported because the union that owned it moved. `svelte-check` back to 344 after both. |
| D20 seam 2 | **done — the composer's validation focus.** `getValidationFocusId` decided where the cursor lands when a teacher saves an item that will not validate, and had **no test on any branch**. Landing on the wrong control is worse than landing nowhere, because it says the problem is somewhere it is not. Now `assessment-validation-focus.ts` (103 lines) with **15 tests** covering every branch including both deliberate fallbacks. `assessment-item-composer.svelte` 1897 → 1860, and `svelte-check` held at 344 on the first try. |
| D20 seam 3 | **done — what a question-type change destroys.** Changing a question's type is lossy on purpose: a type that takes no options discards them, true/false and thumbs replace whatever was there. Those rules lived inside a `questionnaire.update` callback with nothing asserting them, so "discarded on purpose" and "lost by accident" were indistinguishable. Now `question-type-transition.ts` with **10 tests** stating each rule, including the one that protects a teacher — options already typed are *kept* when moving between two option-taking types. `edit-mode.svelte` 1089 → 1043. One mistake worth recording: the first draft declared its own `QuestionOption` interface instead of deriving from `Question['options']`, and the typechecker rejected the result at the store boundary. A parallel type definition is a drift waiting to happen; the module now derives both types from the question's own. |
| D12 unstyled PDF | **corrected, then done.** The register said a PDF whose stylesheet failed is "delivered unstyled with no warning". It is not: total failure already throws 502. The real gap was *partial* failure — three of four sheets unreadable still passes `every()`, so a partly styled answer sheet ships in silence. That is the more dangerous of the two, because nobody notices until a candidate is holding it. Both paths now name which hrefs were lost, and partial loss warns. |
| D9 loading states | **done, as the withdrawal predicted.** The animation sweep first read this as "loading states exist but were never wired" and the row was withdrawn after checking: `Summary` and `Individual` fetch nothing, so `isLoading={false}` was *correct* and the spinners were vestigial from when those components loaded their own data. The honest fix was deletion, not wiring, and that is now done — the prop, both unreachable branches, and the orphan `grading-loader.svelte` (no importer anywhere) are gone. One latent trap went with it: `summary.svelte` defaulted `isLoading` to `$bindable(true)`, so any future caller that forgot the prop would have got a permanent spinner. |
| D20 seam 4 | **done — when a block may move.** `canMoveBlock` decides whether the up/down arrow beside a block is enabled, and its three branches disagree about what "next" means: flat layout moves within one list, a passage moves among passages, and a question moves **only within its own passage** — it cannot reach another passage however many times the arrow is pressed. None of that was tested and none of it was written down. Now `assessment-block-movement.ts` with **11 tests**, including the unassigned-questions case where the group count and the passage count differ. `assessment-item-composer.svelte` 1860 → 1840. |
| D20 seam 5 | **done — where a learner goes after a section.** `evaluateSectionAfterBehavior` mixed the decision with the acts that carry it out, so its rules could only be checked by sitting an exercise. Two were undocumented and both matter: `go_to_section` naming a section that no longer exists **falls through to the next one** rather than trapping the learner, and running off the end of the list **submits** — there is no finished-but-unsubmitted state. Now `section-after-behavior.ts` with **8 tests**; the store update, draft save and submit stay in the component. `view-mode.svelte` 1761 → 1749. |
| F6 `Page.Root` | not started — still needs its own approval, it reaches `org/` and `lms/` |

Three register entries have now been corrected by reading the code before acting on them — D14
("keyless toast": the key exists), D1 ("13 of 15 loaders": three), D13 ("two page shells": one shell,
two permission rules). The register was written from a survey, and a survey is a hypothesis. Read the
site before fixing it.

A regression was introduced and caught during F3: naming the easings `--ui-ease-*` shadowed
Tailwind's own prefixed `--ui-ease-out`, silently repointing all 41 existing `ease-out` usages at a
different curve. Reading the built stylesheet found it before it shipped; the tokens are now
`--ui-motion-ease-*`. Every token claim in this plan was verified against emitted CSS rather than
assumed from the Tailwind v4 documentation.

After each tranche: `svelte-check` held at 344 errors with no missing-module errors, and the
frozen-file check returned empty.

## Relationship to existing plans

| Plan | Decision |
|---|---|
| `2026-07-30-assessment-workspace-redesign` — 5 phases, all pending; epic map E1–E5 approved; evidence base intact under `history/assessment-workspace-redesign/` | **Inherit as the spine.** E1–E5 become this programme's workspace phases unchanged. |
| `20260716-native-assessment-interactions` — phases 1–3 completed, 4–7 pending | **Defer 4–7.** They add new QTI families (inline, match, associate, slider, graphic, hotspot, drag). Adding families while existing kinds are unfinished contradicts production-readiness. |
| `260725-2240-exam-import-from-documents` — status in-progress, P0 | **Must close.** Remaining work folds into the import phase. |

## Scope correction — where the import feature actually lives

`routes/(app)/courses/[id]/exam-imports/[importId]/` is a seven-line shell. The feature is ~2000
lines under `features/course/`: `pages/exam-import-review.svelte` (642),
`components/exercise/exam-import-question-card.svelte` (539), `exam-import-draft-settings.svelte` (151),
`api/exam-import.svelte.ts` (481), `utils/exam-import-utils.ts` (190).

That screen serves **both** exam and exercise imports, diverging at only two points — navigation
(`:147`) and publish target (`:178`). Decision: parameterise, do not split; put the exercise path in
the acceptance checks.

## Phases

**Phase 0a — Truth.** No visual change at all, so it can ship immediately and independently.
Fix F5/D1 so every loader distinguishes failure from emptiness, following the `loadFailed` pattern
that already exists at `people/[personId]/+layout.server.ts:31,37`. Delete D18's ~900 lines of dead
code. Fix D15 (`max-auto`). Exit: no loader renders "no data" for a failed fetch; the dead-code
inventory is gone so later estimates are honest.

**Phase 0b — Tokens.** Execute the prefix decision (fix the 40 unprefixed sites, add a lint rule so
the silent-failure mode cannot return). Add type, duration and easing tokens (F2, F3) and a global
`prefers-reduced-motion` guard (F4). Resolve F7 (bind `--font-cio` to Geist, or delete the dead
declaration). Exit: no token utility emits zero CSS; the motion and type vocabularies exist in
`@theme` and are referenced rather than hand-written.

**Phase 0c — `Page.Root` variant API (F6).** Separate because it reaches `org/` and `lms/` — 30
`Page.Root` usages outside Courses — which is beyond this goal's stated scope. **Needs its own
approval before it starts.**

**Phase 1 — Assessment workspace (inherits E1).** Extract the canonical composer from the legacy
list into a page-level two-pane workspace with an on-demand outline and preview as a mode.

**Third premise correction — the composer was never nested in the legacy list.**

Read the template before planning any more of this phase. `edit-mode.svelte` renders the composer in
a section that is a *sibling* of the legacy list, and the two guards are mutually exclusive: the
composer block requires `isAssessmentWorkspaceOpen`, the list requires `!isAssessmentWorkspaceOpen`.
So E1's stated exit criterion — "the composer is no longer nested in the legacy editor list" — was
already satisfied by accident, and "move the mount point" was work that did not exist.

What is actually there: **a two-pane workspace panel, already built, parked behind
`const USE_ASSESSMENT_WORKSPACE_PANEL = false`** (`edit-mode.svelte:132`). Roughly 190 lines of
outline aside plus editor pane that never render. That is a partial implementation of E1's own
target, not a fork in the road.

And the mechanism that explains why it was parked: opening a canonical item sets
`activeCanonicalQuestionId`, which makes `isAssessmentWorkspaceOpen` true, which used to fail the
panel's own `!isAssessmentWorkspaceOpen` guard. **Clicking a row in the outline destroyed the
outline.** The panel could never have worked for canonical items.

So Phase 1 is: put the composer *inside* the panel's editor pane, reach parity with what the legacy
list can do, then flip the flag. Same three words as before, a different edit, and now with a
mechanism behind it.

**Done so far**

- `6593aa157` — composer extracted into one `assessmentComposerPane` snippet, rendered inside the
  editor pane when the panel is on and standalone when it is off. The panel's guard no longer
  unmounts itself when the composer opens. `openAssessmentComposer` now switches to the editor pane,
  because below `xl` only one pane shows at a time and the composer would otherwise open off-screen.
- `347538fd2` — `ExerciseQuestion.SectionAfterBehavior` added under the pane's section editor. The
  legacy list renders it per section; without this the flip would silently remove a teacher's ability
  to say where a candidate goes after a section. Found by asking what the list can do that the pane
  cannot — repeat that question before the flip.

`svelte-check` stays at 344 errors with the flag both off **and** on, so the parked path carries no
new type errors.

- `4d3af49c6` — **the flip.** The flag and the in-place fallback are gone; the workspace is how
  exercises are authored. The flat list survives for one job only: reordering, which needs every
  section on screen at once and so cannot use a pane that shows one section at a time.
- `54912b107` — removed what the flat list could no longer reach now that it only ever renders while
  reordering: two `{:else}` branches rendering the identical snippet, a `hidden={reorderQuestions}`
  wrapper that was now always hidden, and `dragDisabled: !reorderQuestions` that was now always
  false.

`svelte-check` 344, the 17 exercise tests pass, the dashboard builds.

**Phase 1 exit — structural, met.** The composer lives in the editor pane, the outline survives
clicking a row, the fallback is gone. No restyling and no motion: that is Phase 2 onward.

**Not yet verified by eye.** Nobody has looked at the screen. Worth checking first: opening an
assessment item keeps the outline; the mobile outline/editor toggle lands on the editor when the
composer opens; section after-behaviour is reachable; reorder mode still drags across sections.

**Left alone deliberately:** with no sections at all, the reorder path renders full question editors
rather than compact rows, and has no `dndzone` — so reordering unsectioned questions does not work.
That predates this phase and belongs with the reorder work, not here.

---

*Superseded, kept because the reasoning below is still the reason the move was cheap:*

**Decision: incremental extraction — move the mount point, change nothing else.**

The evidence that makes this cheap, and that corrects the red team's stated fear ("moving the
composer can duplicate or lose atomic mutation registration"):

- The composer is mounted conditionally inside `edit-mode.svelte:135`, gated on
  `activeCanonicalQuestionId`. That is a render position, not an ownership boundary.
- Save and preview state already live outside it, in a registry keyed by `composerId` —
  `store.ts:83-89` (`assessmentComposerSaveHandlers.set/delete`) plus the preview-item pair at
  `:64-76`. Registration is **by id, not by tree position**.
- The composer does not own save at all: it takes `onSaveRequested` as a prop
  (`assessment-item-composer.svelte:88,128`) and calls it (`:848`).

So moving where it mounts does not change who registers. `edit-mode.svelte` only loses a
conditional block.

*Rejected — rewrite behind an adapter:* the 1897-line composer is where the risk actually lives;
rewriting it is expensive and is not what E1 asks for. *Rejected — a parallel new route:* it leaves
the nested mount in place, which fails E1's own exit criterion that the composer is no longer
nested in the legacy editor list. It defers the work rather than doing it.

**Correction to an earlier version of this plan:** it said to split the three oversized files as
part of the extraction. The evidence says otherwise — the composer moves as a unit, and
`view-mode.svelte` is not in E1's scope at all. Splitting is independent and later. Bundling them
would make the cheapest available change into the most expensive one.

Two gates this phase must add before it starts. **Both are now in place.**

1. **One handler per `composerId`** — done, `6dfd665b6`. During the transition both mount paths can
   exist, and `set(composerId, handler)` followed by the other path's `delete(composerId)` silently
   removes a *live* handler — a save that appears to work and persists nothing. `store.ts` now warns
   in dev when `set` overwrites a registered key, and each cleanup retracts only its own
   registration instead of deleting by id unconditionally.
2. **A default-props gate for `AssessmentItemRenderer`** — done, baseline recorded in
   `renderer-prop-defaults.md` with the command that diffs it. `frozen-files.txt` deliberately
   excludes the component because it is shared, yet Phase 1 is precisely the phase that adds props
   to it — so the frozen check stays green while a shifted default repaints the student screen. The
   recorded rule: a new prop with a new default is allowed, a changed existing default is not. A
   rendering test is stronger and should replace the snapshot once Phase 1 opens; this session
   demonstrated twice that a rule without a gate does not hold.

**Phase 2 — Finish the existing interaction kinds (inherits E2, E3).**

**The inherited definition is wrong, measured 2026-09-16.** E2 asks to "complete numeric, fill
blank, word bank, ordering and star rating". Counting references across the three layers —
schema, composer, shared renderer:

| kind | schema | composer | renderer |
|---|---|---|---|
| `choice` | yes | yes | yes |
| `true_false_group` | yes | yes | yes |
| `numeric` | yes | **yes** | **yes** |
| `fill_blank` | yes | **yes** | **yes** |
| `word_bank` | yes | no | no |
| `ordering` | yes | no | no |
| `star_rating` | yes | no | no |
| `file_upload` | yes | no | no |
| `video_recording` | yes | no | no |

So numeric and fill_blank are already done, and the real gap is two kinds wider than E2 says —
it includes `file_upload` and `video_recording`, which E2 never listed. Five kinds have a schema
and nothing else: a teacher cannot author them and a learner cannot see them.

**The dangerous half of that is fixed** (`2ed7cb44c`). The renderer's dispatch chain ended at
`true_false_group` with no `{:else}`, so any of those five rendered *nothing* — prompt, then empty
space, no way to answer, no sign anything was missing. Unreachable today because the composer
cannot create them, but Phase 2 is precisely the phase that would make it reachable. It now fails
visibly, which is E2's own success criterion ("unknown kinds fail explicitly at the registry
boundary") applied at the render boundary too.

This is the **second** change reaching the shared renderer that the student page uses. Unlike the
press-feedback exception, it alters only a state that is currently blank, so nothing a candidate
sees today changes. It is a new prop with a new default, which `renderer-prop-defaults.md` permits;
the baseline there is updated.

**Phase 3 — Exercise surface completion.** D3 (grading reachable from the exercise), D6 (decide the
dead AI feature — build or delete), D8 (replace `window.confirm` with the real dialog), D9 (wire the
loading states), D16.

**Phase 4 — Exam authoring surfaces.** One shell across list, create, detail tabs, settings,
attempts, grading. D4 (undo on marks), D10, D12, D13.

**Phase 5 — Import review (closes the P0 plan, inherits E5).** D5 (gate the AI affordance at the
API), D11, D17; exercise import path protected by tests.

**Phase 6 — Courses shell consistency.** Remaining course pages onto the shell; D7, D14, D19.

**Phase 7 — Passage, responsive, accessibility (inherits E4) and release proof.** The gate matrix
from the workbench gates document, then visual checks at four widths, deploy, and runtime
verification.

## Decision taken (not a question)

**F1 — adopt the `ui:` prefix.** The codebase has already decided this and the constraint settles
it: `packages/ui` is shared with the frozen student page, and `packages/ui/src/index.css:1` emits
2,505 prefixed classes. Giving the dashboard its own `@theme` would make both systems emit token
utilities, and the frozen page's appearance would then depend on which one wins — a direct breach of
constraint 1. So the prefix stays, the 40 unprefixed sites are fixed in Phase 0b, and a lint rule
enforces it thereafter. Overridable by the owner, but this is the default the evidence supports.

## Open questions — product calls for the owner

1. **Does AI ship in assessment at all while the gateway is off?** This is one decision that surfaces
   twice: D5 (the suggestion affordance is offered though unusable) and D6 (a `hidden!` "Grade with
   AI" button over a commented-out handler). Current state: both env flags `false`, both model pins
   empty, and the gateway circuit breaker has been `open` since 2026-09-09 with one consecutive
   failure and no successful probe since. The honest default — gate the suggestion at the API, delete
   the dead button — costs nothing and is reversible the day a model pin is set.
2. May the exercise import path change appearance alongside the exam path, or must it stay
   pixel-stable? Decides whether the shared review screen is restyled once or gated by target.
3. Is the exercise Submissions tab meant to be read-only (D3 by design), or is the missing grading
   entry a regression?
4. Does publish belong in the exercise composer header, or is the course-level publish flow
   authoritative? Carried over unanswered from the workbench gates document.
5. Is `certificates/editor` meant to stay full-screen outside the course shell, via its
   `+layout@(app).svelte` escape hatch?
6. Phase 0c touches `org/` and `lms/`, outside this goal's stated scope. Approve separately?
