# Assessment workspace redesign — locked context

## Goal

Give teachers one calm, full-width authoring workspace that makes it obvious how to build and review every assessment item, while preserving learner response, timer, navigation, submission, scoring, and legacy Standard Flow behaviour.

## Locked decisions

- The canonical Assessment Item authoring experience is the redesign target. Legacy Standard Flow remains visually and behaviourally unchanged.
- Desktop authoring has exactly two persistent work surfaces. The item map, settings, validation, and preview are invoked on demand; none may become a permanent third pane.
- A passage item uses a left stimulus/context pane and a right active-interaction editor. A non-passage item uses the same shell with the contextual pane replaced by the item canvas/outline.
- Mobile exposes one surface at a time with an explicit switcher; navigation and properties use a modal sheet or drawer.
- Save remains explicit and revision-aware. Preview is a mode, not a parallel editing pane. Publishing remains owned by the existing exercise lifecycle until that ownership is traced and tested.
- Existing interaction schemas are the compatibility baseline: choice, text, numeric, fill blank, word bank, ordering, true/false group, file upload, link, star rating, and video recording.
- TAO is an architectural reference, not a UI to copy: interaction families must be extensible to common, inline, graphic, and custom/PCI interactions without forcing all forms into a generic prompt/options editor.
- Import review stays a separate AI-verification workbench; importing must not alter the authoring shell or bypass human review.

## Observed constraints

- The current canonical composer is mounted inside a legacy edit-mode question list.
- The authored schema supports eleven kinds, but the current composer and learner renderer contain branches only for choice, text, and true/false group.
- Existing uncommitted learner-navigation and devcontainer changes predate this work and must not be overwritten or folded into this feature without a separate decision.

## Acceptance evidence

- Every supported interaction has an intentional authoring surface, learner delivery behaviour, validation state, and preview path; unsupported future TAO/PCI kinds fail explicitly rather than silently rendering blank.
- At 375, 768, 1280, and 1600 px, authoring preserves readable editor widths, has no horizontal page scroll, and never presents three simultaneous panes.
- Passage, no-passage, no-question, long-content, many-question, loading, validation, autosave/save-error, and reduced-motion states are covered.
- Keyboard focus never changes passage/question context automatically; both scrollable panes are independently focusable.
