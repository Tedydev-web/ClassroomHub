---
phase: 2
title: "Exam settings and sanitised delivery"
status: pending
priority: P1
effort: "2d"
dependencies: [1]
---

# Phase 2: Exam settings and sanitised delivery

# Overview

The teacher can create an exam from an existing question container and configure it, and
the server can produce the version of a paper that is safe to hand a student who is being
scored. This phase ships before any clock exists, because the ordering is the whole point.

## Requirements

Functional:

- Create, read, update and delete an exam, restricted to course team members or
  organisation admins.
- Serve the paper for sitting, with no answer key in the payload.
- Serve the paper with answers for review, gated on the exam's `answerVisibility` and the
  state of the requesting attempt.

Non-functional:

- The existing public-course payload keeps its answer keys and its tests keep passing.
- The sanitised serializer is a pure function, so its guarantee is unit testable without a
  database or an HTTP layer.

## Architecture

The current public path builds its payload in
`apps/api/src/services/course/public-course.ts`, which emits `isCorrect` at line 233 and is
documented as doing so deliberately, because public courses grade in the browser. That
behaviour stays.

The exam path gets its own serializer, and it does **not** read the live question rows. It is
a pure function over the exam's frozen `paperSnapshot`, producing a payload with the answer
key removed at the source rather than filtered on the way out. The distinction matters twice:
a filter can be bypassed by a new call site, and a serializer that never reads the field
cannot leak it.

Reading live rows here would undo the freeze. A container may be edited after an exam over it
is published — phase 8 permits exactly that, since a container can back several exams — and a
serializer reading live rows would then hand a sitting student a question the server pins to a
different revision. Their save would be refused as outside the pinned paper, mid-exam. The
live rows are read once, when the paper is frozen at publish, and never again for delivery.

```
getExamPaperForSitting(examId)   -> questions, options, no isCorrect, no explanation
getExamPaperForReview(attemptId) -> questions, options, isCorrect, the sitter's answers
```

Reveal policy, evaluated server-side, never in the browser. The same four values govern
three independent things — the score, the paper with its answers, and the teacher's written
comments — because a teacher returning marked work often wants the feedback visible while
the mark is not:

| Value | The governed thing is released when |
|---|---|
| `never` | never |
| `on_submit` | the attempt is submitted or expired |
| `after_everyone` | now is past `closesAt + workingSeconds` |
| `above_threshold` | the attempt is finished and scored at or above the threshold |

`after_everyone` is only meaningful when both `closesAt` and `workingSeconds` are set. The
server refuses to store that combination without them; the form that surfaces the refusal
is built in phase 8. This is the failure mode Azota's own documentation warns about for the
same option.

**The routes ship behind a flag.** A merge to `main` deploys, so a public route exists the
moment it is merged, and the abuse limits of phase 7 land later. The exam router is
therefore gated on an environment flag, off by default, following the existing
`EXAM_IMPORT_ENABLED` precedent. "Do not enable this until phase 7" is otherwise a note in
a document with nothing enforcing it.

## Related code files

- Create: `apps/api/src/services/exam/exam.ts`
- Create: `apps/api/src/services/exam/exam-paper-serializer.ts`
- Create: `apps/api/src/services/exam/exam-paper-serializer.test.ts`
- Create: `apps/api/src/services/exam/exam-reveal-policy.ts`
- Create: `apps/api/src/services/exam/exam-reveal-policy.test.ts`
- Create: `apps/api/src/routes/exam/exam.ts`
- Modify: `apps/api/src/app.ts` — register the router beside the others near line 239
- Reference, do not modify: `apps/api/src/services/course/public-course.ts`
- Reference, do not modify: `apps/api/src/services/exercise/utils.ts` (`transformQuestions`)

## Implementation steps

1. **Write the leak test first, and make it structural.** Serialise a paper whose options
   include a correct one, then assert on the serialised value that no key named
   `isCorrect` appears anywhere at any depth, by walking the object rather than by
   checking the fields you remembered to check. A test that lists fields will pass forever
   while a new field leaks beside it.
2. Write the reveal-policy table as a unit test with one case per row above, including the
   `after_everyone` case with a missing `closesAt`, which must resolve to "not yet" rather
   than to "now".
3. Implement the serializer and the policy against those tests.
4. Add the exam CRUD service and route, reusing `courseTeamMemberMiddleware` for
   authorisation. An exam whose exercise belongs to a different organisation is rejected.
5. Add the guard test: `apps/api/src/services/course/public-course.test.ts` runs
   unmodified and still asserts `isCorrect` is present.

## Success criteria

- [x] Deep structural assertion proves the sitting payload contains no `isCorrect` at any
      depth
- [x] Every row of the reveal-policy table has a passing test, including the degenerate
      `after_everyone` configuration
- [x] The existing public-course test file is untouched by this phase and still passes
- [x] Creating an exam against another organisation's exercise is refused
- [x] The server refuses to store `after_everyone` without both a closing time and a
      working time
- [x] Every exam route returns 404 when the environment flag is off
- [x] Editing the container after publish leaves the sitting payload byte-identical, proving
      delivery reads the frozen paper and not the live rows

## Risk assessment

**The leak is the entire security property of this feature.** Everything else can be got
wrong and fixed later; this one is unrecoverable, because a leaked paper cannot be
un-leaked from the students who already read it. That is why the test is structural and
why this phase precedes the clock.

**Two serializers can drift.** The exam serializer and the public-course serializer will
read the same tables and will diverge over time. Accept the duplication rather than
sharing a serializer with a boolean flag: a flag means one wrong argument leaks the paper,
and flags default to the unsafe value under pressure.

**Password storage.** The paper password is a low-value secret shared with a whole class,
but it is still a secret. Hash it with the same primitive the codebase already uses for
credentials; do not store it in plain text on the grounds that it is only a classroom
password.
