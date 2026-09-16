# The five unbuilt interaction kinds — what is actually missing

Written so that answering "which ones do you want" is the only remaining decision. The shape of the
work is settled here; picking a kind starts construction.

## The gap is one module and two screens, not a feature from scratch

Measured across the seven schema modules. The schema declares **ten** kinds, of which
`assessment-vertical-slice.ts` supports five — the five in its
`SUPPORTED_ASSESSMENT_VERTICAL_SLICE_INTERACTION_KINDS` set at `:17`:

| kind | item-schema | item-validation | **vertical-slice** | delivery | capabilities | response-envelope | legacy-adapter |
|---|---|---|---|---|---|---|---|
| `choice` | yes | yes | **yes** | yes | yes | yes | yes |
| `text` | yes | yes | **yes** | yes | yes | yes | yes |
| `true_false_group` | yes | yes | **yes** | yes | yes | yes | yes |
| `numeric` | yes | yes | **yes** | yes | yes | yes | yes |
| `fill_blank` | yes | yes | **yes** | yes | yes | yes | yes |
| `word_bank` | yes | yes | **no** | yes | yes | yes | yes |
| `ordering` | yes | yes | **no** | yes | yes | yes | yes |
| `star_rating` | yes | yes | **no** | yes | yes | yes | yes |
| `file_upload` | yes | yes | **no** | yes | yes | yes | yes |
| `video_recording` | yes | yes | **no** | yes | yes | yes | yes |

So the model is nearly complete. Validation, scoring rules, the delivery shape, the response
envelope and the legacy adapter all already know these five kinds. **Only
`assessment-vertical-slice.ts` does not**, and that file answers two questions: *is this response
complete?* and *how far through is the learner?*

A first pass at this table showed all seven modules covering all eight kinds. That was a shell bug —
`grep -c` printing `0` while `|| echo 0` also fired, so every cell read as present. Corrected above.
It is the fourteenth claim this programme has had to withdraw after checking, and the fourth where
the faulty instrument was one I wrote myself.

## Therefore each kind is three pieces of work

**1. Completeness, progress and scoring** — `assessment-vertical-slice.ts`, 291 lines. Pure, no
browser, so it is written test-first and the tests are the spec. **Four edit sites, not two** — an
earlier draft of this document said "one branch in each of two functions" and was wrong:

| site | line | what it needs |
|---|---|---|
| `SUPPORTED_…_INTERACTION_KINDS` | `:17` | the kind added to the set |
| `isAssessmentVerticalSliceResponseComplete` | `:82-118` | a branch, ending in the `{:else} return false` |
| `getAssessmentVerticalSliceResponseProgress` | `:139-148` | a per-kind "empty response" case, like `text` and `true_false_group` already have |
| `scoreAssessmentVerticalSlice` | `:209-283` | a scoring branch, or it hits `throw new Error(...)` at `:283` |

The order matters. Adding a kind to the set **without** a scoring branch is strictly worse than
leaving it out: the clean, early "Unsupported assessment vertical slice interactions" error at
`:199` stops firing, and the kind instead throws from deep inside the scoring loop.

**Correction, measured after this document was first written:** for `word_bank` and `ordering` the
composer and the renderer were **not** absent. `packages/ui/src/custom/exercise-question/renderers/`
already held a full legacy tree for both — `edit`, `take`, `preview`, `review`, `submission` — plus
`word-bank-utils.ts`, and every `word_bank.*` and `ordering.*` translation key already existed in
both locales. What was missing was the canonical path: the vertical slice refused the kinds, the
canonical renderer had no branch, and the composer offered no way to add one. All three are now
built, reusing `word-bank-utils.ts` rather than reimplementing it. That is the third claim this
document has had to withdraw.

**2. The composer** — how a teacher authors it. `assessment-item-composer.svelte` is already 1840
lines and 1028 of those are template, so a new kind should arrive as its **own component** rendered
by the composer, not as more branches inside it. That is also the only way this does not make the
D20 problem worse.

**3. The renderer** — how a learner answers it, in
`packages/ui/src/custom/exercise-question/assessment-item-renderer.svelte`. This file is shared with
the **frozen student sitting page**, so the addition must be an `{:else if}` branch beside the
existing five and must not touch any default. `renderer-prop-defaults.md` is the gate: a new prop
with a new default is allowed, a changed default is not.

The renderer already fails visibly for an unbuilt kind rather than rendering nothing, so the three
pieces can land in any order without a half-built kind reaching a candidate as blank space.

## The trap whoever implements this will hit

`assessment-vertical-slice.ts` runs against a **delivery** definition, and delivery strips the
answer key. Writing a completeness rule against the authored config compiles against the wrong type
and, worse, would reach for a key that is deliberately absent from the copy a candidate receives.

Measured in `assessment-delivery-definition.ts:75-86`:

| kind | authored config | what delivery actually exposes |
|---|---|---|
| `word_bank` | `template`, `correctAnswers`, `distractors` | `template`, **`bankTokens`** — the answers and distractors merged and sorted, so the order leaks nothing |
| `ordering` | `options`, `correctOrder` | `options` only, re-sorted; **`correctOrder` is gone** |
| `numeric` | `correctValue` | stripped |

So a completeness rule for `word_bank` **cannot** compare against `correctAnswers.length` to learn
the blank count — that field does not exist at this layer. It can check that every filled value is a
token from `bankTokens`, and that a required interaction has at least one non-empty value. The count
check already exists where the key is available: `assessment-response-envelope.ts:232`.

For `ordering` the rule is the same shape as `choice`: no duplicate ids, every id must belong to
`config.options`, and a required interaction must cover every option — a partial order is not an
answer.

Both rules use only what delivery exposes, which is the test that the rule is written at the right
layer.

## What each kind costs, in rough order of cheapness

| kind | Completeness rule | Composer | Renderer | Note |
|---|---|---|---|---|
| `star_rating` | answered when a value exists | a max-stars number and a label | a star row | **not simplest** — the scorer has exactly two paths, auto and `text`→manual, and a rating fits neither. It needs `maxScore: 0` or a third grading mode |
| `word_bank` | answered when every blank has a word | a bank of words plus blanks in the prompt | drag or select into blanks | closest to `fill_blank`, which is done — read that first |
| `ordering` | answered when the order differs from none | a list of items | drag to reorder; `svelte-dnd-action` is already a dependency and already used for question reorder | |
| `file_upload` | answered when a file is attached | accepted types and size | upload control; `resolveCanonicalFileUploadMimeType` already exists in `@cio/question-types` | needs storage and an upload endpoint — confirm before starting |
| `video_recording` | answered when a recording exists | duration cap and retakes | recorder; `VIDEO_RECORDING_MIME_TYPES` and `TExerciseVideoRecordingUploadInit` already exist | heaviest; browser capture plus storage |

`ordering` is the one that needs nothing outside the app. `file_upload` and
`video_recording` both depend on storage that has to be confirmed before either is promised.

## Built, 2026-09-16

`word_bank` and `ordering` are done end to end: four model sites with 13 tests, two canonical
renderer branches, and two composer panels. `file_upload` and `video_recording` are **not** started,
for a reason that is not effort. `initVideoRecordingUpload`, `completeVideoRecordingUpload` and
`getVideoRecordingPlaybackUrl` exist and are routed at `apps/api/src/routes/course/exercise.ts:560`,
`:588` and `:607` — but every one of them is keyed on a **legacy `questionId`**, not on a canonical
interaction id. So the storage is real and the endpoints work; what is missing is an id bridge on the
API side. That is a server change with its own access-control surface, not a renderer branch, and it
should be decided as its own piece of work.

## Recommended if only some are wanted

`word_bank` and `ordering`. They are the two an English exam actually uses, the model work for both
is one branch each, and `ordering` gets its interaction from a library already in the tree.

`star_rating` is a survey control rather than an exam one, and the scorer has no place to put it. `file_upload` and `video_recording` are
larger than they look because of storage, and neither is an assessment interaction in the sense the
rest of this model uses — they collect an artefact rather than an answer.
