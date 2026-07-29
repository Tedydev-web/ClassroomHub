#!/usr/bin/env bash
set -euo pipefail

mode="${1:-check}"
if [[ "$mode" != "check" && "$mode" != "apply" && "$mode" != "apply-and-start" ]]; then
  echo "Usage: $0 [check|apply|apply-and-start]" >&2
  exit 2
fi

: "${COOLIFY_URL:?COOLIFY_URL is required}"
: "${COOLIFY_TOKEN:?COOLIFY_TOKEN is required}"
: "${COOLIFY_RUNNER_SERVICE_UUID:?COOLIFY_RUNNER_SERVICE_UUID is required}"

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
compose_file="$script_dir/docker-compose.yaml"
api_url="${COOLIFY_URL%/}/api/v1/services/${COOLIFY_RUNNER_SERVICE_UUID}"
response_file=$(mktemp)
remote_compose_file=$(mktemp)
trap 'rm -f "$response_file" "$remote_compose_file"' EXIT

curl --fail-with-body --silent --show-error --header "Authorization: Bearer ${COOLIFY_TOKEN}" "$api_url" >"$response_file"
jq -er '.docker_compose_raw' "$response_file" | base64 --decode >"$remote_compose_file"

normalize_compose() {
  RUNNER_TOKEN=placeholder RUNNER_CI_TOKEN=placeholder RUNNER_CI_3_TOKEN=placeholder \
    docker compose --project-name classroomhub-runner-reconcile -f "$1" config
}

if [[ "$(normalize_compose "$compose_file")" == "$(normalize_compose "$remote_compose_file")" ]]; then
  echo "Coolify runner service matches Git source."
  exit 0
fi

if [[ "$mode" == "check" ]]; then
  echo "Coolify runner service drifts from Git source. Run with apply after runners are idle." >&2
  exit 1
fi

compose_base64=$(base64 --wrap=0 "$compose_file")
payload=$(jq -n --arg docker_compose_raw "$compose_base64" '{docker_compose_raw: $docker_compose_raw}')
curl --fail-with-body --silent --show-error --request PATCH --header "Authorization: Bearer ${COOLIFY_TOKEN}" --header 'Content-Type: application/json' --data "$payload" "$api_url" >/dev/null
echo "Coolify runner service updated from Git source."

if [[ "$mode" == "apply-and-start" ]]; then
  curl --fail-with-body --silent --show-error --request POST --header "Authorization: Bearer ${COOLIFY_TOKEN}" "${api_url}/start" >/dev/null
  echo "Coolify runner service start requested."
fi
