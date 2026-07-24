# Native Assessment Interactions Implementation Plan

## Plan Contract

This plan implements the approved PRD in vertical slices. Each slice follows red, green, refactor:

1. Add a focused test that proves the current behavior is missing or unsafe.
2. Run it and record the expected failure.
3. Implement the smallest production behavior that satisfies the contract.
4. Run focused tests, then shared-contract tests, type checks, builds, formatting, and applicable UI checks.
5. Review callers and public contracts before advancing.

The executable phase files live in `plans/20260716-native-assessment-interactions/`. This document is the product-facing roadmap and traceability index.

## Dependency Graph

```text
Phase 1: foundation hardening
  -> Phase 2: canonical model + revision compatibility
      -> Phase 3: native composite vertical slice
          -> Phase 4: common + inline interaction batches
              -> Phase 5: graphic interactions
                  -> Phase 6: QTI boundary + ecosystem integration
                      -> Phase 7: final hardening and rollout
```

Phases are sequential because each changes contracts used by the next. Independent interaction batches inside Phase 4 may be parallelized only after the registry, response envelope, and renderer contracts stabilize and file ownership is non-overlapping.

## Phase 1: Foundation Hardening

### Objective

Make the current submission and scoring path secure, atomic, typed, precision-safe, and testable before introducing composite definitions.

### Test-First Tickets

- **P1-T1 Submission ownership:** route/service tests prove a tutor in course A cannot read, update, grade, answer-update, or delete a submission owned by course B.
- **P1-T2 Atomic submission:** integration tests prove malformed, unknown, duplicate, or unauthorized answers leave no submission/answer rows.
- **P1-T2A Transaction freshness:** concurrency tests prove an author edit cannot make semantic validation use a stale pre-transaction question snapshot.
- **P1-T3 Codec validation:** table-driven tests cover malformed JSON, wrong discriminator, wrong field type, non-finite numbers, unknown option IDs, duplicate IDs, and size/cardinality limits for every codec.
- **P1-T4 Scoring invariants:** tests cover exact and partial scoring, duplicate matching pairs, extra graphical points, checkbox duplicates, invalid order permutations, clamping, and two-decimal precision.
- **P1-T5 Hybrid grading:** tests prove automatic questions are scored while manual questions remain awaiting review and totals include only validated scores.
- **P1-T6 Manual grading authority:** tests prove question ownership, answer ownership, per-question maxima, duplicate grade rows, derived total, and workflow transition validation.
- **P1-T7 Database constraints:** migration tests or database probes verify unique submission/question answers and precision-preserving score columns.
- **P1-T8 Retry idempotency:** the same submission intent cannot create two attempts when a request is retried, including exercises allowing multiple attempts.
- **P1-T9 Asset retention integrity:** managed media answer and asset-usage records commit together or the submission fails.

### Main Touchpoints

- `packages/question-types/src/answer-codecs.ts`
- `packages/question-types/src/question-scoring.ts`
- `packages/question-types/tests/`
- `packages/utils/src/validation/submission/`
- `packages/db/src/schema.ts`
- `packages/db/src/queries/submission/`
- `apps/api/src/services/submission/`
- `apps/api/src/routes/course/submission.ts`
- focused API/service integration tests

### Exit Gate

- Core submission writes are one transaction.
- Semantic validation uses authoritative state resolved and locked inside that transaction.
- Mutation helpers require course scope.
- Invalid input is a 4xx domain error, not a 500 or silent skip.
- Fractional points round-trip without integer loss.
- No `any` remains in touched contracts.

## Phase 2: Canonical Model And Compatibility

### Objective

Introduce the minimum versioned item/interaction kernel, immutable revisions, response envelope, and legacy adapter without changing existing simple-question behavior.

### Test-First Tickets

- **P2-T1 Definition validation:** valid/invalid fixtures for schema version, block IDs/order, interaction IDs, response cardinality, scoring bounds, feedback policy, and unknown kinds.
- **P2-T2 Legacy adapter:** golden tests map each enabled current type to an equivalent one-interaction item without changing labels, option IDs, settings, or grading capability.
- **P2-T3 Revision persistence:** transaction tests enforce monotonic revisions, exactly one current revision, immutability, and answer-to-revision linkage.
- **P2-T3A Revision concurrency:** expected-revision and content-hash tests reject lost updates and avoid no-op revision growth.
- **P2-T4 Compatibility reads:** existing questions/submissions without revisions render and score through the legacy path.
- **P2-T5 Capability derivation:** auto/manual/hybrid, media, partial-credit, and renderer requirements derive from contained interactions when a definition exists.
- **P2-T6 Response envelope:** duplicate/unknown/missing/malformed interaction responses fail deterministically.
- **P2-T7 Historical deletion:** removing an attempted question archives it while historical answers/revisions remain reviewable; only unattempted drafts may be hard-deleted.
- **P2-T8 Registry identity:** migration tests prove the internal type identity matches the append-only registry and cannot be claimed by an unrelated existing row.

### Main Touchpoints

- new focused modules under `packages/question-types/src/assessment/`
- `packages/db/src/schema.ts` and generated migration artifacts
- new pure queries under `packages/db/src/queries/assessment/`
- existing exercise/question create and update services
- existing submission service
- renderer contract types shared by dashboard and UI

### Exit Gate

- Existing question types pass unchanged compatibility tests.
- Canonical definitions cannot bypass validation.
- Historical attempted revision remains stable after later edits.
- No raw QTI concept leaks into current route or UI contracts.

## Phase 3: Native Composer Vertical Slice

### Objective

Prove the complete native architecture with one advanced question containing rich content plus at least two interactions, while simple authoring remains unchanged.

### Initial Slice

Use content + single/multiple choice + extended text because these reuse mature Classroom Hub renderers and exercise automatic, manual, and hybrid grading in one item. Do not start with graphical interactions.

### Test-First Tickets

- **P3-T1 Composer state:** block add/select/reorder/remove operations preserve stable IDs and valid bound state without `$effect` synchronization loops.
- **P3-T2 Author validation:** duplicate IDs, empty required choices, impossible correct responses, invalid point allocations, and invalid feedback settings block publish.
- **P3-T3 Renderer parity:** preview and take produce the same prompts/options/constraints and typed responses.
- **P3-T4 End-to-end lifecycle:** author, save revision, preview, submit, hybrid grade, edit question, and review original revision.
- **P3-T5 Accessibility:** keyboard order, labels, validation focus, screen-reader names, and non-color correctness signals.
- **P3-T6 Compatibility:** simple question snapshots and behavior remain unchanged.

### Main Touchpoints

- current dashboard exercise editor and store
- `packages/ui/src/custom/exercise-question/`
- existing editor/media components
- translations and Storybook only where reusable UI contracts change
- current exercise take/review/submission views

### Exit Gate

- The advanced path is visibly and structurally part of the existing question card.
- One canonical renderer registry serves preview, take, and review.
- The composite item works through current exercise/submission routes.

## Phase 4: Common And Inline Interactions

### Objective

Expand the canonical registry in small semantic batches, reusing and normalizing current renderers before adding missing types.

### Batch Order

1. Normalize existing Order, Text Entry variants, Gap Match/Word Bank, Upload, and Extended Text.
2. Replace disabled Matching prototype with production Match and add Associate.
3. Add Hottext and Slider.
4. Add Inline Choice and canonical inline Text Entry.
5. Add End Attempt only after its behavior is reconciled with exercise required-response and attempt policies.

### Required Test Matrix Per Interaction

- strict definition fixtures
- authoring state and publish validation
- response codec round trip and hostile payloads
- scoring exact/partial/manual behavior
- preview/take/review renderer parity
- keyboard/touch/screen-reader behavior
- clone/template/AI capability behavior
- legacy compatibility where an existing type maps to it

### Exit Gate

Each enabled interaction has a complete definition, codec, renderer modes, scoring/manual policy, accessibility contract, translations, fixtures, and integration test. No interaction is enabled with a JSON textarea or placeholder authoring UI.

## Phase 5: Graphic Interactions

### Objective

Ship Hotspot, Select Point, Graphic Order, Graphic Associate, and Graphic Gap with a shared image-coordinate model and accessible alternatives.

### Test-First Tickets

- Normalize coordinates independently of display size, device pixel ratio, zoom, and responsive image dimensions.
- Enforce declared shape, target, cardinality, uniqueness, and bounds.
- Verify touch, keyboard alternative, authored textual equivalent, focus, and error behavior.
- Verify deterministic image asset revisions and reject replaced/deleted/foreign assets.
- Verify extra points/associations cannot earn full credit and one response cannot satisfy multiple targets unless explicitly allowed.
- Test mobile and desktop visual framing with browser automation.

### Exit Gate

Graphical interactions are usable without precision-dependent pointer behavior, have a non-visual completion path, and score against immutable image/target definitions.

## Phase 6: QTI Boundary And Ecosystem Integration

### Objective

Add declared-profile QTI import/export and make all existing Classroom Hub ecosystem paths definition-aware.

### Test-First Tickets

- Import parser security: traversal, entity expansion, archive bombs, invalid XML, unknown namespaces, unsupported schema versions, and media limits.
- Mapping fixtures for every supported interaction and scoring subset.
- Deterministic export snapshots and import/export semantic round trips.
- Explicit compatibility reports for unsupported and lossy constructs.
- Public course, AI authoring, templates, course import, clone/copy, analytics, webhooks, compliance, and selective assignment behavior for canonical items.
- Ensure AI output is validated by the same canonical schemas and cannot emit arbitrary executable behavior.

### Exit Gate

- Supported profile is documented and backed by fixtures.
- Unsupported semantics never disappear silently.
- Existing ecosystem integrations either support canonical items or reject them explicitly with a product-safe error.

## Phase 7: Final Hardening And Rollout

### Objective

Prove production readiness across correctness, security, accessibility, performance, migration, operability, and compatibility.

### Gates

- Full affected-package unit/integration/E2E suites.
- Browser coverage for author, student, and reviewer journeys at desktop/mobile viewports.
- Accessibility audit plus manual keyboard/screen-reader scenarios.
- Security review of authorization, rich content, uploads, XML/archive parsing, answer-key leakage, and scoring abuse.
- Concurrent edit/submit/revision tests.
- Query-plan and load tests for large exercises, submissions, grading boards, and import packages.
- Migration rehearsal on a production-shaped database copy with forward verification and rollback/feature-disable rehearsal.
- Observability for validation failures, unsupported definitions, scoring failures, import compatibility, and revision conflicts without logging answer keys or private responses.
- Final code review against repository patterns and the native integration invariants.

### Exit Gate

All acceptance criteria pass, no unexplained regression remains, documentation matches runtime behavior, and rollout can be disabled without making existing attempts unreadable.

## Cross-Phase Quality Gates

Run the narrowest affected commands first and broaden as contracts expand:

```bash
pnpm --filter @cio/question-types test -- --run
pnpm --filter @cio/question-types build
pnpm --filter @cio/db build
pnpm --filter @cio/api test -- --run
pnpm --filter @cio/api build
pnpm --filter @cio/ui prefix:check
pnpm --filter @cio/dashboard test
pnpm --filter @cio/dashboard build
pnpm --filter @cio/dashboard lint
pnpm format:changed
pnpm format:check
```

Commands must be reconciled with actual package scripts before execution. Existing unrelated baseline failures are recorded separately; no new failure may be hidden by broad ignores or weakened assertions.

## Rollback Policy

- Application rollback may disable creation/editing of new canonical items but must retain delivery and review of already persisted revisions.
- Database migrations are additive until rollout is proven. Destructive removal is a separate approved change.
- Failed imports create no item/revision/media records.
- Failed submissions create no submission/answer/revision-link records.
- A phase does not advance while its compatibility or data-integrity gate is unresolved.

## Unresolved Questions

None blocking execution. Interaction-specific decisions are phase gates and must be settled before their implementation batch begins.
