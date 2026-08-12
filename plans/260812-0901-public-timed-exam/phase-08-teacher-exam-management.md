---
phase: 8
title: "Teacher exam management"
status: pending
priority: P1
effort: "2d"
dependencies: [2]
---

# Phase 8: Teacher exam management

> Execution order: this runs after phase 2 and before phase 6. It is numbered 8 only
> because it was added after the first draft, when the red-team pass found that the plan
> described an API with no way for a teacher to reach it.

## Overview

Everything the teacher touches before students arrive: creating an exam from a paper,
configuring it, opening and closing it, listing exams, and copying the link. Without this
phase the feature is API-complete and unusable.

## Requirements

Functional:

- Create an exam from a `.docx` import or by duplicating an existing exercise.
- Configure every release-one setting.
- Open and close an exam; copy its link.
- List the exams in a course or organisation.
- Delete an exam. Soft, restorable, and it never touches the container.

Non-functional:

- Vietnamese copy throughout, using the vocabulary from the standardisation report.
- The settings form refuses configurations that cannot work, rather than saving them.

## Architecture

**Where an exam's questions come from.** An exam delivers a container: an `exercise` row
with `courseId` and `lessonId` both null. Creating an exam either imports a `.docx`
straight into a fresh container, or duplicates an existing exercise's questions into one.

Duplication rather than pointing at the live exercise is deliberate. If an exam delivered
a working exercise directly, then editing that exercise mid-exam would change the paper
underneath the students sitting it, and enrolled students could open the same questions as
an ordinary exercise and bypass the clock entirely.

**One paper, many sittings.** A container may back several exams. Azota separates the paper
from its administrations — one `đề thi` is given to many classes, many times — and that is
the right shape: giving the same paper to 12A1 on Monday and 12A2 on Tuesday, with
different windows, must not require duplicating the questions.

Because each exam freezes its own snapshot at publish, two sittings of the same container can
legitimately hold different frozen papers if it was edited in between — which is correct, not
a bug.

**Deleting is reversible, and never reaches the container.** Azota soft-deletes papers and
offers `Khôi phục đề đã xóa`. An exam holds student work that exists nowhere else, identified
only by a typed name, so a mistaken delete is unrecoverable in a way an exercise's is not.

An earlier draft said deleting the last exam over a container removed the container too. That
was incoherent with soft delete: a soft-deleted exam still references its container, so either
the foreign key refuses and the operation fails, or the removal cascades and takes the
soft-deleted exam and every one of its attempts with it — turning a reversible delete into a
silent, permanent one and breaking the promise that restoring an exam restores its work.

So deleting an exam marks it deleted and stops. `exam.exerciseId` is `ON DELETE RESTRICT`.
Reclaiming a container that no live or restorable exam references belongs with pruning in
phase 7, where retention already lives.

**Checking the paper before sending it.** Azota's `Thông tin đề` reports the paper's
structure after saving and before giving it out: how many questions, how many of each kind,
how many options each carries, and which lack an explanation.

This is worth more to us than to Azota. The `.docx` import silently produced a paper with
seventeen of forty answer keys missing earlier this year; a structure summary shown before
the link is sent would have caught it in seconds. The publish screen therefore shows the
same summary and refuses nothing — it is a mirror, not a gate.

**Why the container is invisible.** Verified: the three paths that would surface it all
filter on the course, and a container satisfies none of them with both fields null —
`getExercisesByCourseId` (`packages/db/src/queries/exercise/exercise.ts:121`) matches
`or(exercise.courseId, lesson.courseId)`; the gradebook query in
`packages/db/src/queries/mark/mark.ts` joins the course the same way and applies no
visibility filter at all; the learner listing in
`packages/db/src/queries/exercise/lms.ts:75` matches `exercise.courseId`.

As a second line of defence the container is also created with
`assignmentMode = 'SELECTED_STUDENTS'` and no assignment rows, which
`getExerciseVisibilityCondition` (`packages/db/src/queries/exercise/assignment.ts:17`)
turns into a student-side exclusion even if some future query matches it another way.

**Settings validation, server-side.** `after_everyone` requires both a closing time and a
working time.

A paper containing questions a teacher must read by hand is allowed. It is flagged at
publish time — using `isExerciseAutoGradable`
(`packages/question-types/src/question-scoring.ts:60`) — so the teacher is told before
sending the link that those questions will need marking, and so that `Cho xem điểm` set to
`on_submit` warns that the score a student sees will be partial until it is marked.

An exam always belongs to a course. The `courseId` column stays nullable so a standalone
exam becomes possible later without a migration, but nothing in this release creates one.

## Related code files

- Create: `apps/dashboard/src/routes/(app)/courses/[id]/exams/+page.svelte`
- Create: `apps/dashboard/src/routes/(app)/courses/[id]/exams/new/+page.svelte`
- Create: `apps/dashboard/src/lib/features/exam/exam-settings-form.svelte`
- Create: `apps/dashboard/src/lib/features/exam/exam-link-copy.svelte`
- Create: `apps/api/src/services/exam/exam-container.ts`
- Create: `apps/api/src/services/exam/exam-container.integration.test.ts`
- Modify: `apps/dashboard/src/lib/utils/translations/*.json`
- Modify: `apps/api/src/services/exam-import/exam-import.ts` — importing straight into a
  container needs a course-less variant; today line 599 hardcodes `courseId: scope.courseId`,
  which is precisely the field that must be null for a container to stay invisible

## Implementation steps

1. **Write the invisibility integration test first**, because it is the assumption the
   whole isolation argument rests on and the first draft of this plan got it wrong. Create
   a container, enrol a student, then assert the container appears in none of:
   the course exercise list, the learner exercise list, or the gradebook query.
2. Write the settings validation tests: `after_everyone` without a closing time is
   refused; a paper containing hand-marked questions publishes but is flagged, naming
   those questions.
3. Implement container creation, with both fields null and the assignment mode set.
4. Build the exam list and the create flow.
5. Build the settings form against the validation above.
6. Build the paper summary shown before publishing: question count, counts by kind, options
   per question, and questions with no correct answer recorded. That last one is the check
   the `.docx` import needed.
7. **Write the shared-container test**: two exams over one container; deleting either leaves
   the container and the other exam intact; restoring a deleted exam restores its attempts;
   the container is never removed by an exam delete.
8. Implement open, close, link copy, and soft delete with restore. **Opening writes
   `paperSnapshot`** — an exam may not leave `draft` without one, since every later guarantee
   about immutability, revision pinning and grading rests on it existing.
9. Add the correction prompt: editing a question whose container backs a published exam with
   attempts shows the teacher which exams are affected and links to the correction controls.
   Without it, "corrections are explicit" becomes "corrections are undiscoverable" — a teacher
   arriving from Azota expects editing the key to be enough, and here it silently is not.

## Success criteria

- [ ] A container appears in none of the three listing paths, proven against a real
      database with a real enrolled student
- [ ] A teacher can go from a `.docx` file to a shareable exam link without touching the API
- [ ] `after_everyone` cannot be saved without a closing time and a working time
- [ ] Publishing a paper with hand-marked questions warns the teacher and names them
- [ ] The pre-publish summary reports any question carrying no correct answer
- [ ] Two exams may share a container; deleting one leaves the other working, and no exam
      delete ever removes a container
- [ ] An exam cannot leave `draft` without a frozen paper
- [ ] Saving `on_submit` answer visibility together with more than one permitted attempt is
      refused, and `on_submit` while the window is still open warns that an early finisher can
      pass the answers to a classmate still sitting
- [ ] Editing a question that backs a published exam tells the teacher which exams are
      affected and how to correct them
- [ ] Every teacher-facing string is translated

Two criteria belong to work that lands later and are re-verified after phase 6: that restoring
an exam restores its attempts, and that the delete confirmation reports how many attempts are
in progress. Neither can be checked while phase 8 runs third.

## Risk assessment

**The invisibility claim was wrong once already.** The first draft asserted containers were
invisible because listings filter by lesson, which is true of one listing function and
false of the one actually used. The test in step 1 exists because reasoning about this
produced a confident wrong answer, and only reading the query settled it.

**The gradebook applies no visibility filter.** Even with the assignment-mode defence, a
container that somehow acquired a `courseId` would appear in a teacher's gradebook. Nulling
the course is what actually keeps it out; the assignment mode is the backup, not the fix.

**Deleting an exam mid-sitting.** Attempts cascade, so a teacher deleting an exam while
students are sitting it destroys their work with no warning. The confirmation must say how
many attempts are in progress.
