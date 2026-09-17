# Design system audit — where the installed system is and is not used

Two measurements of the same thing: the gap between what `design-direction.md` installed and what
the code actually uses. Typography first, colour second.

## Typography — where the installed scale is and is not used

`design-direction.md` installed a type scale and listed the arbitrary pixel sizes it was meant to
replace, quoting 87 occurrences. This is what those occurrences turn out to be when read.

## The count, in scope

35 arbitrary `text-[Npx]` values across Courses, Exam and Exercise; 57 dashboard-wide. They are not
spread thin — they cluster:

| File | Count | What it is |
|---|---|---|
| `course/components/course-list-row.svelte` | 13 | the course card — **a deliberate ramp, see below** |
| `certificate/editor/panels/template-thumb.svelte` | 6 | a miniature of a certificate |
| `course/components/content-count-badges.svelte` | 3 | real UI |
| `certificate/editor/certificate-editor-header.svelte` | 3 | certificate canvas chrome |
| eight more, one each | 8 | sidebar, content trees, progress card — real UI |
| `certificate/editor/panels/templates-panel.svelte`, `certificate/certificate-design.svelte` | 2 | certificate rendering |

## Correction: the biggest cluster is not a defect

`course-list-row.svelte` holds 13 of the 35, and every one of them is paired with a container-query
counterpart:

```
text-[10px]!   @3xl:text-xs!
text-[9.5px]!  @3xl:text-xs!
text-[11px]    @3xl:text-sm
text-[14px]    @3xl:text-base
```

The file uses container queries 27 times. The **roomy tier already uses the token scale** —
`@3xl:text-xs`, `@3xl:text-sm`, `@3xl:text-base`. The arbitrary values are the **compact tier**,
tuned to a card that must stay legible when its container is narrow.

Replacing them with `--ui-text-2xs` (11px) as the design document proposed would *enlarge* the
compact card — 8px and 9.5px both become 11px — and break the layout they were measured for. That
is not cleanup; it is a visual change to a screen nobody asked about.

**So the gap is in the scale, not in the file.** The scale stops at `2xs` (11px), and this card
needs a tier below it. Either the scale gains one, or these thirteen stay and earn a comment saying
they are the compact tier of a container ramp. Both are design decisions; neither is a sweep.

## What the certificate files are

Eleven of the 35 sit in `certificate/`. `template-thumb.svelte` renders a **miniature of a
certificate** — its 6px text is a scaled-down representation of printed text, not interface text.
The editor canvas and design surface are the same: they draw a document.

Constraint 5 of the plan already excludes the print template from visual sweeps *because it is not a
screen*. The same reasoning applies here, and for the same reason: changing these changes the
artefact, not the chrome.

## What is genuinely loose

Eleven occurrences across `content-count-badges.svelte` and eight single-use components — sidebar
entries, content and exam trees, the mobile outline, the progress card. These are interface text at
`text-[10px]` and `text-[11px]` with no responsive counterpart, and `--ui-text-2xs` at 11px is what
they should be.

That is the whole of the honest sweep: **eleven sites**, not 87.

## Why the original number was wrong

`design-direction.md` counted occurrences with a pattern and did not read them. Three different
things were counted as one: a responsive ramp's compact tier, a document drawn at miniature scale,
and genuinely loose interface text. Only the third is a defect.

This is the eighth claim in this programme's own documents that did not survive being read. The
standing rule holds: **read the site before fixing it.**

## Recommended order

1. The eleven loose sites — mechanical, no design decision, safe without seeing the screen.
2. The compact tier — needs a decision on whether the scale grows a step below `2xs`.
3. The certificate files — leave alone unless certificate rendering is itself in scope.

---

# Colour — 123 hardcoded palette values against a criterion of zero

Acceptance criterion 4 asks for "zero hardcoded palette colours in in-scope components". Measured
across the 375 in-scope files:

| Family | Count |
|---|---|
| `text-gray-*` | 41 |
| `bg-neutral-*` | 21 |
| `border-neutral-*` | 19 |
| `bg-gray-*` | 16 |
| `border-gray-*` | 15 |
| `bg-zinc-*`, `border-slate-*`, `bg-slate-*` | 11 |
| **Total** | **123** |

Concentrated in fourteen files, led by `pages/marks.svelte` (22), `mark-exercise-modal.svelte` (16)
and `exercise-settings-tab.svelte` (14).

## They are light/dark pairs, and the tokens already exist

The values are not scattered: they repeat as the same handful of pairs.

| Pattern in the code | Token it means |
|---|---|
| `text-gray-500` / `dark:text-gray-400` | `ui:text-muted-foreground` |
| `bg-gray-100` / `dark:bg-neutral-700` | `ui:bg-muted` |
| `border-gray-200` / `dark:border-neutral-700` | `ui:border-border` |
| `bg-gray-50` | `ui:bg-muted/50` |
| `bg-neutral-800`, `bg-zinc-950` | `ui:bg-card` in dark, depending on the surface |

This is the standard shadcn mapping and the tokens are installed and emitting. The conversion is
mechanical in shape.

## Why it is not being applied here

It is not a rename: the rendered colour shifts. `--muted-foreground` is `oklch(0.556 0 0)`;
`text-gray-500` is `#6b7280`. Close, deliberately so, but not identical — and 123 of them across
fourteen files, including the gradebook the owner opens, is a visible change to screens nobody in
this session has seen.

This session already shipped one visual change to an unseen screen and had it rejected on sight.
The lesson applies: measure now, apply as a deliberate pass with someone looking.

**So this is Phase 6 work, specified rather than done.** When it runs, the mapping above is the
whole of it, and the ordering that keeps it reviewable is one file at a time, largest first, with
the screen open.

## The three exclusions, so the sweep is not re-argued later

- **Grade tints** in `marks.svelte` — `bg-green-50 text-green-700 dark:bg-green-950/30` and its
  siblings are semantic, encoding a band of achievement. They are not greys and are not in the 123.
- **SVG fills and strokes**, per the criterion's own wording.
- **The print template**, per constraint 5.

## The last arbitrary sizes, settled — 2026-09-17

The roadmap left one question open: the compact type tier needs "a step below `2xs` or an
explicit exemption". Measured, the remaining arbitrary sizes in scope fall into three groups, and
only one of them was a real defect.

**Group 1 — chrome, and a defect. Fixed.** Six sizes that are interface, not artwork: three badges
in `certificate-editor-header.svelte`, one in `certificate-design.svelte`, a caption in
`templates-panel.svelte`, and a course title written as `text-[14px]`. The badges now use
`ui:text-2xs`; the title uses `text-sm`, which *is* 14px, so that one is a rename.

The badges take the **prefixed** token on purpose. `Badge` sets its own size inside
`packages/ui`, and `tailwind-merge` is configured for the `ui` prefix, so an unprefixed
`text-2xs` would not be recognised as the same property, both rules would emit, and the base
would win by cascade. The same trap that made 35 dialogs ignore their own width.

**Group 2 — the compact container-query tier. Exempt, with the reason.** `course-list-row.svelte`
renders eleven sizes between 8px and 11.5px, but only when its container is narrower than `3xl`;
every one of them has an `@3xl:` sibling that is already a token. This is not a hierarchy, it is
one row compressing to fit a sidebar.

Publishing a `3xs` step to cover it would put a 9px token in the shared theme, where the next
caller has no container query and no reason not to reach for it. The scale's smallest step is
11px because that is the floor it was designed around; a private compression below that floor is
a component's business, not the design system's. **The `@3xl:` tier stays the contract; the
compact tier is exempt.**

**Group 3 — certificate renderings. Exempt.** `template-thumb.svelte` draws miniatures of
certificate designs at roughly a tenth of their real size, in the faces those designs use —
Bodoni Moda, Cinzel, Playfair Display, Cormorant Garamond, JetBrains Mono. `text-[6px]` there is
a picture of type, not type. The product's scale governs the product's own voice; it does not
govern a thumbnail of somebody's certificate.

Count in scope after this: **0 chrome, 11 compact-tier, 7 certificate rendering** — and every one
of the eighteen is now argued rather than merely surviving.
