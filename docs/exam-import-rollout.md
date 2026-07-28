# Exam import rollout and rollback

## Deployment order

1. Deploy migrations `0016_faulty_ozymandias.sql`, `0017_exam_import_ai_runtime.sql`, and
   `0018_ai_usage_idempotency.sql` in journal order.
2. Deploy API and jobs workers with `EXAM_IMPORT_ENABLED` unset or set to `false`.
3. Confirm the `maintenance` and `exam-import` workers are healthy.
4. Set `EXAM_IMPORT_ENABLED=true` on the API and restart it.
5. Set `PUBLIC_EXAM_IMPORT_ENABLED=true`, rebuild the dashboard, and deploy it only after the API
   health check passes.
6. After DOCX imports are healthy, set `EXAM_IMPORT_PDF_ENABLED=true` on the API, then set
   `PUBLIC_EXAM_IMPORT_PDF_ENABLED=true` and rebuild the dashboard. Keep both PDF flags disabled
   to withdraw PDF without affecting DOCX.
7. Keep `EXAM_IMPORT_AI_ENABLED=false` until gateway structured-output preflight passes. To enable
   deterministic-region AI for selected organizations, set the global flag to `true`, restart the
   jobs worker, then enable the organization-level exam-import AI switch. Both gates are required.
   Pin `EXAM_IMPORT_AI_MODEL` to the allowlisted model that passed the exact exam-import schema
   preflight; do not inherit a changing chat default in production.
8. Scanned-PDF vision is a separate internal opt-in. Set `EXAM_IMPORT_VISION_ENABLED=true` and pin
   `EXAM_IMPORT_VISION_MODEL=claude-opus-5` on the jobs worker only after the global AI gate and the
   organization's AI consent and separate scanned-PDF transcription consent are enabled. Keep this
   gate off for general availability until a labelled, multi-document scan corpus passes its release
   thresholds twice.

The API treats the flag as default-off. Disabling it blocks create, edit, answer-key, and publish
writes while leaving status and draft reads available.

`EXAM_IMPORT_PDF_ENABLED` is also default-off. A PDF is accepted only when its bytes identify it
as PDF and the server flag is enabled. Text-free scans fail with `EXAM_IMPORT_PDF_NO_TEXT_LAYER`
until the image/OCR branch is enabled separately. The supplied five-page scan is safely
extractable as bounded page rasters, but both preflighted vision models remained above 12% word
error rate and invented option markers. The image branch is therefore intentionally disconnected;
do not reinterpret the global AI flag as enabling scanned PDFs.

The paragraph above records the first preflight and is superseded by the second 2026-07-27
preflight. The current branch streams one bounded page at a time through CCS, requires a forced
strict transcription tool, checkpoints each page by image hash and model, accounts token usage,
and marks every resulting question for teacher review. The five-page reference scan passed the
strict contract with `claude-opus-5` and produced exactly 40 questions and 160 options. It remains
an internal opt-in because one document is not a release corpus.

Before the first page request, the worker persists an import-level checkpoint containing the exact
vision model and transcription-contract version. Every page checkpoint must match both values, so a
worker restart or environment change cannot mix models or prompt contracts within one import. Token
usage is recorded even when the gateway returns a billed response with an invalid tool envelope, and
the model's configured gateway quota weight is used for cost units.

CCS exposes an OpenAI-compatible chat-completions endpoint but the repository has no documented
transport-level idempotency contract for it. A response lost after upstream processing can therefore
be billed again when BullMQ retries. Completed page checkpoints prevent repeats after a response is
persisted, and the usage ledger deduplicates accounting by import plus request hash, but the upstream
call remains at-least-once. Keep this residual risk in the scan cost budget and incident runbook.

Complete scanned page images are a broader disclosure than deterministic unresolved-region AI.
The organization must enable a separate scanned-PDF transcription switch, and disabling the base AI
switch disables that consent as well. Every extracted answer remains AI-attributed and blocks publish
until a teacher explicitly confirms the resolved question.

The vision model is deliberately explicit. To replace it, benchmark the candidate on the held-out
scan corpus, add it to the gateway allowlist, change `EXAM_IMPORT_VISION_MODEL`, and restart the
jobs worker. Do not configure automatic cross-model fallback for a single import: changing OCR
behavior between pages weakens reproducibility and makes review findings harder to diagnose.

The server PDF flag is an admission gate. Turning it off rejects new PDF imports while jobs
already accepted continue to completion. This avoids converting in-flight work into failures
during rollback.

Queued imports are the durable queue handoff. The maintenance worker reconciles queued rows to
BullMQ with a stable job ID, so an API crash or Redis outage between the database insert and
enqueue does not lose work.

Imports that yield for AI capacity enter `waiting_for_ai`. Reconciliation uses a checkpointed
resume job ID so a retained completed BullMQ job cannot block progress. Gateway calls hold
short-lived global and organization Redis leases; expired leases self-recover. After the bounded
wait budget, the worker finalizes the deterministic draft rather than waiting indefinitely.

AI calls send one unresolved region, persist only the region audit metadata, and record token
usage with an idempotency key. Raw model output is never persisted. Turning off either AI gate
causes waiting imports to complete deterministically on their next resume.

## Product release gates

Deterministic formats (DOCX, Aiken, GIFT, and text-layer PDF) may be released only when their
format-specific regression fixtures pass and browser E2E covers import, review, publish, learner
submission, and scoring. A missing or conflicting answer key must still create an editable draft,
but publish must remain blocked for an automatically graded interaction.

Scanned-PDF vision remains an internal opt-in until all of the following are true:

- The held-out corpus contains at least ten independently sourced scanned documents, at least one
  hundred pages, and representative Vietnamese and Latin-script papers. Each document records its
  source, usage rights, checksum, and a human-verified reference.
- The corpus covers clean scans, degraded scans, multi-page papers, shared passages, and layouts
  that can split or merge options. Synthetic rasterization may add regression coverage, but never
  substitutes for independently acquired scans.
- Two distinct complete runs use the same pinned model and transcription contract. Every held-out
  document has 100% question recall, kind accuracy, grouping accuracy, option-count accuracy,
  review precision, and review recall, with no spurious question. A metric layer that is not
  human-verified is reported as `not measured` and cannot be counted as a pass.
- Where the source states answers, answer-key accuracy and review routing are also human-verified.
  AI-derived answers remain proposed and publish stays blocked until the teacher confirms them,
  regardless of benchmark results.

Run the gate from the repository root with `pnpm --filter @cio/exam-import verify:scanned-pdf <manifest.json> <first-run.json> <second-run.json>`. The manifest owns every qualifying source and reference path; the verifier rejects malformed artifacts, paths outside the corpus directory, and source bytes that do not match their declared SHA-256 and size.

These are safety gates, not a claim that arbitrary scans are error-free. The product guarantee is
that unconfirmed or structurally suspect content does not become a machine-graded published exam.

## Operational checks

- Queue `course-imports` has an active worker.
- Maintenance scheduler `exam-import-reconcile-scheduler` is registered.
- New imports move from `queued` to `running` and then `draft_ready`.
- AI-enabled imports may move from `running` to `waiting_for_ai`, then resume to `running`.
- Final failures contain a machine-readable code and have a dead-letter record.
- Object storage permits private read/write/delete under `exam-import/checkpoints/`.
- Corpus regression reports remain at or above `fixtures/exams/baselines/v1.json`; unverified
  metric layers must remain `not measured`.

Source checkpoints are bounded, compressed artifacts. The worker deletes them after draft
creation or terminal failure. Configure a seven-day object lifecycle for the checkpoint prefix as
a final orphan cleanup boundary.

## Rollback

1. Set `EXAM_IMPORT_ENABLED=false` and restart the API.
2. Set `PUBLIC_EXAM_IMPORT_ENABLED=false`, rebuild the dashboard, and deploy it to hide the entry
   point.
3. Let running jobs finish or stop the `exam-import` worker after it drains.
4. Roll back application code if needed. The additional tables are additive and can remain.

To withdraw AI only, set `EXAM_IMPORT_AI_ENABLED=false` and restart the jobs worker. This does not
disable deterministic DOCX, PDF-text, Aiken, or GIFT imports.

To withdraw scanned-PDF vision without affecting deterministic-region AI, set
`EXAM_IMPORT_VISION_ENABLED=false` and restart the jobs worker. New scanned imports fail with an
actionable machine-readable code; text-bearing PDF and non-PDF imports remain available.

Do not drop the tables after real imports exist. Keeping the additive schema preserves drafts and
published-import history while the write path is disabled.

For a pre-production rollback with no data to retain, the reversible schema-down order is:

```sql
DROP TABLE exam_import_draft;
DROP TABLE exam_import;
DROP TYPE "EXAM_IMPORT_STATUS";
DROP TYPE "EXAM_IMPORT_EXTRACTOR";
```

This order was rehearsed after applying the complete migration history to an isolated PostgreSQL
database.
