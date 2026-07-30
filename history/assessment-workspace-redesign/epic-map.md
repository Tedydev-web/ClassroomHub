# Epic map

## Approval basis

The user explicitly delegated the end-to-end redesign and requested an automatic TDD execution path. This map is the approved work shape for that request; it does not authorize unrelated WIP changes.

## E1 — Extract canonical authoring workspace

Deliver a page-level canonical workspace shell with two surfaces, on-demand item map, separate preview, explicit save state, and the existing three interactions.

Exit: Standard Flow unchanged; canonical composer is no longer nested in the legacy editor list; save/revision tests pass.

## E2 — Complete deterministic canonical interactions

Deliver authoring, delivery, validation/completeness, and scoring for numeric, fill blank, word bank, ordering, and star rating.

Exit: each kind has a creation action, author editor, learner renderer, answer projection, valid/invalid tests, and scoring test.

## E3 — Complete manual canonical interactions

Deliver authoring, delivery, response persistence, and manual-grade semantics for file upload, link, and video recording.

Exit: manual kinds never expose fake answer keys or auto scores; upload/recording failures are visible and recoverable.

## E4 — Passage/mobile/accessibility and extension boundary

Deliver responsive passage workbench behaviour and a registry contract that gives future inline/graphic/custom interactions an explicit extension point.

Exit: viewport/accessibility test matrix passes; missing implementation is visible, typed, and non-publishable rather than blank.

## E5 — Import workbench integration and release proof

Keep import review separate, route reviewed canonical items into the workspace, then run visual/end-to-end checks, reviews, commit, deploy, and runtime verification.

Exit: import does not bypass review; production deploy and exercised workflow are proven.
