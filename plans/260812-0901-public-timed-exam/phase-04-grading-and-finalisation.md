---
phase: 4
title: "Grading and finalisation"
status: pending
priority: P1
effort: "2d"
dependencies: [3]
---

# Phase 4: Grading and finalisation

## Overview

An attempt gets a score, and an attempt nobody ever submitted still gets one. This is the
phase that makes "the student closed the tab" a non-event.

## Requirements

Functional:

- Submitting scores the attempt from its saved answers.
- An attempt past its expiry that was never submitted is finalised the first time anyone
  reads it, from whatever was saved.
- A blank or partial paper scores what it earned, rather than failing.
- One unscoreable attempt never prevents the others from being read.

Non-functional:

- Scoring reuses the existing engine rather than reimplementing it.
- Finalisation is idempotent and safe under concurrent reads.

## Architecture

**The grading path is two functions, not one.** The first draft of this plan called
`prepareSubmissionAnswers` the grading engine. It is not. Verified: it returns
`{ answers, answerByQuestionId, questionById }` and computes no score
(`apps/api/src/services/submission/submission-answer-processing.ts:253`). Scoring lives in
`packages/question-types/src/question-scoring.ts` — `scoreAnswerForQuestion` at line 352 and
`scoreSubmissionAnswers` at line 405 — with `scoreAssessmentVerticalSlice` handling
canonical assessment items.

So the exam path is: normalise with `prepareSubmissionAnswers`, then score with
`scoreSubmissionAnswers`.

**`prepareSubmissionAnswers` throws.** It raises `AppError` in at least five places,
including for a required question with no answer and for an answer referencing a question
outside the paper. An exam attempt is unfinished by definition — that is the whole point of
finalising an abandoned paper — so calling it with raw attempt answers would throw on
exactly the papers this phase exists to rescue.

The exam grading wrapper therefore, before calling it:

- drops answers for questions not in the pinned paper;
- relaxes the required-question rule, since an unanswered required question in an exam is a
  zero, not a validation error.

**Grading against the pinned paper.** Phase 1 stores a snapshot of the paper on the exam at
publish time: for every question, the revision and the definition delivered. Grading reads
that snapshot, never the current revision. This is what makes a teacher's later edit unable
to change scores retroactively, and it is why the revision on each stored answer is
assigned by the server from the snapshot and never accepted from the client — a client that
chooses its own revision chooses the answer key it is marked against.

**Correcting a wrong key after the fact.** Freezing the paper stops an edit from silently
moving scores. It also, left alone, removes the teacher's only route to fixing a key they got
wrong: the paper is frozen, so correcting the question changes nothing for anyone who already
sat it.

That is not hypothetical here. The `.docx` import shipped a paper with seventeen of forty
answer keys missing earlier this year. A teacher who discovers a wrong key after a class has
sat the paper needs a remedy, and the freeze must block the accidental change without
blocking the deliberate one.

There are **two** remedies, and they are not interchangeable:

**The question is broken** — ambiguous, or no option is defensible. Azota's `Tính năng hưởng
điểm`: the teacher marks it and "hệ thống sẽ ghi nhận điểm của câu hỏi đó cho toàn bộ học
sinh". Everyone gets the marks regardless of what they answered.

**The key was simply wrong** — the question is fine, the wrong option was recorded as
correct. Here awarding the marks to everyone is unjust to the students who answered
correctly. What is wanted is a re-score against the corrected key. Azota does this
automatically: "Hệ thống sẽ tự động cập nhật lại điểm khi giáo viên thao tác sửa đáp án ở đề
gốc."

This is the commoner case for us, because our import failure produces missing or wrong keys
rather than broken questions. An earlier draft of this phase offered only the first remedy,
which would have left the frequent case unserved.

We take both, but neither silently. Azota re-scores on any key edit; we require the teacher to
say so, because a frozen paper whose scores move on their own is the failure the freeze exists
to prevent.

**Corrections are data, not a sweep.** The obvious implementation — "go and re-score every
attempt now" — is wrong here, because lazy finalisation means attempts finalise for days
afterwards. An attempt still in progress when the correction lands would either be skipped by
the sweep and later finalised in ignorance of it, or written to while unfinished. Either way
some students are marked against a key their classmates were not.

So a correction is an append-only record on the exam —
`{ kind: 'award' | 'keyFix', questionId, previousKey, correctedKey, by, at }` — and the
grading function is defined over the paper **plus** its corrections:

```
grade(paperSnapshot ⊕ corrections, answers)
```

Everything follows from that. Re-scoring is only re-running the same function over attempts
that have finished. An attempt finalised next week picks the correction up without anyone
remembering to include it. The snapshot stays genuinely immutable, so `previousKey` survives
and the correction can be explained or undone. And there is one grading path, not two.

Corrections may only touch the answer key — which option is correct, which short answers are
accepted. They never alter delivered content, because the student has already seen that.

This is also why the choice is defensible rather than merely different from Azota's. They
re-score automatically and compensate with an edit history shown to students; transparency is
their fallback for a weaker invariant. Ours keeps the strong invariant *and* the audit trail.

**One function owns the total.** `scoreSubmissionAnswers` gives a question that cannot be
auto-scored zero points and leaves it out of the total entirely — verified at
`packages/question-types/src/question-scoring.ts:412-425`. So a paper with hand-marked
questions has two sources of marks, and if re-scoring only calls the automatic scorer it will
quietly overwrite a total that a teacher had already completed by hand, leaving
`gradingState` at `complete` so nothing signals the loss.

The total is therefore computed in exactly one place:

```
total = autoScore(paperSnapshot ⊕ corrections, answers) + Σ manualScores
```

Every path that produces a total — submit, lazy finalisation, a correction, saving a mark —
calls that one function. None of them computes a total any other way.

**Lazy finalisation.** No scheduled job. When a read path loads an attempt whose `expiresAt`
has passed while `status` is still `in_progress`, it finalises first, in a transaction,
guarded so a concurrent read cannot double-score:

```sql
UPDATE exam_attempt
   SET status = 'expired', submitted_at = expires_at, score = $1, total = $2
 WHERE id = $3 AND status = 'in_progress'
```

The `AND status = 'in_progress'` is the guard. Under Postgres' default READ COMMITTED, the
second writer re-evaluates the predicate after waiting for the lock and updates zero rows.
This deployment is a single Postgres instance behind Coolify, so there is no replica for a
write-during-read to be routed away from.

`submittedAt` is set to `expiresAt`, not to the moment of finalisation, so a paper read
three days later does not claim it was submitted three days late.

**One poisoned attempt must not poison the page.** Finalisation is wrapped per attempt. An
attempt that cannot be scored is marked as needing attention and reported in its row; it
never propagates an exception up into the results request. Without this, a single
malformed attempt makes the whole class's results page return 500, permanently, at the
moment the teacher most needs it.

## Related code files

- Create: `apps/api/src/services/exam/exam-grading.ts`
- Create: `apps/api/src/services/exam/exam-grading.test.ts`
- Create: `apps/api/src/services/exam/exam-finalisation.ts`
- Create: `apps/api/src/services/exam/exam-finalisation.integration.test.ts`
- Reference, do not modify:
  `apps/api/src/services/submission/submission-answer-processing.ts`,
  `packages/question-types/src/question-scoring.ts`

## Implementation steps

1. **Write the poisoned-attempt test first.** Store an attempt whose answers reference a
   question outside the paper, then read the results list. The list renders, that attempt
   is flagged, and every other attempt is scored. This is the failure chain the red-team
   pass identified as the most likely way this ships broken.
2. **Write the revision test.** Sit an attempt, edit the question so a different option is
   correct, then finalise. The score reflects the revision that was sat. If grading reads
   the current revision this fails, and nothing else will catch it.
3. Write the grading unit tests: a blank paper scores zero; a partial paper scores what it
   earned; an unanswered required question is a zero rather than an error; an answer to a
   removed question is ignored.
4. Implement the grading wrapper — filter, relax, `prepareSubmissionAnswers`,
   `scoreSubmissionAnswers` — against those tests.
5. Write the finalisation integration test: an attempt left `in_progress` past expiry, read
   twice concurrently, ends `expired` with one score and `submittedAt = expiresAt`.
6. Implement lazy finalisation with the guarded update and per-attempt isolation.
7. Implement partial scoring for papers containing questions that cannot be auto-scored:
   score everything scoreable, leave the rest to a teacher, and set
   `gradingState = 'awaiting_manual'`. `isExerciseAutoGradable`
   (`packages/question-types/src/question-scoring.ts:60`) identifies them. The score shown
   before marking must state what it covers — "8/10 câu trắc nghiệm" — never a bare number
   that reads as a final grade.

## Success criteria

- [x] A blank paper scores zero; no exception escapes grading for any attempt state
- [x] An attempt referencing a question outside the paper is flagged, and the other
      attempts in the same request are still scored and rendered
- [x] An attempt is scored against the revision it was sat against, proven by a test that
      edits the question between sitting and grading
- [x] An expired, unsubmitted attempt is scored from its saved answers on first read
- [x] Concurrent finalisation produces one score, not two
- [x] `submittedAt` equals `expiresAt` for a finalised attempt, not the read time
- [x] A paper mixing auto-scoreable and hand-marked questions scores the first kind, sets
      `gradingState = 'awaiting_manual'`, and never presents its partial score as final
- [x] Awarding a faulty question to everyone re-scores every attempt of that exam, including
      ones already finalised, and leaves a record of the correction on the exam
- [x] Correcting a wrong key re-scores every attempt against the corrected key, so a student
      who answered correctly gains and one who did not does not, and the frozen snapshot is
      updated for that question only
- [x] Neither correction happens as a side effect of editing the paper; both require the
      teacher to ask for it
- [x] An attempt still in progress when a correction lands is scored with that correction when
      it finalises later, without anyone re-running anything
- [x] Re-scoring a paper that has hand-marked questions preserves the marks: the total is the
      automatic score plus the marks, never the automatic score alone
- [x] A correction records the previous key, so it can be explained and undone

## Risk assessment

**Calling the normaliser as if it were the grader.** This was wrong in the first draft and
would have produced a feature that throws on precisely the abandoned papers it exists to
rescue. The blank-paper test is the guard.

**Grading the current revision.** Invisible until a teacher edits a question after some
students have sat the paper, at which point scores change retroactively and nobody knows
why. The pinned snapshot plus the revision test prevent it.

**Double finalisation.** Without the status guard, two concurrent reads both compute and
both write; the symptom is a score that changes between page loads.

**Coupling to the scoring engine.** If the in-progress `20260716-native-assessment-interactions`
plan changes `scoreSubmissionAnswers`, exam scores change with it. That is the intended
coupling — one scoring engine — but exam tests must run in that plan's CI, not only ours.
