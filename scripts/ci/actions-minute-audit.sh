#!/usr/bin/env bash
set -euo pipefail

if [ -n "${GITHUB_REPOSITORY:-}" ]; then
  REPO="$GITHUB_REPOSITORY"
elif [ -f .git/FETCH_HEAD ]; then
  origin_url="$(git remote get-url origin 2>/dev/null || true)"
  if [ -n "$origin_url" ]; then
    REPO="$(printf '%s' "$origin_url" | sed -E 's|https://github.com/||; s|git@github.com:||; s|\.git$||')"
  else
    REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
  fi
else
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
fi
SINCE_DAYS="${SINCE_DAYS:-14}"
TOP_COUNT="${TOP_COUNT:-12}"
RUN_PER_PAGE="${RUN_PER_PAGE:-100}"
JOB_FETCH_TIMEOUT_SECONDS="${JOB_FETCH_TIMEOUT_SECONDS:-30}"
MAX_PAGES="${MAX_PAGES:-40}"
REPORT_FILE="${REPORT_FILE:-/tmp/actions-minute-audit.md}"
SUMMARY_FILE="${SUMMARY_FILE:-/tmp/actions-minute-summary.json}"
EVENTS_FILE="${EVENTS_FILE:-/tmp/actions-minute-events.json}"
HOSTED_MINUTES_LIMIT="${HOSTED_MINUTES_LIMIT:-0}"

if ! command -v gh >/dev/null 2>&1; then
  echo "GH CLI not found" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq not found" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found" >&2
  exit 1
fi

if [ -z "${GH_TOKEN:-}" ] && [ -z "${GITHUB_TOKEN:-}" ]; then
  if ! gh auth status >/dev/null 2>&1; then
    echo "GH CLI is not authenticated and GH_TOKEN/GITHUB_TOKEN is not set" >&2
    exit 1
  fi
fi

python3 - "$REPO" "$SINCE_DAYS" "$TOP_COUNT" "$RUN_PER_PAGE" "$MAX_PAGES" "$JOB_FETCH_TIMEOUT_SECONDS" "$HOSTED_MINUTES_LIMIT" "$SUMMARY_FILE" "$EVENTS_FILE" "$REPORT_FILE" <<'PY'
import json
import subprocess
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import sys

repo = sys.argv[1]
since_days = int(sys.argv[2])
top_count = int(sys.argv[3])
run_per_page = int(sys.argv[4])
max_pages = int(sys.argv[5])
timeout_seconds = int(sys.argv[6])
hosted_minute_limit = float(sys.argv[7])
summary_file = sys.argv[8]
events_file = sys.argv[9]
report_file = sys.argv[10]

since_date = (datetime.now(timezone.utc) - timedelta(days=since_days)).strftime('%Y-%m-%dT%H:%M:%SZ')


def gh_api(path, params):
  cmd = [
    "gh",
    "api",
    f"/repos/{repo}/actions/{path}",
    "-X",
    "GET",
  ]
  for key, value in params.items():
    if value is not None:
      cmd.extend(["-f", f"{key}={value}"])
  return json.loads(subprocess.check_output(cmd, text=True))


def fetch_runs():
  runs = []
  for page in range(1, max_pages + 1):
    payload = gh_api(
      "runs",
      {
        "status": "completed",
        "created": f">={since_date}",
        "per_page": str(run_per_page),
        "page": str(page),
      },
    )
    page_runs = payload.get("workflow_runs", [])
    runs.extend(page_runs)
    if len(page_runs) < run_per_page:
      break
  return runs


def fetch_jobs(run_id):
  try:
    output = subprocess.check_output(
      [
        "timeout",
        str(timeout_seconds),
        "gh",
        "api",
        f"/repos/{repo}/actions/runs/{run_id}/jobs",
        "-X",
        "GET",
      ],
      text=True,
    )
    return json.loads(output).get("jobs", [])
  except Exception:
    return []


def is_hosted_job(labels, runner_name):
  labels = labels or []
  if "self-hosted" in labels:
    return False
  if "GitHub Actions" in runner_name:
    return True
  if any(label.startswith("ubuntu-") or label.startswith("windows-") or label.startswith("macos-") for label in labels):
    return True
  return False


runs = fetch_runs()

rows = []
workflow_total = defaultdict(float)
workflow_hosted = defaultdict(float)
workflow_hosted_jobs = defaultdict(int)
workflow_total_jobs = defaultdict(int)

if not runs:
  summary = {
    "repo": repo,
    "window_days": since_days,
    "hosted_minutes_estimate": 0.0,
    "total_job_minutes_estimate": 0.0,
    "run_count": 0,
    "job_count": 0,
  }
  with open(summary_file, "w", encoding="utf-8") as f:
    json.dump(summary, f, indent=2, ensure_ascii=False)
  with open(events_file, "w", encoding="utf-8") as f:
    json.dump([], f, indent=2, ensure_ascii=False)
  with open(report_file, "w", encoding="utf-8") as f:
    f.write("No completed workflow jobs in the requested window.\n")
  print("No completed workflow jobs in the requested window.")
  print(f"hosted_minutes_estimate={summary['hosted_minutes_estimate']}")
  raise SystemExit(0)

for run in runs:
  conclusion = run.get("conclusion")
  if conclusion in {"neutral", "cancelled", "timed_out"}:
    continue

  run_id = str(run.get("id", ""))
  workflow_name = run.get("name") or "(unnamed)"
  event = run.get("event") or "(none)"

  for job in fetch_jobs(run_id):
    if job.get("conclusion") in {"skipped", "cancelled", "neutral", "timed_out"}:
      continue

    started_at = job.get("started_at")
    completed_at = job.get("completed_at")
    if not started_at or not completed_at:
      continue

    started = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
    completed = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
    duration_min = (completed - started).total_seconds() / 60

    labels = job.get("labels") or []
    runner_name = job.get("runner_name") or "(runner name hidden)"
    hosted = is_hosted_job(labels, runner_name)

    rows.append(
      {
        "run_id": run_id,
        "workflow": workflow_name,
        "event": event,
        "conclusion": conclusion,
        "job_name": job.get("name") or "(untitled job)",
        "duration_min": duration_min,
        "runner_name": runner_name,
        "runner_labels": labels,
        "hosted": hosted,
      }
    )

    workflow_total[workflow_name] += duration_min
    workflow_total_jobs[workflow_name] += 1
    if hosted:
      workflow_hosted[workflow_name] += duration_min
      workflow_hosted_jobs[workflow_name] += 1

rows.sort(key=lambda row: row["duration_min"], reverse=True)

run_ids = {row["run_id"] for row in rows}
job_level_minutes = sum(row["duration_min"] for row in rows)
hosted_job_minutes = sum(row["duration_min"] for row in rows if row["hosted"])

with open(summary_file, "w", encoding="utf-8") as f:
  json.dump(
    {
      "repo": repo,
      "window_days": since_days,
      "hosted_minutes_estimate": round(hosted_job_minutes, 3),
      "total_job_minutes_estimate": round(job_level_minutes, 3),
      "run_count": len(run_ids),
      "job_count": len(rows),
    },
    f,
    indent=2,
    ensure_ascii=False,
  )

with open(events_file, "w", encoding="utf-8") as f:
  json.dump(rows, f, indent=2, ensure_ascii=False)

out = [
  f"# GitHub Actions Minutes Audit ({repo})",
  "",
  f"Window: last {since_days} days",
  "",
  f"- Workflow runs: {len(run_ids)}",
  f"- Job samples: {len(rows)}",
  f"- Job-level estimated minutes: **{job_level_minutes:.1f}**",
  f"- Estimated hosted job minutes: **{hosted_job_minutes:.1f}**",
]
if hosted_minute_limit > 0:
  out.append(f"- Host minute guard: {hosted_minute_limit:.1f}")

out.extend([
  "",
  "## Top long jobs",
  "",
  "| Workflow | Event | Job | Duration (m) | Hosted runner | Runner |",
  "|---|---|---|---:|---|---|",
])
for row in rows[:top_count]:
  out.append(
    f"| {row['workflow']} | {row['event']} | {row['job_name']} | {row['duration_min']:.1f} | "
    f"{'yes' if row['hosted'] else 'no'} | {row['runner_name']} |"
  )

out.extend([
  "",
  "## Workflows with hosted job minutes",
  "",
  "| Workflow | Hosted job minutes | Hosted jobs | Total jobs |",
  "|---|---:|---:|---:|",
])
for workflow_name, mins in sorted(workflow_hosted.items(), key=lambda kv: kv[1], reverse=True):
  out.append(
    f"| {workflow_name} | {mins:.1f} | {workflow_hosted_jobs[workflow_name]} | {workflow_total_jobs[workflow_name]} |"
  )

out.extend([
  "",
  "## Workflows with total job minutes",
  "",
  "| Workflow | Total job minutes |",
  "|---|---:|",
])
for workflow_name, mins in sorted(workflow_total.items(), key=lambda kv: kv[1], reverse=True)[:top_count]:
  out.append(f"| {workflow_name} | {mins:.1f} |")

with open(report_file, "w", encoding="utf-8") as f:
  f.write("\n".join(out) + "\n")

print("\n".join(out))
print(f"hosted_minutes_estimate={hosted_job_minutes:.3f}")

if hosted_minute_limit > 0 and hosted_job_minutes > hosted_minute_limit:
  print(f"ERROR: hosted estimated minutes {hosted_job_minutes:.1f} exceeds limit {hosted_minute_limit:.1f}")
  raise SystemExit(2)
PY
