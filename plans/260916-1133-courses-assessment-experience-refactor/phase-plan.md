# The Courses, Exam and Exercise phase — one document, sequenced

Ten documents in this folder each answer one question. None of them is *the phase*: a reader who
wants to know what happens next, in what order, and how anyone will know it is done, has to hold
all ten at once. This is that document. Everything below is grounded in a measurement taken in
this repository, and every number can be re-derived with the check beside it.

## The contract

**Outcome.** A teacher can author, import, publish, sit, mark and report on an assessment in
ClassroomHub without meeting a screen that lies about its state, a control that does nothing, or a
visual language borrowed from a different product. The student sitting screen reaches that state
by being left alone.

**Constraints.**

- The student sitting UI is frozen. Seventeen files in `frozen-files.txt`, plus
  `renderer-prop-defaults.md` for the renderer they share — which `frozen-files.txt` cannot
  protect, because that file is edited legitimately by teacher work. One exception has been
  granted in writing by the owner: press feedback on the shared `Button`.
- The fork's own features stay. The canonical assessment composer, file import and the canonical
  model are deliberate divergence from upstream, not drift. Nothing here re-syncs them away.
- Tokens only. Every size, colour, duration and easing comes from `packages/ui/src/index.css`.
  Two pre-commit guards enforce the parts that fail silently.
- Deploy is push-to-`main`, one `deploy`-labelled runner, `max-parallel: 1`, by the owner's
  choice for VPS memory. Nothing is verifiable by eye until the queue drains.

**Non-goals.**

- Re-syncing to upstream. Measured: `pages/exercise.svelte` differs from upstream by one line and
  its tabs are identical. There is nothing to re-sync.
- Apple's material language on working screens. Rejected with a reason in `design-direction.md`:
  translucency and layered blur are written for consumer surfaces floating over photography and
  cost legibility on a dense table of marks. Solid surfaces, real borders, no `backdrop-filter`.
- Collapsing the two list families. Measured below; both are legitimate today.
- Motion as decoration. The gate in `animation-opportunities.md` has rejected more candidates than
  it has accepted, on both runs, and that ratio is the point.

**Acceptance criteria.** A screen is finished when all seven of `design-direction.md`'s conditions
hold. Five are checkable by tool and are tracked below. Two — whether the primary action reads as
singular, and whether the four states *look* different rather than merely being different — need a
person looking at the screen.

## Where the programme actually stands

| Defect class | Start | Now | Note |
|---|---|---|---|
| Hardcoded palette colours | 123 | **6** | all six are the argued exclusions: the section colour picker, the certificate canvas, two inside a comment |
| Dialogs opening as wide as the window | 25 | **0** | `scripts/check-ui-content-width.mjs` |
| Dialog width classes that silently do nothing | 35 | **0** | same guard, extended to `w-*` after the first version missed the larger half |
| Features switched off by a hardcoded constant | 1 | **0** | the two-pane panel is deleted, not parked |
| Click-only handlers with no keyboard equivalent | ? | **0** | whole-tag scan; the first scan reported a false positive because it stopped reading at `onclick=` |
| Failure rendered as emptiness | 3 loaders | **0** | five swallowing `catch` blocks read individually; four correct, one fixed |
| Translation keys printing their own path | ? | **0** | |
| Links to routes that do not exist | ? | **0** | |
| Debug residue in production | 4 `$inspect`, 4 `console.log` | **0** | one log reported a real failure and became `console.error` |
| Screens with a document title | 2 of 21 | **13 of 21** | the mechanism existed, was tested, and no course route used it |
| Tests in `features` | 296 | **470** | |
| `svelte-check` | 344 | **343** | unchanged across 130 commits except where a fix removed one |

## The stages that remain

### Stage A — unblock the eye (no code)

Nothing below Stage B can be judged until production carries this work. The queue drains at about
5.5 minutes a build, serially, by design. **Acceptance:** `docker inspect` on the dashboard
container reports the current `main` SHA.

### Stage B — the two criteria a tool cannot check

Eight screens have been converted commit-by-commit and never looked at: the gradebook, the
analytics empty state, the lesson list and content tree, the section editor, the document viewer
in dark mode, the exercise settings tab, the grading modal, the certificate modal. Each is
revertable alone.

**Acceptance:** for each screen, the owner confirms the primary action is singular and that
loading, empty, error and success are visibly distinct — or names what is wrong, which converts it
into Stage C.

**This stage is the gate on any layout work.** Two hypotheses about the authoring screen have been
tested and neither held: it differs from upstream by one line, and the exam list uses the majority
list family rather than a hand-rolled one. Redesigning a layout with no evidence that the layout is
wrong is guessing, and this programme has already reverted one layout change made that way.

### Stage C — whatever Stage B finds

Bounded by the owner's own words, not by a sweep.

### Stage D — done, 2026-09-17

`interaction-kinds-spec.md` said a new kind should arrive as its own component. The word bank and
ordering panels went inline and took the composer from 1,840 to 2,175 lines. Both halves are now
undone: the rules to `assessment-kind-config.ts` with 17 tests, then the markup to
`assessment-word-bank-editor.svelte` and `assessment-ordering-editor.svelte`. **Composer: 1,914.**

The `{#if}` guard moved *with* the markup rather than being lifted into the caller. That is the
detail that made the move safe: the fields narrow on exactly the condition they narrowed on
before, so the extraction moves lines without re-deriving a single type. The first attempt did
lift the guard, and `svelte-check` immediately went from 343 to 354 — every `config.options` read
lost its narrowing at once. **Acceptance:** met on the tool side — 343 unchanged, 470 tests
passing, no frozen file touched. Still owed a look from the owner, like everything else in
Stage B.

### Stage E — the remaining interaction kinds, if wanted

`file_upload` and `video_recording` are **not** blocked on UI. `initVideoRecordingUpload`,
`completeVideoRecordingUpload` and `getVideoRecordingPlaybackUrl` exist and are routed at
`apps/api/src/routes/course/exercise.ts:560`, `:588` and `:607` — but each keys on a **legacy
`questionId`**, not a canonical interaction id. The missing piece is an id bridge on the API side,
with its own access-control surface. `star_rating` is not recommended: the scorer has exactly two
paths, automatic and `text`→manual, and a rating fits neither.

### Stage F — the eight screens still without a document title

Four have no loader at all. Two carry live content as their title. `people/[personId]` needs its
parent loader. `attempts/[attemptId]` is blocked on typing its endpoint's response: its loader
calls `safeServerApi` with no success type, so three reads are already errors, and narrowing the
shape by hand cost eleven more (343 → 354, reverted).

### Stage G — the decisions that are the owner's, not the code's

| Question | What it unblocks |
|---|---|
| May the exercise import path change appearance alongside the exam path? | whether the shared review screen is restyled once or gated by target |
| Does publish belong in the composer header, or is course-level publish authoritative? | composer header design |
| Is `certificates/editor` meant to stay full-screen outside the course shell? | Stage B for that screen |
| May `Page.Root`'s width variant reach `org/` and `lms/`? | one shell across the app; 30 usages outside this scope |
| Two list families — `Item` (13 files) and `ResourceListRow` (6) — collapse or keep? | 19 files across 6 features; neither is wrong today |

## The rule this programme earned

Sixteen claims in these documents did not survive being read. Five were produced by an instrument
written for this programme: a `grep -c` whose `|| echo 0` fired alongside it; a regex that missed
emitted CSS because Tailwind groups identical rules into one selector; a scan that stopped reading
at `onclick=` and so could not see the `onkeydown` after it; a hand-narrowed response type that
cost eleven errors; and a host-level process check that could not see a build running inside a
container, and nearly led to restarting a healthy runner mid-build.

**Read the site before fixing it.** A survey is a hypothesis. So is a grep. So, five times, was an
instrument written for the job.
