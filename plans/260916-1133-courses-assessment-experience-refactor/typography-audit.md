# Typography audit — where the installed scale is and is not used

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
