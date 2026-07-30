# Approach and feasibility matrix

## Mode

High-risk product + UI migration. This is not a CSS task: it changes the canonical authoring shell and expands a delivery/scoring vertical slice from three to eleven persisted kinds. The smallest believable path is capability epics, with each interaction family proven end-to-end before moving on.

## Recommended architecture

1. Move the canonical composer out of the legacy repeating edit list into a page-level workspace route/state. Legacy questions keep their current editor and Standard Flow.
2. Make a small, closed `AssessmentInteractionAuthoringDefinition` registry keyed by the existing discriminated union. Each entry declares its label, creation function, editor component, learner renderer, preview support, grading capability, and family. Missing registry entries are a typed authoring error, never a blank region.
3. Make the workspace shell own selection, item map drawer, viewport layout, Save, Preview, validation, and focus restoration. Interaction editors own only their fields.
4. Reuse existing legacy question renderers and their validated patterns where schemas are equivalent; adapt data at one canonical boundary rather than duplicating per-component form logic.
5. Extend response completeness, scoring, submission, and learner renderer in family-sized vertical slices. Composite scoring remains explicit: aggregate only deterministic auto interactions; show a manual-grading requirement where the contract cannot safely infer a score.

## Family slices

| Epic | Existing kinds | Proof before next epic |
|---|---|---|
| Workspace migration | existing 3 | canonical item opens outside legacy list; save/preview/revision semantics preserved |
| Deterministic entry | numeric, fill blank, word bank, ordering, star | author → delivery projection → response → completion → score |
| Manual response | file upload, link, video | author → delivery → upload/link/video persistence → manual grading |
| Passage and responsive UX | all kinds | 375/768/1280/1600 flows, keyboard and no third pane |
| Extension contract | future inline/graphic/custom | an unimplemented family renders an explicit availability state and has tests |

## Feasibility matrix

| Claim | Evidence | Result |
|---|---|---|
| Canonical model can represent all 11 kinds | `assessment-item-schema.ts` is a strict discriminated union of 11 kinds | Proven |
| Delivery projection preserves each kind without answer keys | `assessment-delivery-definition.ts` has a branch for every kind | Proven |
| Existing authoring UI can be reused as a pattern | legacy renderer folders exist for numeric, fill blank, word bank, ordering, file upload, link, star, and video recording | Proven for visual/form patterns; adapter compatibility needs tests |
| Canonical learner delivery works for all 11 | `assessment-item-renderer.svelte` branches only for 3 kinds; vertical slice explicitly rejects others | Not proven; required implementation |
| Moving composer safely preserves exercise lifecycle | composer already delegates explicit atomic save through `onSaveRequested`; page/store callers must be traced in first slice | Partially proven |
| Future TAO interaction categories fit | TAO documents common, inline, graphic, custom/PCI categories and composite items | Architecture direction proven; no claim that ClassroomHub implements QTI/PCI yet |

## Risks and hard decisions

- **Scope explosion:** no drag/drop canvas, QTI import/export, arbitrary PCI execution, or new schema families in this effort. The registry is the boundary that keeps future work additive.
- **Data loss:** preserve existing explicit save and revision reconciliation. Do not add autosave.
- **Duplicated UI:** reuse legacy editor patterns through intentionally small canonical adapters, only where field semantics match.
- **Performance:** mount only the active interaction editor; virtualize/map-filter only if many-question measurement shows need. Do not prematurely virtualize rich text editors.
- **Accessibility:** native buttons for pane/map controls; drawer must use existing accessible dialog primitive and restore trigger focus.
