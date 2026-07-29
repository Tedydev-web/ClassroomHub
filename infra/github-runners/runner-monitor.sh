#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_TOKEN:?GITHUB_TOKEN is required}"
: "${TELEGRAM_BOT_TOKEN:?TELEGRAM_BOT_TOKEN is required}"
: "${TELEGRAM_CHAT_ID:?TELEGRAM_CHAT_ID is required}"

repository="${GITHUB_REPOSITORY:-Tedydev-web/ClassroomHub}"
expected_runners="${EXPECTED_RUNNERS:-classroomhub-deploy,classroomhub-ci-1,classroomhub-ci-2}"
queue_threshold="${QUEUE_THRESHOLD:-2}"
state_file="${STATE_FILE:-/var/lib/classroomhub-runner-monitor/state}"
mkdir -p "$(dirname "$state_file")"

runners=$(curl --fail-with-body --silent --show-error --header "Authorization: Bearer ${GITHUB_TOKEN}" --header 'Accept: application/vnd.github+json' "https://api.github.com/repos/${repository}/actions/runners")
queued=$(curl --fail-with-body --silent --show-error --header "Authorization: Bearer ${GITHUB_TOKEN}" --header 'Accept: application/vnd.github+json' "https://api.github.com/repos/${repository}/actions/runs?status=queued&per_page=1" | jq -r '.total_count')

offline=""
IFS=',' read -r -a names <<<"$expected_runners"
for name in "${names[@]}"; do
  online=$(jq -r --arg name "$name" '[.runners[] | select(.name == $name and .status == "online")] | length' <<<"$runners")
  if [[ "$online" != "1" ]]; then
    offline+="${offline:+,}${name}"
  fi
done

state="ok"
if [[ -n "$offline" ]]; then
  state="offline:${offline}"
elif (( queued > queue_threshold )); then
  state="queue:${queued}"
fi

previous=""
if [[ -f "$state_file" ]]; then
  previous=$(<"$state_file")
fi

if [[ "$state" == "$previous" ]]; then
  exit 0
fi

printf '%s' "$state" >"$state_file"
message="ClassroomHub runner monitor: ${state}; queued=${queued}"
curl --fail-with-body --silent --show-error --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=${message}" "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" >/dev/null
