#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == '--' ]]; then
  shift
fi

command="${1:-start}"
root_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root_directory"

activate_project_node() {
  local nvm_script="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [[ -s "$nvm_script" ]]; then
    # shellcheck disable=SC1090
    source "$nvm_script"
    nvm use --silent
  fi
}

show_usage() {
  cat <<'EOF'
Usage: pnpm dev:local [start|status|stop|tunnel]

start   Start local infrastructure, then run API/dashboard/jobs watchers.
status  Check local infrastructure, app health, port ownership, and tunnel health.
stop    Stop local Docker infrastructure. Stop watchers with Ctrl+C in their terminal first.
tunnel  Check the local cloudflared service and optional DEV_TUNNEL_URL HTTP endpoint.
EOF
}

check_tunnel() {
  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet cloudflared; then
    echo '[ OK ] cloudflared system service is active.'
  else
    echo '[WARN] cloudflared system service is not active or is not managed by systemd.' >&2
  fi

  if [[ -n "${DEV_TUNNEL_URL:-}" ]]; then
    curl --fail --silent --show-error --max-time 10 "$DEV_TUNNEL_URL" >/dev/null
    echo '[ OK ] DEV_TUNNEL_URL answered successfully.'
  else
    echo '[INFO] Set DEV_TUNNEL_URL to add an end-to-end public tunnel health check.'
  fi
}

case "$command" in
  start)
    activate_project_node
    pnpm dev:doctor -- --preflight
    check_tunnel
    pnpm infra:up
    exec pnpm dev:core
    ;;
  status)
    activate_project_node
    check_tunnel
    exec pnpm dev:doctor
    ;;
  stop)
    exec pnpm infra:down
    ;;
  tunnel)
    check_tunnel
    ;;
  help|-h|--help)
    show_usage
    ;;
  *)
    show_usage >&2
    exit 2
    ;;
esac
