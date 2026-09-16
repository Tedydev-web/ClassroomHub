# Design direction — ClassroomHub teacher dashboard

What this product should feel like, and the type scale that is currently missing. Phase 0b installs
the tokens; every later phase spends them.

## What this product is, and what it therefore is not

A teacher sits in this tool for hours, writing exam questions, checking answer keys, and marking
papers. That single fact settles most arguments:

- Density is a feature, not a failure. Information the teacher needs should be on screen, not one
  disclosure away.
- Calm beats expressive. Anything that draws the eye without carrying meaning competes with the
  question they are trying to write.
- Frequency of use governs intensity. A motion or flourish seen fifty times a day must be shorter and
  quieter than one seen twice.

**Deliberately rejected, with reasons.** Apple's material guidance — translucent chrome, layered blur,
glass toolbars — is written for consumer OS surfaces floating over photography. Applied to a dense
table of marks it costs legibility and paint performance for no gain. So: **solid surfaces, real
borders, no `backdrop-filter` on working screens.** Reserve translucency for marketing pages, where it
already lives.

Equally rejected: bounce as a default, ambient looping motion beside editable content, and decorative
dashboard cards. Those are the "portfolio shot" instincts the workbench gates document already warned
against — and plausibly the source of the speculative TAO-flavoured visuals that need removing.

## The principles that do apply

**Purpose.** Every element earns its place. Before adding a panel, card, or badge, name the question it
answers for the teacher.

**Agency and forgiveness.** Offer undo for slips; reserve a confirmation dialog for genuinely
destructive, irreversible actions. This is the direct fix for the marking screen having **no undo on a
score change** while the total is server-owned — the highest-stakes silent mutation in the product.
Conversely, the exam list already does this right: delete offers a restore.

**Wayfinding.** Every screen answers: where am I, where can I go, what is here, how do I get out. The
audit found flows that fail the last one — a cancelled import that orphans its row with no way back to
the same file, and a create-exam flow that lands on the list instead of the exam just created.

**Feedback in four kinds — status, completion, warning, error.** They must be distinguishable. The
systemic defect today is that **failure renders as emptiness**: a broken gradebook API tells the
teacher the course has no students. An empty state and an error state are different messages and must
look different.

**Simplicity, not minimalism.** Burying controls to make a screenshot look clean is not simplicity.
Show the common path first and put advanced options one level deeper — which is exactly the decided
shape of the authoring workbench: two working panes, with the outline and validation on demand.

**Familiarity.** Things that look the same must behave the same and live in the same place. Today the
same exam list renders inside two different page shells, and page titles are produced three different
ways. Consistency here is worth more than novelty.

**Craft.** Every spacing, timing and alignment value is a choice you can defend. `text-[13.5px]` and
`text-[9.5px]` are not choices; they are eyeballed fits.

## Typography — the missing scale

Colour and radius are tokenised and complete. Type is not: **8 Tailwind steps used correctly (1,100+
occurrences) against ≥20 arbitrary pixel sizes (~200 occurrences)**, including half-pixel values.

Two rules shape the scale:

- **Leading tracks size inversely.** Tight on large text, looser on body. Tighter still for dense,
  information-heavy UI — which this is.
- **Tracking is size-specific.** Large text needs negative tracking because letters read too far apart
  as they grow; small text needs slightly positive tracking to stay legible. A single fixed
  `letter-spacing` is wrong somewhere.

Sizes are `rem` so a teacher's browser text-size setting scales the layout with the text.

| Token | Size | Leading | Tracking | Replaces |
|---|---|---|---|---|
| `--ui-text-2xs` | `0.6875rem` (11px) | `1.45` | `+0.01em` | `text-[9px]`, `[9.5px]`, `[10px]`, `[11px]`, `[11.5px]` — 87 occurrences |
| `--ui-text-xs` | `0.75rem` (12px) | `1.45` | `+0.005em` | stock `text-xs` (407) plus `[12px]`, `[12.5px]` |
| `--ui-text-sm` | `0.875rem` (14px) | `1.5` | `0` | stock `text-sm` (573) plus `[13px]`, `[13.5px]`, `[15px]` |
| `--ui-text-base` | `1rem` (16px) | `1.6` | `0` | stock `text-base` (65), `[16px]` |
| `--ui-text-lg` | `1.125rem` (18px) | `1.5` | `-0.005em` | stock `text-lg` (40), `[17px]`, `[18px]` |
| `--ui-text-xl` | `1.25rem` (20px) | `1.4` | `-0.01em` | stock `text-xl` (15) |
| `--ui-text-2xl` | `1.5rem` (24px) | `1.3` | `-0.015em` | stock `text-2xl` (20), `[22px]` |
| `--ui-text-3xl` | `1.875rem` (30px) | `1.25` | `-0.02em` | stock `text-3xl` (4) |
| `--ui-text-display-sm` | `2.375rem` (38px) | `1.15` | `-0.022em` | `[38px]`, `[40px]` |
| `--ui-text-display` | `3.5rem` (56px) | `1.05` | `-0.025em` | `[56px]`, `[64px]`, `text-5xl` |

The stock Tailwind steps keep their pixel values deliberately — 1,100+ existing occurrences are
already correct, so tokenising costs no repaint. Only the arbitrary values move, and each maps to the
nearest step with no perceptible change.

**Hierarchy is built from weight, size and leading together**, never size alone. Emphasise with weight
before reaching for a larger size: it adds presence without consuming space, which matters on a dense
screen.

## Page title: one mechanism

Three compete today — `Page.Title` from a route, `Page.Title` emitted from a page component, and raw
`<h1>`/`<h2>` with a hand-rolled size. `Page.Title` itself is `text-2xl font-normal` and matches none of
the hand-rolled ones.

The rule: **the route owns the page title.** A page component never emits one. Screens that need a
title inside the content area use a section heading, which is a different thing and looks like one.

**Measured 2026-09-16, and one exception is argued rather than fixed.** Fourteen course routes own
their title correctly. Exactly one page component in this scope still emits one — `pages/exercise.svelte` —
and it should keep doing so. Its title is `exerciseContentItem?.title || $questionnaire.title`: live
content the teacher is editing in that very screen, which updates as they type. Moving it to the
route would make the route subscribe to the questionnaire store, pushing page state up into routing
to satisfy a rule written for static titles. The rule stands for titles the route knows; a title the
page is authoring is the exception, and this is the only one.

The "raw `<h1>` with a hand-rolled size" half of this defect was real and is fixed: the exercise
delete dialog carried an `<h1>` inside a dialog that already had a title, so the page had two
level-one headings and the question outranked the heading above it. It is now the dialog's
description.

## Interaction feel

Adopted from the fluid-interface principles, scoped to where this product actually has gestures:

- **Respond on pointer-down.** A row or button highlights the instant it is pressed, not on release.
- **Drag is 1:1 and interruptible.** Question reorder and the Kanban board must track the pointer,
  respect where the item was grabbed, and be redirectable mid-flight. This is the one place springs earn
  their cost; everywhere else, tokened durations are simpler and cheaper.
- **Enter and exit along the same path.** A panel that slides in from the right dismisses to the right.
- **Anchor surfaces to their trigger.** Popovers and dropdowns grow from the control that opened them,
  not from their own centre.
- **Rubber-band at boundaries** in any scrollable pane rather than stopping hard.

## Accessibility baseline

Three user preferences are honoured as first-class states, not afterthoughts:

- `prefers-reduced-motion` — cross-fade instead of slide or spring; no overshoot. Currently honoured at
  four sites, none in the dashboard. See `motion-vocabulary.md`.
- `prefers-reduced-transparency` — since working screens are solid by decision, this mostly already
  holds; marketing surfaces must respect it.
- `prefers-contrast` — near-solid backgrounds with a defined, contrasting border.

Beyond preferences: state must never be carried by colour alone — a finding, a dirty flag, or a
validation error needs text or an icon too. The audit found five click-only handlers with no keyboard
equivalent and 20 a11y suppressions; those are defects, not style.

## What "done" looks like on a screen

A teacher screen is finished when all of these hold:

1. It uses the shared page shell, with the route owning the title and a document title set.
2. Every size, colour, duration and easing comes from a token.
3. Loading, empty, error and success are four visibly different states, and error is never disguised as
   empty.
4. The primary action is obvious and singular; secondary actions do not compete for the same visual
   weight.
5. There is always a way back, and destructive actions are either undoable or confirmed — not both, and
   never neither.
6. It is usable by keyboard end to end, and every state is legible without colour.
7. Nothing moves that does not need to.
