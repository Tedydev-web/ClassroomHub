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
| Screens with a document title | 2 of 21 | **21 of 21** | the mechanism existed, was tested, and no course route used it; a page-level `<title>` in `<svelte:head>` never reaches the server-rendered head |
| Tests in `features` | 296 | **482** | |
| `svelte-check` | 344 | **343** | **measured with fresh generated types.** The 343 quoted earlier was read against stale `.svelte-kit/types`; synced, the true count was 346 — three `never[]` errors in `assessment-delivery-definition.ts`, fixed |

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

### Stage B, partially unblocked without the owner — 2026-09-17

The claim that these screens could only be judged by a person turned out to be half wrong. There
is no X server here and no teacher session, so the live app stays out of reach — but **Storybook
renders the shared components with no authentication at all**, and `google-chrome --headless` is
on this machine. Built the static Storybook, served it, and screenshotted.

`word_bank` and `ordering` had **no stories**, which is why nobody had looked at either since
they shipped. Adding them took two minutes and found a real defect in the first frame.

**The defect.** A word bank blank was an outline `Button`, so it had the solid border and rounded
box of a text input — a candidate's first instinct is to click it and type. Worse, the bank chips
below it used the same outline. Two roles, one appearance, which is exactly what
`design-direction.md` rejects under Familiarity. Fixed: an empty blank is a dashed underline with
no box, a filled one is a solid pill, and a chip stays an outline button because pressing it is
what it is for. Verified by screenshotting both states.

**A second silent no-op found on the way.** `ui:min-w-24` on the blank was emitting nothing:
`packages/ui/src/output.css` is generated and the committed copy predated the renderer edit, so a
class only that file used had never been built. Rebuilding `@cio/ui` published it. Same family as
the dialog widths — a class that is written, looks right, and does nothing.

This route works for anything rendered by `packages/ui`. It does not reach the eight dashboard
screens in Stage B, which need a session.

### Stage B, the eight dashboard screens read statically — 2026-09-17

No teacher session exists here, so each screen was read against the acceptance criterion instead
of looked at: one primary action, and loading, empty, error and success distinct. Two read-only
audits reported; every finding was re-read at its line before acting. Half did not survive.

| Screen | Primary action | States | Outcome |
|---|---|---|---|
| Gradebook | none, read-only | empty and error-with-retry present; loading is the server load | clean |
| Analytics | retry only on failure | error, empty present | `isLoading = $derived(false)` makes the skeleton branch dead code, **not a defect**: the page reads server data, and SvelteKit holds navigation until it arrives. Left as found |
| Lesson list and tree | one default "Add content" | empty per content type, snackbar on save | clean |
| Section editor | outline "Add question" | form | **fixed** `3b8df8575`: the title field's accessible name was never passed, so screen readers heard "Section title" in English in every locale. The other five English fallbacks the audit flagged are all supplied by the caller and never render |
| Document viewer, dark | none at rest, retry on error | loading, error-with-retry | **fixed** `012352511`: spinner, error and retry link were fixed blue and red; now the primary and destructive tokens |
| Exercise settings tab | one "Save" | loading, empty, two error surfaces, success snackbar | clean |
| Grading modal | one "Submit grades" | loading via preview, saving on the button | three `dark:text-white` where a token would do; renders correctly, left as found |
| Certificate issue modal | one "Submit" | none | the audit called the button dead — true, it only resets the form — but **nothing opens this modal**: no code sets `issueCertificateModal.open`, and upstream ships the same stub. Unreachable, so not a user-facing defect. Recorded, not built |

What a static read cannot settle stays with the owner: whether each screen *looks* like one
primary action at a glance. No screen gave a reason to change its layout, so the gate on layout
work stays closed.

### Stage E — deferred by decision, 2026-09-17: `file_upload` and `video_recording`

Not built, and not blocked on UI. Decided under the owner's delegation with `kongming` counsel.
The upload endpoints exist (`apps/api/src/routes/course/exercise.ts`, the `video-recording`
routes) but `apps/api/src/services/exercise/video-recording.ts:159` throws unless the question's
`questionTypeId` is the **legacy** `VIDEO_RECORDING`, so a canonical question is refused, and
completion persists legacy `AnswerData`. Building it needs four things together: widening that
type check, persisting a canonical response, the access-control surface that comes with it, and
a rendering decision — canonical kinds draw through `AssessmentItemRenderer`, which the frozen
exam page uses, so enabling them changes what a candidate sees. That last point is why it is not
done under a mandate that forbids changing the sitting screen.

The current state is safe and deliberate: `SUPPORTED_ASSESSMENT_VERTICAL_SLICE_INTERACTION_KINDS`
(`assessment-vertical-slice.ts:17`) refuses the write, the composer does not offer the kinds, and
the renderer shows a visible "cannot be displayed" notice rather than a blank. `star_rating`
stays not recommended: the scorer has exactly two paths and a rating fits neither.

### Stage F — done, 2026-09-17: every course screen has a browser tab title

21 of 21. The last seven: news feed, landing page, AI tutor, certificate designer (two new
`+page.ts` loaders), new exam, import review, and the attempt page — which names the candidate,
as its heading does, read by a tested runtime guard (`features/exam/read-candidate-name.ts`)
rather than a cast.

**Two findings on the way.** First, the import review already set `<title>` in `<svelte:head>`,
and it never rendered: on production `/login` returns exactly one `<title>` and it is the
platform's, not the page's own. The root layout's meta tags are the only title in the server
head, so `pageMetaTags` is the one mechanism that works. Second, typing the attempt loader from
the RPC contract **does** resolve — a probe with a negative control proved the exam client infers
`attempt | corrections | paper` — but it surfaces four mismatches the page hid behind `unknown`
(`JSONValue` arriving for jsonb activity and answer-log columns, and a paper question shape two
helpers do not accept). Reverted, not cast. Recorded below as its own item.

### Stage G — decided, 2026-09-17

The owner delegated these: *"tất cả những vấn đề còn lại … miễn best practices approachs solution
là được"*. Each was decided with evidence and put to `kongming` before committing; its two
corrections are folded in.

| Question | Decision | Why |
|---|---|---|
| Exercise import appearance alongside exam import? | **One screen, restyled once, never gated by target.** | `pages/exam-import-review.svelte` already serves both; `target` changes only the redirect (`:157`) and the publish call (`:188`). Gating style by target would fork a screen over one behavioural difference. No restyle was pending, so nothing changed. |
| Publish in the composer header? | **No. Course-level visibility stays authoritative.** | *Corrected reason:* publish does exist per item — `PUT …/question/:questionId/assessment-item` calls `publishQuestionRevision` — but it commits a question **revision** with optimistic concurrency; it is not a visibility switch. There is no per-item visibility concept to put in a header. |
| `certificates/editor` full-screen outside the course shell? | **Keep.** | The route resets its layout on purpose (`+layout@(app).svelte`) and the header has a back link to the certificates page, so the exit is never lost. A canvas editor is a focus mode. |
| `Page.Root` width variant into `org/` and `lms/`? | **No.** | 36 usages outside this programme's scope, for no user-visible gain to Courses, Exam or Exercise. |
| Two list families? | **Keep both; they are one.** | *Corrected framing:* `ResourceListRow` wraps `Item.Root`. The usage rule now sits in the `resource-list-row.svelte` header: divider rows sharing one list surface take `ResourceListRow`, standalone or carded items take `Item`. |

### Closed

- **C5, "Câu hỏi 11" clipped to "u hỏi 11".** Reproducible only between `4d3af49c6` (2026-09-16
  13:03) and its revert `9ac1ff2c3` (15:38): the two-pane panel was behind a constant that was
  never `true` in any other commit, its grid was exactly the recorded 288+512px, and it is now
  deleted. A static sweep of the current authoring files finds no left-edge clipping mechanism.
  Reopen only if it appears again.
- **Dead `assessment-passage-rail.svelte`** — zero importers; deleted.
- **Composer split** — not triggered. The real boundary is the two inlined interaction editors
  (`choiceInteractionEditor`, `trueFalseGroupInteractionEditor`), which would match word bank and
  ordering. Take it when either is next edited, not for the line count.
- **Storybook review** — all 20 assessment stories reviewed, in both themes where it mattered.

### Open, as their own items

- **Exam loader typing.** 22 errors across the exam routes come from untyped `safeServerApi`. The
  contract infers; the pages it feeds need `JSONValue` handling and a paper-question shape fix
  first. Scope it as one change to the attempt page's contracts.
- **Owner feel checks** — the 24px question-step nudge, and a real drop with reduced motion on.
- **Stage B** — read statically (above); two defects fixed. A visual pass on production is still the owner's.

## The rule this programme earned

Sixteen claims in these documents did not survive being read. Five were produced by an instrument
written for this programme: a `grep -c` whose `|| echo 0` fired alongside it; a regex that missed
emitted CSS because Tailwind groups identical rules into one selector; a scan that stopped reading
at `onclick=` and so could not see the `onkeydown` after it; a hand-narrowed response type that
cost eleven errors; and a host-level process check that could not see a build running inside a
container, and nearly led to restarting a healthy runner mid-build.

**Read the site before fixing it.** A survey is a hypothesis. So is a grep. So, five times, was an
instrument written for the job.
