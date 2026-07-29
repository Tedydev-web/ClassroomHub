#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_REMOVE_TOKEN:?RUNNER_REMOVE_TOKEN is required}"

if pgrep -f 'Runner.Worker' >/dev/null; then
  echo "Runner is executing a job; deregistration refused." >&2
  exit 1
fi

RUNNER_ALLOW_RUNASROOT=1 /actions-runner/config.sh remove --token "$RUNNER_REMOVE_TOKEN"
