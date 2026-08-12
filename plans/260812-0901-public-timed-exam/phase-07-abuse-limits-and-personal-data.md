---
phase: 7
title: "Abuse limits and personal data"
status: pending
priority: P1
effort: "1d"
dependencies: [3]
---

# Phase 7: Abuse limits and personal data

## Overview

The exam endpoints let an unauthenticated caller write to the database and store the names
of children. This phase bounds both. It is priority P1 despite being last: the feature must
not be enabled for a real class until it lands.

## Requirements

Functional:

- Per-address rate limits on start, save and submit, tighter than the global default.
- A ceiling on total attempts per exam, independent of the per-sitter `maxAttempts`.
- Duplicate sitters surfaced to the teacher rather than blocked.
- A retention limit on attempts, and the teacher delete from phase 6.

Field length bounds and payload validation are **not** in this phase. They moved to phase
3, where the endpoints are defined, because validating what an anonymous caller may write
is part of an endpoint's contract rather than hardening applied afterwards — and because
storing an invalid answer creates an attempt that phase 4 can never score.

Non-functional:

- Limits must not fire for a legitimate class of forty sitting at once from one school's
  network address.

## Architecture

`apps/api/src/middlewares/rate-limiter.ts` already exports `createRateLimiter`, taking
`windowMs`, `maxRequests`, `keyGenerator`, and `skip`. A global limiter is already applied
at `.use('*', rateLimiter)` in `apps/api/src/app.ts`, keyed by user — which is useless for
anonymous callers, since they are all the same non-user.

The exam endpoints therefore take their own limiter with an address-based key generator.
The limits differ per endpoint because the traffic differs:

| Endpoint | Shape of legitimate traffic | Limit |
|---|---|---|
| start | once per sitter | strict, per address |
| save | every few seconds per sitter, for the length of the exam | generous |
| submit | once per sitter | strict, per address |

**The school-network problem.** Forty students in one room share one public address. A
naive per-address limit on `start` locks out the back of the class. The key must therefore
combine address and exam, and the ceiling must be set against a realistic class starting
together — a burst of forty in a minute is normal, four hundred is not. This is the
constraint that makes the obvious limit wrong, and it is why the limits are per endpoint
rather than one number.

**Duplicates are surfaced, not blocked.** Two sitters may legitimately share a name.
Blocking the second is worse than showing the teacher both. The results list flags attempts
sharing a name, or sharing an address hash, and lets a human decide.

**Personal data.** What an attempt holds about a minor, in full: the declared name, class and
candidate number; the answers and the record of how they changed; a salted `ipHash`, never a
stored address, which exists to spot duplicates rather than to identify anyone; and the
`User-Agent` header of the requests that sat the paper.

The retention note must enumerate all of it. Undocumented capture is the liability, not the
capture: every one of these fields lives on the attempt row, so the pruning script, the
teacher's clearing action, and the exam cascade already remove them together, and none of it
is fingerprinting — no canvas, no font enumeration, no hardware probing, nothing beyond what
an ordinary server log holds.

## Related code files

- Modify: `apps/api/src/routes/exam/exam.ts` — attach the per-endpoint limiters
- Create: `apps/api/src/services/exam/exam-abuse-limits.ts`
- Create: `apps/api/src/services/exam/exam-abuse-limits.test.ts`
- Create: `packages/db/src/scripts/prune-exam-attempts.ts`
- Reference: `apps/api/src/middlewares/rate-limiter.ts`,
  `apps/api/src/utils/redis/limiter.ts`

## Implementation steps

1. **Write the class-burst test first**, because it is the one that distinguishes a
   working limit from a broken one: forty starts from one address within a minute, for the
   same exam, all succeed; the four hundred and first is refused.
2. Implement the limiters.
3. Implement the per-exam attempt ceiling, as a configurable setting with a default of two
   hundred.
4. Add the duplicate flag to the results query from phase 6.
5. Write the pruning script and document the retention period. It must also handle
   attempts that never expire — an untimed exam leaves `expiresAt` null, so those attempts
   stay `in_progress` forever and lazy finalisation never touches them.
6. Turn the environment flag from phase 2 on, which is the act that releases the feature.

## Success criteria

- [x] Forty simultaneous starts from one address for one exam all succeed
- [x] A burst well beyond a plausible class size is refused
- [x] `ipHash` is salted and no raw address is stored anywhere
- [x] Pruning removes attempts of untimed exams that are still `in_progress`
- [x] Attempts sharing a name or address hash are flagged in the results list
- [x] The retention period is documented and the pruning script has a dry-run mode

## Risk assessment

**Rate limiting is disabled outside production.** `createRateLimiter` returns early when
`NODE_ENV !== 'production'`, which means these limits do not run in development and their
tests must exercise the limiter directly rather than through the middleware. A test that
goes through the middleware in a development environment will pass while testing nothing.

**Limits that lock out a class.** The failure mode is silent from our side and total from
the teacher's: half the class cannot start. Prefer a limit that is too loose at first and
tighten it with evidence, rather than shipping a tight limit and discovering it during a
real exam.

**The salt.** If the `ipHash` salt is per-request or absent, the hash either identifies
nobody or identifies everybody. It must be a stable per-installation secret, held with the
other secrets, never committed.
