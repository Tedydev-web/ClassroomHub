# The five unbuilt interaction kinds — what is actually missing

Written so that answering "which ones do you want" is the only remaining decision. The shape of the
work is settled here; picking a kind starts construction.

## The gap is one module and two screens, not a feature from scratch

Measured across the seven schema modules:

| kind | item-schema | item-validation | **vertical-slice** | delivery | capabilities | response-envelope | legacy-adapter |
|---|---|---|---|---|---|---|---|
| `choice` | yes | yes | **yes** | yes | yes | yes | yes |
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

**1. Completeness and progress** — `assessment-vertical-slice.ts`, 291 lines, dispatches on
`interaction.kind === '…' && entry.response.kind === '…'` at `:82-105`. Adding a kind is one branch
in each of two functions. Pure, no browser, so it is written test-first and the tests are the spec.

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

## What each kind costs, in rough order of cheapness

| kind | Completeness rule | Composer | Renderer | Note |
|---|---|---|---|---|
| `star_rating` | answered when a value exists | a max-stars number and a label | a star row | simplest; a reaction, not a graded answer |
| `word_bank` | answered when every blank has a word | a bank of words plus blanks in the prompt | drag or select into blanks | closest to `fill_blank`, which is done — read that first |
| `ordering` | answered when the order differs from none | a list of items | drag to reorder; `svelte-dnd-action` is already a dependency and already used for question reorder | |
| `file_upload` | answered when a file is attached | accepted types and size | upload control; `resolveCanonicalFileUploadMimeType` already exists in `@cio/question-types` | needs storage and an upload endpoint — confirm before starting |
| `video_recording` | answered when a recording exists | duration cap and retakes | recorder; `VIDEO_RECORDING_MIME_TYPES` and `TExerciseVideoRecordingUploadInit` already exist | heaviest; browser capture plus storage |

`star_rating` and `ordering` are the two that need nothing outside the app. `file_upload` and
`video_recording` both depend on storage that has to be confirmed before either is promised.

## Recommended if only some are wanted

`word_bank` and `ordering`. They are the two an English exam actually uses, the model work for both
is one branch each, and `ordering` gets its interaction from a library already in the tree.

`star_rating` is a survey control rather than an exam one. `file_upload` and `video_recording` are
larger than they look because of storage, and neither is an assessment interaction in the sense the
rest of this model uses — they collect an artefact rather than an answer.
