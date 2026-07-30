# Research loop: user flows and UI simulations

## Evidence boundary

Observed in this checkout: the canonical model has 11 interaction kinds, but both authoring and learner rendering branch only for `choice`, `text`, and `true_false_group`. A universal shell is therefore necessary but not sufficient: each interaction needs a small, intentional editor and delivery renderer.

TAO supports composite items and separates common, inline, graphic, and custom interactions. We adopt that extension shape, not TAO's visual treatment.

## Common workspace grammar

Every canonical item uses the same stable frame:

```
Exercise header: title · draft/saved state · Preview · Save
────────────────────────────────────────────────────────────
 Item map (drawer)   | Context / canvas        | Active interaction
 invoked on demand   | persistent work surface | persistent work surface
─────────────────────┴─────────────────────────┴────────────────────
```

Desktop has two persistent surfaces, never three. The item map is a drawer. Preview replaces the work area. Validation opens a contextual panel and focuses only when the author requests it.

## Simulations

### 1. Reading passage with six questions

```
 [Item map]  Passage 1 · Q1–6        | Q3 · Multiple choice · 1 pt
 ┌─────────┐ ┌───────────────────────┼──────────────────────────────────┐
 │ Q1  ✓   │ │ Reading text editor   │ Prompt                           │
 │ Q2  ✓   │ │                       │ [ rich text ................ ]  │
 │ Q3  !   │ │ [Add passage]         │ Answers                         │
 │ Q4       │ │                       │ ( ) A ...    [correct]          │
 │ Q5       │ │                       │ ( ) B ...                        │
 │ Q6       │ │                       │ [+ answer]  Scoring · More      │
 └─────────┘ └───────────────────────┴──────────────────────────────────┘
```

Flow: open item → drawer chooses Q3 → both surfaces change selected state without scroll or focus transfer → edit → explicit Save → Preview replaces both panes. A learner sees the same stimulus/question pairing, but no author controls.

### 2. Stand-alone numeric, ordering, upload, or video prompt

```
 [Item map]  Item instructions        | Q2 · Ordering · 2 pts
             [rich text editor]       | Prompt
                                      | [rich text editor]
                                      | Ordered answers
                                      | 1. [ ... ]  ⋮⋮
                                      | 2. [ ... ]  ⋮⋮
                                      | [+ answer]  Scoring · More
```

The left side is not a fake passage. It holds shared instructions/content or an empty-state action to add one. The right side swaps in a family-specific editor. This prevents "prompt/options" fields from pretending they work for file upload, recording, and ordering.

### 3. Inline interaction

```
 Context document/editor              | Q4 · Inline blank · 1 pt
 "Plants need [ _____ ] to grow."     | Blank 1: accepted answers
 [inline token highlighted]           | [sunlight] [+ accepted answer]
                                      | Preview response placement
```

Flow: author selects text, inserts an interaction token, then edits its properties on the right. It preserves spatial meaning instead of presenting an unrelated form below a long document.

### 4. Graphic / future TAO interaction

```
 Canvas + asset                        | Q5 · Hotspot · 2 pts
 [ image ]                             | Mode: select areas
 [ selected region ]                   | Correct regions  [A] [B]
                                      | Constraints · scoring · feedback
```

The shell remains two-pane. The left surface becomes a canvas, not another list. A future PCI plugs into the right property surface with a declared editor/preview/delivery capability.

### 5. Small screens (375–767px)

```
 Header: Item 1 · Saved · Preview
 [Context] [Question] [Item map]
 ───────────────────────────────
 Selected surface only
```

The item map is a modal drawer; Back/Next retain selection. There is no squeezed side-by-side editor, no horizontal page scroll, and the panel switcher is real buttons with selected state.

## Use cases / required states

| Case | Author needs | Required UI response |
|---|---|---|
| First item | Start without knowing assessment structure | Choose interaction family, then a type; contextual empty state explains the next action. |
| Long reading set | Inspect stimulus and edit one question | Two independently focusable scroll regions; no automatic cross-scroll. |
| 40 questions | Jump, see validation, avoid visual noise | Drawer map with status/filter/search; current item remains obvious. |
| Composite item | Mix content and interactions | Ordered item map; only selected interaction editor is mounted. |
| Manual grading | Set instructions and requirements | Editor surfaces file/link/video constraints and grading mode, not answer-key fields. |
| Validation failure | Fix exactly one defect | Error summary opens inspector; selecting error moves focus only on explicit action. |
| Save conflict/error | Avoid data loss | Sticky save state, retry, and revision messaging; no silent overwrite. |
| Preview | Confirm learner delivery | Replaces authoring frame; visible return-to-editor action; same delivery renderer. |
| Imported draft | Reconcile uncertain extraction | Separate review workbench with source/provenance; promote only reviewed items. |

## Red-team findings

1. **Two-pane alone does not solve the current problem.** Keeping this composer nested inside the legacy list leaves duplicate hierarchy, duplicate save/preview controls, and unused page width.
2. **A universal editor can become a lowest-common-denominator form.** Families must own their compact fields; the shell owns navigation, selection, save, preview, validation, and responsive behaviour.
3. **A permanent outline rail fails at 375px and wastes the authoring width at 1280px.** Use a drawer/sheet, with an always-visible current-item context instead.
4. **“All TAO types” cannot honestly mean shipping every QTI/PCI today.** The implementation needs a capability registry and explicit unsupported state. Otherwise future schemas can serialize but render blank.
5. **Do not make autosave a redesign prerequisite.** Existing explicit revision-aware save is safer; autosave is a separate product decision with conflict semantics.
