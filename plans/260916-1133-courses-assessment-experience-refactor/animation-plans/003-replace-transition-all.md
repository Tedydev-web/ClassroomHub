# 003 — Replace `transition-all` with the one property that actually changes

- **Status**: DONE — 74727a968
- **Commit**: eca4a8163
- **Severity**: LOW
- **Category**: 5. Performance · 2. Easing & duration
- **Estimated scope**: 4 files, 1 changed line each

## Problem

`transition-all` watches every animatable property, so anything that happens to change on that
element — a size, a padding, a border — animates too, and off the compositor. In each of these four
places only one property is meant to move.

```svelte
<!-- apps/dashboard/src/lib/features/course/components/card-dropdown.svelte:34 — current -->
class="ui:duration-(--ui-duration-base) ui:ease-ui-in-out absolute top-6 right-6 z-40 flex items-center justify-center opacity-0 transition-all delay-150 group-hover:opacity-100 data-[state=open]:opacity-100"
```

```svelte
<!-- apps/dashboard/src/lib/features/course/components/lesson/video/video-card-dropdown.svelte:324 — current -->
? 'ui:duration-(--ui-duration-base) ui:ease-ui-in-out absolute top-2 right-2 z-40 flex items-center justify-center opacity-0 transition-all delay-150 group-hover:opacity-100 data-[state=open]:opacity-100'
```

The two menu triggers above only change `opacity`. They also use `ease-ui-in-out`, which the
repository reserves for elements moving on screen; a control appearing on hover is an entrance.

```svelte
<!-- apps/dashboard/src/lib/features/course/components/lesson/document/add-document-modal.svelte:337 — current -->
class="ui:duration-(--ui-duration-slow) h-2 rounded-full bg-blue-600 transition-all"
style="width: {$lessonDocUpload.uploadProgress}%"
```

The upload progress bar changes `width`, a layout property, on every progress tick.

```svelte
<!-- packages/ui/src/custom/exercise-question/renderers/word-bank/take.svelte:176 — current (excerpt) -->
… ui:text-sm ui:transition-all ui:duration-200 ui:border-primary …
```

The legacy word bank blank changes `border-style` and background when a word is placed.

## Target

```svelte
<!-- card-dropdown.svelte:34 and video-card-dropdown.svelte:324 -->
ui:duration-(--ui-duration-base) ui:ease-ui-out … transition-opacity delay-150 …
```

Keep `delay-150`: it stops the menu button flickering into view while a cursor sweeps across a
grid of cards, which is a purpose, not decoration.

```svelte
<!-- add-document-modal.svelte:336-339 — animate a transform, not the width -->
<div
  class="ui:duration-(--ui-duration-slow) ui:ease-ui-out h-2 w-full origin-left rounded-full bg-blue-600 transition-transform"
  style="transform: scaleX({$lessonDocUpload.uploadProgress / 100})"
></div>
```

The parent track at `:335` is `ui:bg-muted h-2 w-full rounded-full` and has **no**
`overflow-hidden`. `scaleX` squashes the child's rounded ends along with its width, so at low
percentages the bar's right end will look pinched. If it does, add `overflow-hidden` to the parent
`div` at `:335`, drop `rounded-full` from the child, and note it in the verification results.

```svelte
<!-- word-bank/take.svelte:176 — replace only the transition utility -->
… ui:text-sm ui:transition-colors ui:duration-200 ui:border-primary …
```

`transition-colors` covers `background-color` and `border-color`. `border-style` cannot animate at
all, so nothing is lost.

## Repo conventions to follow

- Durations and easings are tokens: `ui:duration-(--ui-duration-fast|base|slow)` and
  `ui:ease-ui-out|in|in-out`. See
  `plans/260916-1133-courses-assessment-experience-refactor/motion-vocabulary.md`.
- Classes that override a `@cio/ui` component must carry the `ui:` prefix; plain dashboard markup
  (these four) may use unprefixed Tailwind as they already do.

## Steps

1. `card-dropdown.svelte:34`: replace `transition-all` with `transition-opacity`, and
   `ui:ease-ui-in-out` with `ui:ease-ui-out`.
2. `video-card-dropdown.svelte:324`: the same two replacements, in the `'corner'` branch string only.
3. `add-document-modal.svelte:336-339`: apply the target block above.
4. `word-bank/take.svelte:176`: replace `ui:transition-all` with `ui:transition-colors`.

## Boundaries

- Change only the class strings and, for step 3, the `style` attribute named above.
- Do NOT change `bg-blue-600` in step 3; a hardcoded colour is a separate finding.
- Do NOT touch any file listed in
  `plans/260916-1133-courses-assessment-experience-refactor/frozen-files.txt`.
- Do NOT add dependencies.
- If a line does not match, STOP and report.

## Verification

- **Mechanical**: after step 3, confirm the new classes are emitted:
  `grep -o 'origin-left\|transition-transform' apps/dashboard/.svelte-kit/output/client/_app/immutable/assets/*.css | sort -u`
  after a build. `pnpm --filter @cio/dashboard exec svelte-check --threshold error` reports the
  same error count as before.
- **Feel check**:
  - Hover a course card and a video card: the menu button fades in after a short pause, exactly as
    before.
  - Upload a document: the progress bar grows smoothly from the left and reaches the full width at
    100%.
  - In a legacy word bank question, place a word: the blank's border and background change colour
    smoothly.
  - In DevTools, Performance panel, record an upload and confirm the progress bar no longer
    produces Layout entries on each tick.
- **Done when**: no `transition-all` remains in the four lines, and all three feel checks pass.
