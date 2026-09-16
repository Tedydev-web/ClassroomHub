#!/usr/bin/env bash
# ClassroomHub Emergency Rollback Script
# Instantly roll back running services to the previous stable image on the host without rebuilding.
set -euo pipefail

ENV_FILE="${HOST_ENV_DIR:-/home/tedydev/.config/classroomhub}/production.env"
COMPOSE_FILE="${COMPOSE_FILE:-docker/production/docker-compose.yaml}"
REGISTRY="${REGISTRY:-ghcr.io/tedydev-web}"
PROJECT_NAME="zj19oe40izga1bnpymfz5z55"

echo "=== ClassroomHub Emergency Rollback ==="

get_previous_tag() {
  local service="$1"
  local repo="${REGISTRY}/classroom-${service}"
  # Get the 2nd newest sha tag (previous version kept on disk by KEEP_PER_REPO: 2)
  local prev_tag
  prev_tag="$(docker images "${repo}" --filter 'reference=*:sha-*' --format '{{.CreatedAt}}|{{.Tag}}' 2>/dev/null | sort -r | sed -n '2p' | cut -d'|' -f2 || true)"

  if [ -z "${prev_tag}" ]; then
    # Fallback to currently running tag if only one tag exists
    docker inspect --format '{{.Config.Image}}' "${PROJECT_NAME}-${service}-1" 2>/dev/null | cut -d':' -f2 || echo ""
  else
    echo "${prev_tag}"
  fi
}

echo "Discovering previous stable images on host..."
CLASSROOM_API_TAG="$(get_previous_tag api)"
CLASSROOM_DASHBOARD_TAG="$(get_previous_tag dashboard)"
CLASSROOM_JOBS_TAG="$(get_previous_tag jobs)"
CLASSROOM_ADMIN_TAG="$(get_previous_tag admin)"
export CLASSROOM_API_TAG CLASSROOM_DASHBOARD_TAG CLASSROOM_JOBS_TAG CLASSROOM_ADMIN_TAG

echo "Resolved target tags for rollback:"
echo "  API:       ${CLASSROOM_API_TAG:-<unchanged>}"
echo "  Dashboard: ${CLASSROOM_DASHBOARD_TAG:-<unchanged>}"
echo "  Jobs:      ${CLASSROOM_JOBS_TAG:-<unchanged>}"
echo "  Admin:     ${CLASSROOM_ADMIN_TAG:-<unchanged>}"

if [ "${1:-}" != "--force" ]; then
  read -r -p "Confirm rollback to these versions? [y/N]: " confirm
  if [[ ! "${confirm}" =~ ^[Yy]$ ]]; then
    echo "Rollback aborted."
    exit 0
  fi
fi

echo "Starting containers with rollback tags..."
docker compose \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  --project-name "${PROJECT_NAME}" \
  up -d --no-build --remove-orphans

echo "Verifying health..."
sleep 5
docker ps --filter "name=${PROJECT_NAME}" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}"

echo "Rollback completed successfully."
