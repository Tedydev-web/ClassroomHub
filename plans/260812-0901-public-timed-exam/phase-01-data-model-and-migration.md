---
phase: 1
title: "Data model and migration"
status: pending
priority: P1
effort: "1d"
dependencies: []
---

# Phase 1: Data model and migration

## Overview

Two new tables, `exam` and `exam_attempt`, and nothing else. No column is added to any
existing table. This phase ends with a migration that applies cleanly and constraints that
provably hold.

## Requirements

Functional:

- An exam references the question container it delivers, and optionally a course.
- An exam carries every release-one setting, so no settings live on `exercise`.
- An attempt records who sat it — either a signed-in profile or a declared identity — when
  it started, when it expires, its status, its answers, and its score.
- An attempt's answers record the question revision each was given against.

Non-functional:

- Applying the migration to a copy of production must not lock any existing table for
  longer than it takes to create two new ones.
- Rolling the application back must leave the new tables readable and harmless.

## Architecture

```
exam
  id                uuid pk
  organizationId    uuid not null -> organization.id
  courseId          uuid null     -> course.id          -- an exam may stand alone
  exerciseId        uuid not null -> exercise.id        -- the question container
  title             text not null
  slug              varchar not null unique             -- random, not derived from title
  paperSnapshot     jsonb null                          -- frozen at publish; see below
  mode              exam_mode not null default 'private' -- 'public' | 'private'
  status            exam_status not null default 'draft' -- 'draft' | 'open' | 'closed'
  workingSeconds    integer null                        -- null means untimed
  opensAt           timestamptz null
  closesAt          timestamptz null
  maxAttempts       integer null                        -- null means unlimited
  passwordHash      text null
  requiresName      boolean not null default true
  requiresClass     boolean not null default false
  requiresCandidateNumber boolean not null default false
  scoreVisibility   exam_reveal not null default 'never'
  answerVisibility  exam_reveal not null default 'never'
  commentVisibility exam_reveal not null default 'never'
  revealThreshold   numeric null                        -- required by 'above_threshold'
  corrections       jsonb not null default '[]'         -- append-only; see phase 4
  createdBy         uuid not null -> profile.id
  deletedAt         timestamptz null                    -- soft delete; restorable
  createdAt/updatedAt timestamptz

exam_attempt
  id                uuid pk
  examId            uuid not null -> exam.id on delete cascade
  profileId         uuid null     -> profile.id         -- set in private mode
  displayName       varchar null                        -- set in public mode
  className         varchar null
  candidateNumber   varchar null
  tokenHash         text not null                       -- the resume cookie, hashed
  startedAt         timestamptz not null
  expiresAt         timestamptz null                    -- null when the exam is untimed
  submittedAt       timestamptz null
  status            attempt_status not null             -- 'in_progress' | 'submitted' | 'expired'
  gradingState      grading_state not null default 'complete'
                    -- 'complete' | 'awaiting_manual' | 'unscoreable'
                    -- 'unscoreable' is the home for an attempt grading cannot process;
                    -- without it, phase 4's "marked as needing attention" has nowhere to live
  answers           jsonb not null default '[]'         -- current state, what gets graded
  answerLog         jsonb not null default '[]'         -- append-only: {at, questionId, answerData}
  manualScores      jsonb not null default '{}'         -- questionId -> { score, comment }
  score             numeric null
  total             numeric null
  ipHash            text null
  userAgent         text null                           -- the request header, nothing more
  createdAt/updatedAt timestamptz
```

`exam_reveal` takes `never`, `on_submit`, `after_everyone`, `above_threshold`, mirroring
the four values a teacher already recognises from Azota's `Cho xem điểm`. `above_threshold`
needs a number to compare against, hence `revealThreshold`; it means
`gradingState = 'complete' AND score / total >= revealThreshold`, so a partially scored paper
awaiting a teacher's marks never trips the threshold on its automatic score alone.

`exam.exerciseId` is declared `ON DELETE RESTRICT`. A container must never disappear from
under an exam, including an exam that is only soft-deleted and could still be restored.

There are three of them because Azota treats the score and the teacher's written feedback as
independent — it ships a setting whose entire purpose is hiding the mark while leaving the
comments visible, which is exactly what a teacher wants when returning written work before
grades are official. Since hand-marking (phase 6) produces comments, the axis is real for us
too, and it costs one column.

The `answers` payload is an array of objects shaped
`{ questionId, questionRevisionId, answerData }`. Storing `questionRevisionId` per answer
is not optional: `questionAnswer.questionRevisionId` exists in the current schema and is
documented as "Immutable revision that was attempted". An exam answer that cannot say
which revision it answered is unscoreable the moment a question is edited.

**The paper is frozen at publish.** `paperSnapshot` holds, for every question in the paper,
its id, the revision delivered, and that revision's definition. This is not an optimisation;
it closes a hole that jsonb answers would otherwise open.

The archival machinery that protects revisions from deletion decides what has been
"attempted" by reading `questionAnswer` and nothing else — verified at
`packages/db/src/queries/exercise/revision.ts:244`, which selects distinct
`questionAnswer.questionId`. Exam answers live in jsonb, so they produce no such row. A
question answered only in exams therefore looks untouched, is hard-deleted when a teacher
edits the paper, takes its revisions with it by cascade, and leaves every
`questionRevisionId` in every stored exam answer pointing at nothing. Reviews break and
unfinalised attempts silently lose those questions.

Freezing the paper at publish means the exam no longer depends on those rows surviving. It
also removes the ambiguity of a paper edited mid-exam, where one student sat revision one
and the next sat revision two.

Teaching the archival query about `exam_attempt` was the alternative. It was rejected: it
would put a jsonb containment scan in the delete path and would make the exercise code aware
of exams, which is the coupling this whole design exists to avoid.

**The slug is a credential.** The link is the only gate on a public exam, so the slug must
be random and unguessable — at least twelve characters of entropy, never derived from the
title — and unique, which the current draft's plain `varchar` did not enforce. The
precedent in this schema is `course_slug_key`, a global unique index on course slugs.

The resume token is stored hashed, not raw, for the same reason session tokens are. The
cookie holds the raw value, and it is scoped per exam so a student sitting two papers does
not overwrite one attempt with the other.

## Related code files

- Modify: `packages/db/src/schema.ts` — append the two tables and three enums
- Create: `packages/db/src/migrations/NNNN_*.sql` — generated, never hand-written
- Create: `packages/db/src/queries/exam/exam.ts`
- Create: `packages/db/src/queries/exam/exam-attempt.ts`
- Create: `apps/api/src/services/exam/exam-schema-db.integration.test.ts`

The test lives in `apps/api`, not in `packages/db`. Verified: `packages/db` has no Vitest
configuration and contains zero test files, so a test placed there would never run. The
existing convention for database-backed tests is a `*-db.integration.test.ts` file under
`apps/api`, gated by an environment variable — `exam-import-db.integration.test.ts` is the
model to copy.

## Implementation steps

1. **Write the failing integration test first.** Against a real database:
   inserting two attempts for the same exam with the same declared name succeeds;
   deleting an exam cascades to its attempts; an attempt with neither a profile nor a
   declared name is rejected; an exam whose `exerciseId` does not exist is rejected; two
   exams cannot share a slug.
2. Add the enums and tables to `packages/db/src/schema.ts`.
3. Generate the migration with `pnpm --filter @cio/db db:generate`. Read the generated
   SQL before committing it — drizzle-kit occasionally proposes a destructive step when a
   name collides, and this is the moment to catch it.
4. Apply with `pnpm --filter @cio/db db:migrate` and make the test pass.
5. Add a check constraint enforcing that an attempt has either a `profileId` or a
   `displayName`, a unique index on `(examId, tokenHash)`, and a unique index on
   `exam.slug`.
6. Add the query helpers, each covered by the integration test.

## Success criteria

- [x] `pnpm --filter @cio/db db:generate` produces exactly one migration, containing only
      `CREATE TYPE` and `CREATE TABLE` statements
- [x] The generated SQL contains no `ALTER TABLE` against `exercise`, `submission`,
      `questionAnswer` or `groupmember`
- [x] The integration test passes against a real database
- [x] An attempt with neither identity is rejected by the database, not only by the code
- [x] Two exams cannot share a slug, enforced by the database
- [x] `pnpm --filter @cio/db db:setup` runs clean on an empty database

## Risk assessment

**The migration is generated, not written.** Drizzle compares the schema file to the
database and infers steps. If the schema file has drifted from production for unrelated
reasons, the generated migration may carry those unrelated changes. Mitigation: diff the
generated SQL and reject anything that touches a table this phase does not own.

**`db-migrate` runs on every deploy** as a one-shot service that blocks the API from
starting when it fails. A migration that fails halfway takes production down rather than
degrading it. Mitigation: rehearse against a restored dump before merging — the repository
already has `db:dump-backup` and `db:push-dump-to-new-db` for exactly this.

**Numeric score columns.** `numeric` avoids the floating-point comparison problems that
would otherwise appear in grade boundary tests. Do not substitute `real`.
