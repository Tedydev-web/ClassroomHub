# Assessment Interaction Research

## Research Method

This document separates four evidence classes so product scope is not inferred from a screenshot or a commercial TAO feature:

1. **Standard semantics:** official 1EdTech QTI specifications and conformance material.
2. **Documented product behavior:** official TAO user and developer guides.
3. **Community implementation evidence:** TAO CE/community extension repositories and fixtures, inspected read-only.
4. **Current product evidence:** ClassroomIO source, schema, tests, and runtime probes in this repository.

TAO source is used only to discover behavior and edge cases. Implementation is clean-room and based on standards, public documentation, independently designed tests, and current ClassroomIO patterns.

## Primary Sources

### QTI

- [QTI standard overview](https://www.1edtech.org/standards/qti/index)
- [QTI specifications and resources](https://www.1edtech.org/standards/qti)
- [QTI conformance and certification](https://www.1edtech.org/standards/qti/conformance)
- [QTI 3.0 overview](https://www.imsglobal.org/spec/qti/v3p0/oview/)
- [QTI 3.0 final release context](https://www.1edtech.org/blog/finally-final-the-qti-30-release)

### TAO Documentation

- [Creating test materials](https://userguide.taotesting.com/user-documentation/latest/public/creating-test-materials)
- [Creating a test item](https://userguide.taotesting.com/user-documentation/latest/public/creating-a-test-item)
- [Adding interactions](https://userguide.taotesting.com/user-documentation/latest/public/adding-interactions)
- [QTI interactions](https://userguide.taotesting.com/user-documentation/latest/public/qti-interactions)
- [Configuring interactions](https://userguide.taotesting.com/user-documentation/latest/public/configuring-interactions)
- [Adding other content](https://userguide.taotesting.com/user-documentation/latest/public/adding-other-content)
- [Custom interactions](https://userguide.taotesting.com/user-documentation/latest/public/custom-interactions)
- [Scoring tests](https://userguide.taotesting.com/user-documentation/latest/public/scoring-tests)
- [Test settings](https://userguide.taotesting.com/user-documentation/latest/public/test-settings)
- [Test-taker navigation](https://userguide.taotesting.com/user-documentation/latest/public/test-navigation-for-test-takers)
- [Assessment content import/export API](https://userguide.taotesting.com/developer-documentation/latest/public/importing-exporting-assessment-content-with-api)
- [TAO item API](https://userguide.taotesting.com/developer-documentation/latest/public/items)

### Source Repositories Inspected

- [ClassroomIO](https://github.com/classroomio/classroomio)
- [TAO CE](https://github.com/tao-ce/tao-ce)
- [TAO Community](https://github.com/oat-sa/tao-community)
- TAO community extensions for Item QTI, Test QTI, PCI, PIC, QTI SDK, and QTI libraries referenced by those distributions.

## Standards Position

QTI defines a portable assessment information model and interchange format. It does not require a product to use QTI XML as its database schema or to reproduce a particular authoring UI. Therefore the product can keep a smaller typed canonical model and translate to QTI at import/export boundaries, provided exported claims are restricted to a tested conformance profile.

QTI 3 is the semantic target for new interoperability decisions. TAO community source and fixture behavior is heavily QTI 2.x-oriented, so it is useful for edge cases but cannot override current QTI 3 semantics.

Relevant QTI primitives discovered in community SDK code include:

- Cardinality: `single`, `multiple`, `ordered`, `record`.
- Base types: identifier, boolean, integer, float, string, point, pair, directed pair, duration, file, URI, coordinates, and compatibility-specific variants.
- Item-level concepts: response declarations, outcome declarations, response processing, modal/inline feedback, supporting content, and one or more interactions.

The internal schema should model only semantics ClassroomIO can author, render, validate, score, review, import, and export correctly. It must not mirror the full QTI XSD speculatively.

## Interaction Taxonomy

The official TAO interaction guide presents these standard interaction families:

| Family | Interaction | Core response shape | ClassroomIO status |
| --- | --- | --- | --- |
| Common | Choice | single/multiple identifier | Existing `RADIO`/`CHECKBOX`; needs canonical adapter |
| Common | Order | ordered identifiers | Existing `ORDERING`; needs stronger permutation validation |
| Common | Associate | pairs | Missing |
| Common | Match | source-target associations | Disabled prototype is not production-ready |
| Common | Hottext | selected inline identifiers | Missing |
| Common | Gap Match | identifiers assigned to gaps | Existing `WORD_BANK` is a partial native equivalent |
| Common | Slider | numeric value in bounded range | Missing |
| Common | Extended Text | string/file-like extended response | Existing `TEXTAREA`; needs canonical constraints |
| Common | Upload | managed file response | Existing `FILE_UPLOAD`; needs authoritative asset validation |
| Inline | Inline Choice | one identifier embedded in content | Missing |
| Inline | Text Entry | text/numeric value embedded in content | Existing short/numeric/fill variants cover subsets |
| Inline | End Attempt | explicit attempt termination signal | Missing; must integrate with current submit workflow |
| Graphic | Hotspot | selected defined areas | Disabled prototype currently behaves as free points |
| Graphic | Graphic Order | ordered graphical objects/targets | Missing |
| Graphic | Graphic Associate | graphical directed associations | Missing |
| Graphic | Graphic Gap | graphical objects placed in gaps | Missing |
| Graphic | Select Point | one/more coordinates | Disabled `HOTSPOT` prototype is closer to this semantic |

TAO documentation also describes custom interactions. Those must not be treated as standard or assumed to exist in the CE repositories. Any future custom interaction remains a ClassroomIO-native type unless it is explicitly mapped to a QTI/PCI profile.

## Existing ClassroomIO Capability Map

| ClassroomIO type | Closest standard semantic | Current grading | Decision |
| --- | --- | --- | --- |
| `RADIO` | Choice, single | Automatic | Preserve UI; adapt to canonical choice |
| `CHECKBOX` | Choice, multiple | Automatic, partial | Preserve UI; reject duplicates/unknown options |
| `TEXTAREA` | Extended Text | Manual | Preserve as simple path and interaction renderer |
| `TRUE_FALSE` | Choice, boolean presentation | Automatic | Preserve native presentation |
| `SHORT_ANSWER` | Text Entry/Extended Text subset | Manual | Preserve; add explicit matching mode separately |
| `NUMERIC` | Text Entry with numeric base type | Automatic | Preserve; validate finite values and tolerance |
| `FILL_BLANK` | Multiple Text Entry subset | Automatic, partial | Preserve; later normalize to inline entries |
| `FILE_UPLOAD` | Upload | Manual | Preserve; bind to managed asset authorization |
| `ORDERING` | Order | Automatic, partial | Preserve; enforce exact permutation |
| `LINK` | ClassroomIO custom | Manual | Preserve without forcing QTI equivalence |
| `WORD_BANK` | Gap Match subset | Automatic, partial | Preserve; later share canonical gap renderer |
| `STAR` | ClassroomIO custom scale | Automatic | Preserve; optional future QTI downgrade report |
| `VIDEO_RECORDING` | ClassroomIO custom media response | Manual | Preserve; no false standard mapping |
| `MATCHING` | Match subset | Automatic prototype | Keep disabled until real author/take UI and validation ship |
| `HOTSPOT` | Select Point subset | Automatic prototype | Keep disabled until image coordinate and accessibility model ship |

## Current Architecture Findings

### Reusable Foundation

- `packages/question-types` already centralizes question metadata, answer discriminated unions, codecs, capabilities, and scoring.
- `packages/ui/src/custom/exercise-question` already provides a renderer facade and mode-specific renderer registry.
- Dashboard exercise edit, preview, take, review, and submission flows already consume that facade.
- The existing editor stack supports rich text, math, tables, links, images, audio, and video. The first canonical model can compose ordered content blocks without modifying the editor document model.
- Existing Zod, Drizzle, R2/media, Svelte 5, and drag/drop dependencies are sufficient for initial phases.

### Structural Limits

- The current model assumes one `question_type` and one `AnswerData` value per question.
- Current API submission payload is a flat `{ questionId, optionId?, answer? }` shape.
- Grading capability is derived from the top-level question type, which cannot represent hybrid composite items.
- Historical answers reference mutable question rows, so later question edits can change review context.
- Public course, AI, templates, clone/import, and analytics paths also infer behavior from the top-level type and must be made definition-aware before broad rollout.

## Verified Foundation Defects

These are not theoretical risks. They were found in current source or reproduced against current scoring functions and must be resolved before composite interactions expand the blast radius.

| Severity | Finding | Evidence area | Required correction |
| --- | --- | --- | --- |
| Critical | Cross-course submission mutation | Course middleware authorizes URL course, while mutation services/query helpers use only `submissionId` | Scope every mutation by course and verify submission ownership |
| Critical | Non-atomic creation | Submission/attempt lock is transactional; answer parsing, answer insert, and grading occur after commit | Validate before writes and persist all core rows/scores in one transaction |
| High | Malformed JSON can become 500 | Multiple codecs use unguarded `JSON.parse` | Structured result or domain parse error mapped to 400 |
| High | Unknown/invalid answers are skipped | Submission loop uses `continue` when question or decoded answer is missing | Reject request with question-specific validation errors |
| High | Duplicate answer rows possible | No unique `(submission_id, question_id)` constraint | Add DB constraint and request duplicate detection |
| High | Manual points and totals are client-authoritative | Grade schemas accept arbitrary integer points/total | Validate answer ownership/maxima; derive total server-side |
| High | Fractional scores are lost | DB score columns are integer/bigint and submission scoring rounds points | Use precision-preserving storage and two-decimal arithmetic |
| High | Hybrid auto-grading is skipped | Automatic scoring runs only for fully auto-gradable exercises | Score auto interactions/questions and queue manual remainder |
| High | Matching duplicate exploit | A duplicated correct pair can count multiple times | Enforce unique valid pair identities before scoring |
| High | Graphic extra-selection exploit | Correct point plus arbitrary extra point can receive full score | Enforce cardinality and penalize/reject extra selections |
| High | Validation can race author edits | Exercise relations are fetched before the submission transaction and used for decoding/scoring after it starts | Resolve/lock authoritative semantics and validate inside the write transaction |
| High | Attempt retries are not idempotent | Submission payload has no intent key; multi-attempt exercises accept a retry as another attempt | Add optional idempotency key and scoped database uniqueness |
| High | Attempted question deletion can erase history | Question answers cascade when a question is physically deleted | Archive attempted questions and preserve revisions/answers |
| High | Media retention link can be lost | Video asset usage is created after answer commit and missing assets are silently skipped | Commit authoritative asset validation and usage with core writes |
| Medium | Static type IDs rely on seed order | Registry uses fixed numeric IDs while seed inserts rows without explicit IDs | Verify/reserve append-only identities in migrations and test registry/DB consistency |
| Medium | Type safety erosion | Submission service and codec dispatch contain `any` | Replace with inferred/explicit unions and typed dispatch |
| Medium | Registry/schema docs drift | Schema comment and older question PRD use stale IDs | Generate/check mappings from the append-only registry |

## Authoring Behavior Learned From TAO

TAO interaction authoring separates contextual states such as question/content selection, choice editing, answer selection, correct response, response mapping, custom settings, and inactive state. The useful principle is contextual configuration, not the TAO visual design.

ClassroomIO adaptation:

- Selecting a content block exposes content/media controls already native to ClassroomIO.
- Selecting an interaction exposes only its prompt/options/constraints in the current question card.
- Correct answer and scoring controls use existing form grouping and review patterns.
- Preview remains adjacent to authoring and renders the delivery component.
- Advanced response mapping is progressive and appears only for interactions that support it.

This retains the domain correctness of explicit interaction configuration while matching current ClassroomIO interaction patterns.

## Clean-Room And License Boundary

The inspected TAO repositories do not present a single uniform permissive license. Community packages inspected declare GPL-family licenses, while repository metadata can also be inconsistent across files. ClassroomIO itself is AGPL-3.0.

Implementation constraints:

- Do not copy TAO source, fixtures, templates, CSS, labels, icons, or component structure.
- Do not translate TAO PHP/JavaScript implementation line by line.
- Record semantic requirements using official standards/docs and independently authored examples.
- Build ClassroomIO-native fixtures from the standard and product acceptance criteria.
- Keep source links and a decision log so future reviewers can distinguish semantic research from copied implementation.
- Perform a separate license/compliance review before production distribution; no feature phase may claim that research resolved deployment obligations.

## Proposed QTI Conformance Strategy

1. Declare a narrow supported profile after the canonical model is stable.
2. Start with item-level import/export for choice, order, text entry, extended text, upload metadata, and supported feedback/scoring subsets.
3. Add interactions only when both import and export round-trip tests exist.
4. Preserve unknown metadata only when doing so is safe and deterministic; never execute or silently reinterpret it.
5. Produce a compatibility report with `supported`, `unsupported`, and `lossy` entries.
6. Run official conformance tooling before using any conformance or certification claim.

## Research Conclusions

- The target is a ClassroomIO upgrade, not TAO integration at runtime.
- A raw-QTI source of truth would spread XML and broad standard complexity through every current product path.
- A separate assessment subsystem would duplicate Exercise/Question, submissions, UI, permissions, analytics, and authoring concepts.
- A constrained canonical model with a legacy adapter and boundary translators gives the strongest compatibility and lowest long-term coupling.
- Foundation submission/scoring defects must be fixed first because composite interactions amplify each of them.
- Interaction delivery should expand in vertical slices, with the first slice proving multiple interactions and immutable revisions before implementing all 17 types.
