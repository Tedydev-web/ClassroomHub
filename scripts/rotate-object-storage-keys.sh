#!/usr/bin/env bash
# Point this deployment's object storage at a Cloudflare R2 API token.
#
# R2's S3 endpoint does not take the token itself: the Access Key ID is the
# token's id, and the Secret Access Key is the SHA-256 of the token's value.
# Deriving the second here is what keeps the raw token out of every file this
# writes — and getting it wrong is the classic cause of SignatureDoesNotMatch.
#
# The token must carry "Object Read & Write". A read-only one lists every bucket
# perfectly and then fails each upload with AccessDenied, which is a worse
# failure than an outright rejection because the deployment looks healthy.
#
# Usage:
#   scripts/rotate-object-storage-keys.sh <token-id> <file-holding-the-token-value>
#
# The value is read from a file rather than an argument so it never reaches the
# process list or the shell history.
set -euo pipefail

TOKEN_ID="${1:?token id — 32 hex characters, shown when the token is created}"
TOKEN_FILE="${2:?path to a file containing the token value and nothing else}"
ACCOUNT_ID="${R2_ACCOUNT_ID:-da02bc7e271f6874328a990774afac5e}"
ENV_DIR="${HOST_ENV_DIR:-/home/tedydev/.config/classroomhub}"
PROJECT="${COMPOSE_PROJECT:-zj19oe40izga1bnpymfz5z55}"
REPO="${GH_REPO:-Tedydev-web/ClassroomHub}"

case "${TOKEN_ID}" in
  *[!0-9a-f]* | "") echo "token id must be lowercase hex" >&2; exit 1 ;;
esac
[ "${#TOKEN_ID}" -eq 32 ] || { echo "token id must be 32 characters" >&2; exit 1; }
test -s "${TOKEN_FILE}"

secret="$(printf '%s' "$(cat "${TOKEN_FILE}")" | sha256sum | cut -d' ' -f1)"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"

# Proven before anything is written. Applying a key that cannot write is how the
# outage this script exists to fix stayed invisible: reads kept working.
echo "Checking the key can read and write every bucket..."
probe="$(mktemp -d "${repo_root}/apps/api/.r2probe.XXXXXX")"
trap 'rm -rf "${probe}"' EXIT
cat > "${probe}/probe.mjs" <<'PROBE'
import { S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.ACC}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.AKID, secretAccessKey: process.env.SECRET }
});
const bucket = process.env.BUCKET;
const key = `healthcheck/${Date.now()}.txt`;

await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: 'ok' }));
await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
console.log(`  ${bucket}: read and write OK`);
PROBE

for bucket in documents media videos; do
  ACC="${ACCOUNT_ID}" AKID="${TOKEN_ID}" SECRET="${secret}" BUCKET="${bucket}" node "${probe}/probe.mjs"
done

# The host's environment file holds every production secret and is the only copy
# of some of them, so it is backed up before it is rewritten.
stamp="$(date +%y%m%d-%H%M)"
docker run --rm -v "${ENV_DIR}:/cfg" alpine:3 \
  sh -c "cp /cfg/production.env /cfg/production.env.bak-${stamp} && chmod 600 /cfg/production.env.bak-${stamp}"
echo "Backed up production.env to production.env.bak-${stamp}"

docker run --rm -i -v "${ENV_DIR}:/cfg" alpine:3 sh -s "${TOKEN_ID}" "${secret}" <<'REWRITE'
set -eu
id="$1"
secret="$2"
umask 077
awk -v id="$id" -v secret="$secret" '
  /^OBJECT_STORAGE_ACCESS_KEY_ID=/ { print "OBJECT_STORAGE_ACCESS_KEY_ID=" id; next }
  /^OBJECT_STORAGE_SECRET_ACCESS_KEY=/ { print "OBJECT_STORAGE_SECRET_ACCESS_KEY=" secret; next }
  { print }
' /cfg/production.env > /cfg/production.env.new
mv /cfg/production.env.new /cfg/production.env
REWRITE
echo "Rewrote ${ENV_DIR}/production.env"

# The same pair under the names the embeds and OpenAPI upload workflows read.
#
# Written to the `production` environment as well as the repository. Every
# deploy job declares `environment: production`, and an environment secret of
# the same name shadows the repository one — so rotating only the repository
# copy leaves the workflows presenting the previous key and failing with
# SignatureDoesNotMatch, while every local check with the new key passes.
for scope in "-R ${REPO}" "-R ${REPO} --env ${GH_ENVIRONMENT:-production}"; do
  # shellcheck disable=SC2086 # deliberate word splitting: $scope carries flags
  printf '%s' "${TOKEN_ID}" | gh secret set CLOUDFLARE_ACCESS_KEY $scope
  # shellcheck disable=SC2086
  printf '%s' "${secret}" | gh secret set CLOUDFLARE_SECRET_ACCESS_KEY $scope
done
echo "Updated the GitHub secrets (repository and the production environment)"

# Only the services that read object storage. The dashboard does not, so it keeps
# serving through this.
env_file="$(mktemp)"
chmod 600 "${env_file}"
docker run --rm -v "${ENV_DIR}:/cfg:ro" alpine:3 cat /cfg/production.env > "${env_file}"

docker compose \
  --env-file "${env_file}" \
  -f "${repo_root}/docker/production/docker-compose.yaml" \
  --project-directory "${repo_root}" \
  --project-name "${PROJECT}" \
  up -d --no-build api jobs

rm -f "${env_file}"
echo "Done — api and jobs restarted on the new key."
