# Public timed exam: standardised workflow

Date: 2026-08-12. Status: accepted direction, not yet planned or built.

Reference system: Azota (`docs.azota.vn`), the de facto tool for Vietnamese
secondary-school teachers. Every quoted Vietnamese label below is taken verbatim from
its documentation, so our configuration screen speaks a vocabulary teachers already know.

## Contract

**Outcome.** A teacher publishes an exercise as a link, sends it to a class, and sees a
list of who sat it, how far they got, and what they scored — without any student holding
an account.

**Constraints.**

- Grading must happen on the server. Answer keys cannot reach the browser of a student
  who is being scored.
- The clock must be server-authoritative. A refresh, a changed device clock, or devtools
  must not buy time.
- Existing public courses must keep working unchanged, including their client-side
  grading and the tests that assert it.
- Identity is a typed name. The design must not imply an integrity guarantee it cannot
  deliver.

**Non-goals for the first release.** Per-student one-time links, a class roster, a live
teacher-hosted room, camera or screen-recording proctoring, essay grading for guests,
merging guest results into the course gradebook.

**Acceptance criteria.**

- A student who refreshes mid-exam keeps their remaining time and their saved answers.
- A student who closes the tab at the last minute still has a score visible to the teacher.
- Viewing source or devtools on the exam page reveals no answer key.
- Existing public-course behaviour and its test suite are untouched.

## What Azota's own product split confirms

Azota divides the same territory three ways, and the division validates the line we drew.

`Bài tập` is for work a teacher reads: "bài tự luận, bài viết, hình ảnh, file tài liệu hoặc
sản phẩm học tập cần thầy cô xem và đánh giá trực tiếp". `Đề thi` is for structured papers:
"bài kiểm tra có cấu trúc câu hỏi, đáp án, chia điểm, giới hạn thời gian và chấm tự động".
`Thi Online` is neither — it is how a `Đề thi` is administered. Their own overview states it
plainly: a test is the content, online testing is how it is given.

That is exactly the content-versus-delivery split this plan makes. One further consequence
we had missed: in Azota one paper is given to many classes, many times. A container must
therefore be able to back several exams, and deleting one exam must not take the paper with
it.

Their homework surface has no counterpart here and is out of scope. The feature that looked
closest to this brief — assigning work with no account and no class list — lives on that
homework side, not on the exam side.

## Where the line between exercise and exam falls

An exam is a separate thing from an exercise, and the separation is in **delivery**, not
in **content**.

Separate: the exam itself, its settings, who sat it, their attempts, their results, and
the teacher's view of them. New `exam` and `exam_attempt` tables. Nothing in the existing
exercise, submission, gradebook, progress or certificate paths changes or learns that
exams exist.

Shared: the questions. `question.exerciseId` is the only ownership path a question has,
and `questionRevision` hangs off `question`. An exam therefore points at an exercise row
used purely as a question container. This is not a workaround — in this schema `exercise`
*is* the question-set primitive, and the `.docx` import already creates containers exactly
this way: `createExerciseFromAuthoringPlan` is called with only a title and a course, with
no lesson attached, so the row never enters the syllabus, which lists exercises by lesson.

The alternative — giving exams their own question tables — would mean rewriting the exam
import pipeline, the authoring surface, and the renderer's data mapping. The `.docx`
import is the most valuable thing in this area and it would be the first casualty.

**Acknowledged debt.** `exercise` doing double duty as a question set is the compromise
here. The clean shape is a first-class question set with `question.questionSetId`, leaving
`exercise` as one consumer among several. That migration touches the most central table in
the schema, so it is deliberately deferred, not overlooked.

**Consequence to accept.** Because exams never write to `submission`, an exam score does
not reach the gradebook, course completion, or certificates. That is the point of the
clean cut, but it is a real limitation: a private exam is not a graded course assessment
until someone deliberately builds a bridge between the two.

### Private and public exams

The same exam entity serves both. In private mode a sitter is an authenticated student and
the attempt records their profile. In public mode a sitter is anonymous and the attempt
records the declared name, class and candidate number. One table, one nullable identity
column each way, one delivery pipeline.

Exercises are unaffected: they continue to require an account and to record progress
exactly as they do today.

## Why guests do not become course members

`submission.submittedBy` is a foreign key to `groupmember.id`, and `groupmember.profileId`
is nullable, so a member without an account is representable. It is still the wrong home
for a guest, for four verified reasons:

1. `groupmember` has no name column. The name a student types has nowhere to live.
2. `submission.ts:1671` dereferences `groupmember.profile.email` and `.profile.fullname`
   when sending the graded-submission email. A guest has no profile.
3. `completion.ts` awards certificates by `groupMemberId`. A guest scoring well would
   enter the certificate path.
4. `people.ts` requires `profileId` or `email` on add, and the same path fires the
   member-added webhook, the welcome email, and compliance enrolment.

Reusing the table would mean reusing behaviour we specifically need to suppress, and every
future feature would have to remember guests exist.

What is reused instead is the grading itself: `prepareSubmissionAnswers` is a pure
function over question definitions and answer payloads, with no database access anywhere
in its file.

## The configuration surface

Modelled on Azota's exam settings. Only the first group is required for release one.

### Release one

| Setting | Azota's label | Values | Note |
|---|---|---|---|
| Who may sit it | `Ai được phép làm` | Everyone without signing in / enrolled students only | The switch that turns an exercise into a public exam |
| Working time | `Thời gian làm bài` | Minutes; `0` means no limit | Per student, counted from when they open the paper |
| Availability window | `Thời gian giao đề` | Opens at / closes at | A student may only enter between these |
| Attempts | `Số lượt làm đề` | `0` means unlimited | |
| Paper password | `Mật khẩu đề thi` | Optional | The cheapest integrity gate available when identity is a name |
| Declared details | `Khai báo thông tin bổ sung` | Full name, class, candidate number | Required before the paper opens |
| Score visibility | `Cho xem điểm` | Never / on submit / once everyone has finished / above a threshold | |
| Paper and answer visibility | `Cho xem đề và đáp án` | Never / on submit / once everyone has finished / above a threshold | How answer keys are released, by policy, after the fact |

### Later, in rough priority order

Screen-exit monitoring (`Giám sát thoát màn hình`), question and option shuffling
(`Đảo câu hỏi và đáp án`), practice mode (`Cấu hình luyện tập`), random selection by
blueprint (`Lấy ngẫu nhiên theo ma trận đề`), Excel export, per-question statistics.

## Timing rules

Azota's stated rule is that the exam clock equals the moment the student opens the paper
plus the working time. So:

```
expiresAt = min(startedAt + workingTime, closesAt)
```

A student entering ten minutes before the window closes gets ten minutes, not the full
duration. When working time is `0`, `expiresAt` is `closesAt`; when there is no window,
it is `startedAt + workingTime`; when neither is set, the attempt does not expire.

Answers are accepted until `expiresAt` plus a short grace period, around thirty seconds,
so a slow final request on a phone network is not punished. After that they are rejected.

The client counts down for display only. It also attempts to submit when it reaches zero,
but that is the convenience path, never the mechanism of record.

An expired attempt that was never submitted is finalised from its autosaved answers the
first time anyone reads it. No background sweeper is needed until a teacher wants a live
dashboard.

`Cho xem đề và đáp án` set to "once everyone has finished" only makes sense when both a
working time and a window exist, because the release moment is `closesAt + workingTime`.
The interface should say so rather than silently doing nothing.

## Attempt states

Teachers expect the vocabulary Azota's filters use: has not sat it
(`chưa thi`), sitting it now (`đang thi`), entered but has not submitted
(`chưa nộp bài`), submitted, and graded. Our stored status should map onto those words
directly, since that is what the results screen will be read against.

## Monitoring, stated honestly

Azota records when a student leaves the exam screen or switches tab, along with their
device and browser, shows it to the teacher only after submission, and explicitly does not
block, lock, or force submission. That is the right promise: record, surface, let a human
judge. We should copy both the behaviour and the honesty about its limits.

## What identity by name cannot do

Two students may type the same name. One student may open a private window and get a
fresh clock. An httpOnly attempt cookie stops a refresh from restarting the timer; it does
not stop a new browser profile. This is inherent, not an implementation gap.

The mitigations worth having are cheap and partial: the paper password, a cap on attempts,
and surfacing duplicate names or repeated network fingerprints for the teacher to judge.
The real fix is per-student links against a class roster, which belongs to a later release
because it requires the teacher to enter the class first.

A public endpoint that writes to the database also needs a per-address rate limit, a
ceiling on attempts per paper, and a bound on the length of submitted names and payloads.

## Personal data

Names, classes and candidate numbers of minors, collected through an unauthenticated
endpoint. The teacher needs a delete control — Azota has `Xóa bài thi của học sinh` — and
the records need a retention limit.

## First slice

1. Migration: an `exam` table carrying the release-one settings and pointing at its
   question container, plus an `exam_attempt` table. No column is added to `exercise`.
2. Endpoints to start an attempt, autosave answers, and submit, with the exam payload
   served by a separate serializer that omits answer keys. Grading through
   `prepareSubmissionAnswers`.
3. Student flow: declare details, sit the paper, see the countdown, submit.
4. Teacher results tab, with delete.

The order matters in one place: the sanitised payload ships before the timer does. A timed
paper that leaks its answer key is theatre.

## Open questions

- Essay questions for guests: mark the attempt as awaiting manual grading, or exclude
  essay papers from public exams in release one?
- Should guest results be promotable into the course gradebook for a named student later,
  or stay a separate record permanently?
- Is the paper password wanted for the first release, or is the link itself the only gate?
