---
phase: 6
title: "Reading the results"
status: pending
priority: P2
effort: "1.5d"
dependencies: [4]
---

# Phase 6: Reading the results

## Overview

The teacher's side: who sat it, where they got to, what they scored, and the ability to
delete a result. This is the surface that makes the whole feature worth building, and it
is also where lazy finalisation is triggered.

## Requirements

Functional:

- A results list per exam: name, class, candidate number, status, score, start and submit
  times, time taken.
- Filter by status and sort by name, score or time.
- Open one attempt to see the paper as that student answered it.
- Delete an attempt.
- Copy the exam link.

Non-functional:

- Opening the list finalises any expired attempts before rendering, so a teacher never
  sees a stale `in_progress` row for a paper that ended yesterday.
- The list stays usable at a class size of forty and does not fall over at four hundred.

## Architecture

A new tab on the exam, not a change to any existing exercise or gradebook surface. Nothing
in this phase touches `submission`, the people list, or course progress.

Status vocabulary follows what teachers already read in Azota's filters, so the words mean
what they expect: chưa thi, đang thi, chưa nộp bài, đã nộp. Mapped onto stored state:

| Shown | Stored |
|---|---|
| đang thi | `in_progress`, not yet past `expiresAt` |
| hết giờ (chưa nộp) | `expired` — the clock ran out with no submit |
| đã nộp | `submitted`, `gradingState = 'complete'` |
| chưa chấm | `gradingState = 'awaiting_manual'` |
| đã chấm | hand-marked and saved |
| lỗi, cần xem lại | `gradingState = 'unscoreable'` |

The one borrowed label we must not borrow is `chưa nộp bài`. In Azota it means a student who
left **before time was up** without pressing submit — their data is kept and they may come
back. Ours means the clock ran out, which is the opposite situation. Reusing the phrase would
teach teachers the wrong thing precisely because they already know it.

**Marking by hand.** A paper may mix auto-scoreable questions with ones a teacher must
read. Following Azota, this happens inside the per-attempt detail view rather than in a
separate marking tool: the questions needing a human are listed with the student's answer,
a score box and a comment box, and one save. Azota labels this tab `Tự luận` and its button
`Lưu điểm`; use the same words, because they are the words the teacher already knows.

Saving a mark recomputes the total and moves `gradingState` to `complete`. Azota's
AI-assisted marking is deliberately not copied.

**The answer trail.** The per-attempt view shows, per question, when it was first answered,
what was chosen, and every later change. Azota keeps the same record and uses it for two
things: settling a dispute about a result, and — read next to the screen-exit log — noticing
a pattern that does not look like somebody working through a paper.

**Fixing a question after the class has sat it.** From the results view the teacher can award
a faulty question's marks to everyone, which re-scores every attempt of that exam. This is
the remedy for a wrong answer key — a failure our own import has already produced — and it is
the only sanctioned way a frozen paper's scores may change. Every use is recorded on the exam
and shown beside the results, because a score that moved without explanation is worse than a
score that was wrong.

**Giving a student another go.** A phone dies, a connection drops, a paper expires at forty
percent through no fault of the student — and with identity being a typed name, there is no
self-service remedy. Azota answers the same situation on the homework side with
`Yêu cầu nộp lại`. Two controls, because two things can be wanted:

*Reopen* keeps the answers and grants a new expiry, so the student resumes. It must set the
new `expiresAt`, return `status` to `in_progress`, and clear the score and submission time in
**one transaction** — otherwise the batch finaliser described below, running in the very
request that renders the page, re-expires the attempt the moment it is reopened. If the paper
has hand-marked questions, reopening returns `gradingState` to `awaiting_manual` and flags the
existing marks as stale: they were given for answers the student is now free to change.

*Clear and sit again* starts fresh. The old attempt is archived rather than emptied, so the
answer trail of the first sitting is not interleaved with the second in the same row.

Every use of either is recorded on the attempt, because these are the controls that can give
one person more time than everybody else.

There is no "chưa thi" row for a public exam, because a sitter who never arrived left no
record. That is an honest gap rather than a missing feature: without a roster there is
nobody to list. The interface should not imply otherwise.

The per-attempt view reuses the review payload from phase 2, which already applies the
reveal policy — but the teacher's own view is not subject to that policy. The policy
governs what a student may see; a teacher sees everything. Two call sites, one serializer,
different gates.

## Related code files

- Create: `apps/dashboard/src/routes/(app)/courses/[id]/exams/[examId]/results/+page.svelte`
- Create: `apps/dashboard/src/routes/(app)/courses/[id]/exams/[examId]/results/+page.server.ts`
- Create: `apps/dashboard/src/lib/features/exam/exam-results-table.svelte`
- Create: `apps/api/src/services/exam/exam-results.ts`
- Create: `apps/api/src/services/exam/exam-results.integration.test.ts`
- Modify: `apps/api/src/routes/exam/exam.ts` — results and delete endpoints

## Implementation steps

1. **Write the finalise-on-read integration test first**: an attempt left `in_progress`
   past its expiry appears in the results list as `expired` with a score, in one request,
   with no separate job having run.
2. Write the authorisation test: a teacher from another course cannot read or delete these
   results. Anonymous callers cannot reach this route at all.
3. Implement the results query, paginated, sorted server-side.
4. Build the table, with the Vietnamese status vocabulary above.
5. Implement clearing an attempt so the student may sit again, with a confirmation naming
   the student — the names are similar by construction, so the confirmation must show
   enough to tell two apart.

   The action is "let them sit again", not "delete". Azota frames the same control that way
   — `Xóa bài thi và cho thi lại`, offered for appeals — and the framing is the honest one: a
   teacher clearing a paper almost always means the student should get another go, not that
   the record should vanish. Removing a record purely to erase it belongs with retention and
   privacy in phase 7, under its own name.
6. Add the per-attempt detail view.
7. **Write the marking test first**: saving a hand mark recomputes the total from the
   auto-scored part plus the marks, and moves `gradingState` to `complete`. Marking the
   same question twice replaces rather than adds. Then build the marking panel inside the
   detail view.

## Success criteria

- [ ] Opening the results list finalises expired attempts in the same request
- [ ] A teacher from an unrelated course is refused
- [ ] The list renders forty attempts without pagination complaints and four hundred
      without timing out
- [ ] Deleting requires a confirmation that names the student
- [ ] Nothing in this phase writes to `submission` or any gradebook table
- [ ] Status labels match the Vietnamese vocabulary above exactly
- [ ] Saving a hand mark recomputes the total and clears `awaiting_manual`
- [ ] Re-marking a question replaces the earlier mark rather than adding to it
- [ ] Reopening an expired attempt keeps its saved answers and records who granted it
- [ ] A reopened attempt is not immediately re-expired by the finaliser running in the same
      request
- [ ] Reopening a hand-marked paper returns it to `awaiting_manual` and flags the stale marks
- [ ] Clearing for a fresh sitting archives the previous attempt rather than merging two
      sittings into one answer trail

**Finalisation is batched and bounded.** The first read after a closing time may face every
attempt in the class needing to be scored at once, each requiring its answers and the
pinned paper — which collides with this phase's own performance criterion. Finalisation
therefore runs in bounded batches with `LIMIT … FOR UPDATE SKIP LOCKED`, calling the same
single finalisation function from phase 4. If a background trigger is ever wanted, it calls
that same function; there is never a second code path that finalises attempts differently.

## Risk assessment

**Finalisation inside a read.** A GET that writes is unusual and will surprise a reviewer.
It is deliberate — it is the mechanism that makes a closed tab harmless — and it must be
commented as such at the call site, or a later refactor will "fix" it into a pure read and
silently reintroduce the data loss.

**Similar names.** Deletion is irreversible and identity is a typed name, so two rows may
read identically. The confirmation must show enough to distinguish them: name, class,
score and submit time, not just the name.

**Reading the whole answer payload.** The results list must not select the `answers`
column; at four hundred attempts that is a large read for a table that shows a score. The
integration test should assert the list query does not select it.
