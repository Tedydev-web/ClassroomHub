---
phase: 5
title: "Sitting the exam"
status: pending
priority: P1
effort: "2d"
dependencies: [3]
---

# Phase 5: Sitting the exam

## Overview

The student's side: a route that asks who you are, hands you the paper, counts down, saves
as you go, and submits. Most of this already exists — the renderer is the one built for
passage papers, including the one-question pager finished on 2026-08-11.

## Requirements

Functional:

- A public exam route that needs no session.
- An entry screen collecting exactly the fields the exam asks for, plus the password when
  one is set.
- The paper rendered by the existing assessment renderer.
- A countdown, and periodic autosave.
- Submit, with a confirmation when questions are unanswered.

Non-functional:

- Autosave must survive a flaky mobile connection: a failed save retries and does not lose
  the answer.
- The countdown is display only and derived from the server's `expiresAt`.

## Architecture

Route: `apps/dashboard/src/routes/(org-site)/exam/[slug]/+page.svelte`, in the existing
anonymous-safe route group, which already proves the pattern — that group is documented in
the API as having no auth middleware and is where public lessons live.

The renderer is `packages/ui/src/custom/exercise-question/assessment-item-renderer.svelte`.
It already handles passage papers, the split layout, and paging one question at a time on
narrow screens. It takes a definition and a response and emits changes; it does not know
where responses go. That is exactly the seam the exam needs, so the exam supplies a
different response handler and reuses the whole surface.

Do not reuse `packages/ui/src/custom/public-course/exercise-view.svelte`. That component
grades in the browser and persists to `localStorage`, which is the behaviour being
replaced. Reusing it and disabling its grading would leave the grading code one prop away
from running.

**Tell the sitter what they do not get.** Someone sitting without an account keeps no record
of their own — Azota states the same limitation plainly: "Học sinh không thể lưu lại lịch sử
bài thi nếu không đăng nhập khi thi". Once the paper is submitted, the student cannot come
back later and look at it unless the teacher's reveal settings allow it in that session. The
entry screen says so before they start, rather than leaving them to discover it afterwards.

**Countdown.** The server returns `expiresAt`. The client renders `expiresAt - now` and
never counts down from a duration it was told, because those diverge whenever a request is
slow. When the countdown reaches zero the client attempts a submit; if that submit fails
for any reason, the client says so plainly rather than pretending, because phase 4 has
already guaranteed the server will finalise it anyway.

**Autosave.** Debounced after a change, and on a fixed interval. A failed save is retried
with backoff and the interface shows an unsaved indicator. The student is never told their
work is saved when it is not.

## Related code files

- Create: `apps/dashboard/src/routes/(org-site)/exam/[slug]/+page.svelte`
- Create: `apps/dashboard/src/routes/(org-site)/exam/[slug]/+page.server.ts`
- Create: `apps/dashboard/src/lib/features/exam/exam-entry-form.svelte`
- Create: `apps/dashboard/src/lib/features/exam/exam-countdown.svelte`
- Create: `apps/dashboard/src/lib/features/exam/exam-autosave.ts`
- Create: `apps/dashboard/src/lib/features/exam/exam-autosave.test.ts`
- Reuse, do not modify:
  `packages/ui/src/custom/exercise-question/assessment-item-renderer.svelte`
- Modify: `apps/dashboard/src/lib/utils/translations/*.json` — Vietnamese first

## Implementation steps

1. **Write the autosave test first**, as pure logic separated from the component: a save
   that fails is retried; a save that fails then succeeds leaves no pending state; two
   rapid changes coalesce into one request; a change during an in-flight save is not lost.
   This is where the data-loss bugs live, and none of them are visible in a component test.
2. Build the entry screen: name, class and candidate number shown only when the exam asks
   for them, password when set. Validate before starting, so a student is not told their
   password is wrong after the clock has started.
3. Wire the renderer to the attempt's saved responses.
4. Build the countdown from `expiresAt`.
5. Wire autosave and the unsaved indicator.
6. Submit, with an unanswered-question confirmation.
7. Vietnamese copy throughout, using the vocabulary teachers already know from Azota:
   thời gian làm bài, nộp bài, số báo danh.

## Success criteria

- [x] Every autosave failure mode has a passing unit test
- [x] Refreshing mid-paper restores answers and the correct remaining time
- [x] The countdown matches the server's expiry after a deliberate two-minute clock skew
      on the client
- [x] A student is never shown "saved" while a save is failing
- [x] The paper is usable one-handed on a phone, verified by rendering it, not by reading
      the CSS
- [x] `exercise-view.svelte` is not imported anywhere in the exam route

## Risk assessment

**Rendering blindness.** Three real layout defects this month were found by rendering the
page in a headless browser and looking, after reasoning about the CSS had concluded it was
fine. Render this at phone width and look at it before calling it done.

**The client clock is wrong.** Some student devices have a clock minutes out. Deriving the
countdown from `expiresAt - now` uses the client clock for `now`, so a skewed device shows
a skewed countdown. Mitigation: on start, record the offset between the server's response
time and the client's clock, and apply it. Do not skip this; a phone with a wrong clock is
common, and the student sees a countdown that disagrees with reality.

**Reusing the public exercise view.** It grades in the browser. Any reuse of it puts the
answer key back on the page. The success criterion asserting it is not imported exists
because this shortcut is tempting and its cost is the entire security property.
