# Gate 2 — `AssessmentItemRenderer` prop defaults

`packages/ui/src/custom/exercise-question/assessment-item-renderer.svelte` is imported by the frozen
student sitting page **and** by teacher surfaces. It is deliberately absent from `frozen-files.txt`,
because Phase 1 is the phase that adds opt-in props to it.

That leaves a hole exactly where the next phase lands: the frozen-file check stays green while a
changed default silently repaints the student screen. This file closes it.

## The rule

**Adding a prop with a new default is allowed. Changing an existing default is not.**

The student page passes only a subset of these props; every value it does not pass, it takes from
this list. Change one and the exam a candidate sits changes with it.

`revealsKey = false` deserves naming on its own: it decides whether the answer key is drawn. It
defaults to `false` because a candidate must never receive it. If that default ever reads `true`,
stop.

## Recorded baseline — 2026-09-16 (commit 6dfd665b6)

```
    definition,
    response = null,
    feedback = [],
    feedbackLabel,
    disabled = false,
    title = '',
    questionNumber,
    interactionNumberStart = 1,
    questionNumberActive = true,
    showItemHeader = true,
    showContainer = false,
    validationRequested = false,
    validationMessage = '',
    trueLabel,
    falseLabel,
    focusRequestKey,
    passageWorkspaceLabels = null,
    fillsParent = false,
    revealsKey = false,
    questionActions,
    activeQuestionNumber = null,
    showQuestionStepper = true,
    onQuestionChange,
    onResponseChange = () => {}
```

24 props. Nine carry no default and are supplied by every caller.

## The check

Run before committing any change to that component:

```bash
sed -n '/let {/,/}: Props = \$props()/p' \
  packages/ui/src/custom/exercise-question/assessment-item-renderer.svelte
```

Diff the output against the block above. A **new line** is fine — that is an opt-in prop, which is
how teacher surfaces are allowed to extend this component. A **changed line** means an existing
default moved, and the student sitting screen must be re-verified before that change goes anywhere.

## Why a file rather than a test

A rendering test would be stronger, and is worth writing when Phase 1 opens. This exists because the
gate was needed before the phase starts, not after — a recorded baseline a human diffs beats an
intention. Replace it with a test the moment one exists.
