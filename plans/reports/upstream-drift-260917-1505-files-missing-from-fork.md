# Files upstream has that this fork does not — 2026-09-17

Measured with `git diff --name-status upstream/main HEAD` (the clone is shallow, so there is no merge
base). 196 files exist upstream and not here; 37 are `apps/docs`, `apps/help` and `.github`, kept
fork-owned on purpose. The other 159 were each traced to the commit that removed them.

## Result

Every one of the 159 traces to a deliberate commit or a fork-owned replacement. **One** removal
lost user-visible UI along with the code it meant to drop: the notification panel.

| Files | Removed by | Verdict |
|---|---|---|
| 8 | `aba29d3a1` keep one notification system | Data decision right, UI lost. **Fixed in `960fa1d2a`**: upstream's panel markup over the fork's service |
| 103 | website rebrand and Vietnamese site (`630f33dfd`, `0b01d64ac`, `e0a329631`, `595cbb9ac`, `24d5df682`, `c38ed339b`, `a38aea2cd`, `352d28e55`, plus `github-stars` never added) | Deliberate: the fork is a different company's site |
| 12 | `385992240` delete unreachable course components | Verified unreachable at the time: the `course/components/people` copies were a stale duplicate of `features/people` |
| 4 | `b97a64f5d` org `api` and `mcp` pages | Replaced: both routes now hold a `+page.ts` and the pages live in `features/automation/pages` |
| 1 each | `6c5af432d` bulk email section, `56c742328` grading loader, `e457c2b67` AI grading reason box, `b27a1e1af` certificate directory spelling, `17130432c` course container, `cc1583fc0` jest config | Replaced or dead by construction |
| 2 | `process-error-guards.ts` never added | Deliberate: `apps/api/src/process-error-handling.test.ts` asserts the fork does not globally swallow process errors |
| 1 | `lesson-transcript-status.test.ts` never added | Test only; no runtime effect |
| 10 | upstream migrations `0005`–`0014` never added | Schema present under the fork's own numbering (`0019`, `0025`, `0026`). `0011` drops a trigger the fork never created: production has no `update_lesson_language_history` function and no `old_content` column (read-only query) |
| 3 | `packages/db` org deletion script, `skills/writing-code` | Tooling, not product |

## What this means for "why does syncing still leave differences"

Deletions are not where the drift lives. The notification case was a merge decision taken on
data grounds that dropped presentation as a side effect. The larger surface is the 1,097 files
that exist on both sides and differ: that is where a sync resolution can keep the fork's side of
a file and silently discard upstream's visual changes to it. The rule recorded for future syncs:
**keep the fork's data source, take upstream's presentation.**

## Second pass, same day: files both sides have

The first measurement of shared files counted any line reachable from `HEAD` as "the fork had
it", and `git log` from `HEAD` walks into upstream's side of every sync merge. A line a merge
discarded was therefore counted as received. Re-run on the fork's first-parent history only:
97 shared files still lack upstream lines. Each candidate was re-read before acting.

**Real losses, fixed:**

| What | Cause | Fix |
|---|---|---|
| 154 translation keys (audience bulk bar, filters, CSV import, views, user analytics, export menu, settings sidebar sections, relative times) | 2026-09-14 sync kept the fork's locale files; upstream #1078's code arrived without its strings | `2b0e05c62`: every missing key added at upstream's position in all 10 locales; no existing string changed |
| `course-role-reconcile` job had no worker branch | A sync kept the fork's maintenance worker; the API still queued the retry | commit after `2b0e05c62`: handler restored |

**Checked and not lost** (a read-only audit proposed these as losses; each failed on re-reading):

| Candidate | Verdict | Evidence |
|---|---|---|
| Process error guards in `apps/api/src/index.ts` and `instrument.ts` | Deliberate | `apps/api/src/process-error-handling.test.ts` asserts they are not registered |
| Moonshot provider in `routes/agent/agent.ts` | Deliberate | AI runs through one CCS Codex gateway |
| Header unread count | Equivalent | `960fa1d2a` renders `notificationApi.unread` |
| Comment-updated toast | Equivalent | translated key `snackbar.lessons.comment_updated` |
| Course completion confetti | Equivalent | `bdcda871a` replaced the toggle with `celebrate()` |
| `appSetup.ts` analytics variants, localhost API guard | Deliberate | `319ec43d0` self-owned deployment; browser calls always use the same-origin proxy for cookies |
| Org sidebar grouping (Create / Distribute / Tools) | Deliberate, open | fork's per-org feature toggles, `docs/org-feature-toggles.md`; adopting upstream's grouping is an owner decision |
