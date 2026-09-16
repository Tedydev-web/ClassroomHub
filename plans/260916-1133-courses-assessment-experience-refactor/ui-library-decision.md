# UI library — the decision, and why it was never open

**Verdict: keep bits-ui. Add nothing. Remove one dead dependency.**

This was commissioned as a library *choice*. It is not one. A choice implies a migration is
affordable, and the measurements below say it is not — and, more importantly, that it would buy
nothing. What the exercise did surface is a dependency with zero import sites and a motion library
confined to decoration.

## What is actually installed

| Library | Role | Files referencing it |
|---|---|---|
| `bits-ui` ^2.16.1 | Headless primitives — the foundation | **119** |
| `svelte-dnd-action` | Drag and drop (question reorder, submissions board) | 11 |
| `vaul-svelte` | Drawer / bottom sheet | 9 |
| `layerchart` | Charts | 7 |
| `svelte-motion` | Decorative animation only | 6 |
| `svelte-sonner` | Toasts | 2 |
| `@floating-ui/dom` | Direct use inside the editor | 2 |
| `tw-animate-css` | The `animate-in` / `animate-out` utilities | 1 (`index.css`) |
| `tippy.js` ^6.3.7 | **Nothing** | **0** |

## Why bits-ui is not replaceable here

**28 of 48 `base/` components wrap it.** The other 20 — `alert`, `badge`, `breadcrumb`,
`button-group`, `card`, `chart`, `dark-mode`, `drawer`, `empty`, `field`, `input`, `input-group`,
`item`, `kbd`, `number-badge`, `page`, `skeleton`, `sonner`, `spinner`, `table`, `textarea` — are
presentational and need no behaviour library at all. So every component that needs a headless
primitive already has one, from one source.

**Zero files outside `packages/ui` import `bits-ui` directly.** That is the number that settles it.
The dependency is fully encapsulated behind `@cio/ui`, which means two things at once: swapping it
would touch 119 files in one package and no application code, *and* there is no leakage pressure
forcing a swap. A boundary this clean is what a library migration is usually undertaken to
*achieve*.

**It is already carrying this programme's work.** The origin-aware overlays in
`animation-opportunities.md` row 5 are bits-ui's `--bits-*-content-transform-origin` variables.
Replacing the library would mean re-deriving that behaviour by hand.

## Why adding a component library would make things worse

`packages/ui/src/index.css` compiles with `@import 'tailwindcss' prefix(ui)`, so **only
`ui:`-prefixed token utilities exist**. Any dropped-in library ships unprefixed classes, which in
this build emit **no CSS at all**. That is not hypothetical: this programme already fixed 31 such
usages across 12 files that were rendering unstyled, and added a `dashboard-token-prefix` pre-commit
guard so it cannot recur. A second component library would reintroduce that exact failure mode,
silently, across its whole surface.

Second reason: the student sitting page is frozen and shares `packages/ui`. A library that restyles
shared primitives cannot be adopted without breaching that constraint — as press feedback showed,
where one line in `buttonVariants.base` required an explicit owner exception.

## The one real finding — `tippy.js`

`packages/ui/package.json` declares `tippy.js` ^6.3.7. **No file in `packages/ui/src` or
`apps/dashboard/src` imports it.**

The likely history: TipTap v2's bubble menu used tippy. This repo is on TipTap v3, which uses
floating-ui — and the two direct `@floating-ui/dom` usages here
(`custom/editor/extensions/slash-command/slashcommand.ts`,
`custom/text-editor/tiptap-bubble-menu-patch.test.ts`) are exactly what that migration leaves
behind. The declaration outlived the thing that needed it.

## `svelte-motion` — scoped, not removable

Six files, all under `custom/animation/`: `gradual-spacing`, `sparkle-particle`, `blurfade`,
`blurin`, `magic-card`, `hero-video-dialog`. Every one is decorative, and **none is used by Courses,
Exam or Exercise**. It is a marketing-surface dependency, correctly quarantined. The motion this
programme cares about runs on the CSS tokens in `motion-vocabulary.md` and on Svelte's own
transitions through `lib/utils/motion.ts`. Leave it where it is; do not reach for it in teacher
surfaces.

## What this means for the rest of the programme

No library work is scheduled. The restyling phases build on the primitives already present, and the
budget a migration would have consumed goes to the three files holding 47% of the surface (D20)
instead — which is what actually blocks safe restyling.
