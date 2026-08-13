#!/usr/bin/env bash
set -euo pipefail

# -----------------------------
# Preconditions
# -----------------------------
if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
  echo "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID"
  exit 1
fi

# -----------------------------
# Helpers
# -----------------------------
# Escape & < > " for Telegram HTML; " also avoids breaking shell when passing to curl
# Order matters: & first, then < and >
esc_html() {
  local raw="${1:-}"
  if [ -z "$raw" ]; then return; fi
  printf '%s' "$raw" | sed -e 's/\&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'
}

# For href: also escape " so attribute value doesn't break
esc_url() {
  printf '%s' "${1:-}" \
    | sed -e 's/\&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'
}

head_chars() { head -c "${1:-2000}"; }

send_telegram() {
  local text="$1"
  local use_html="${2:-1}"
  local resp
  local extra_args=()
  [ "$use_html" = "1" ] && extra_args+=(-d "parse_mode=HTML")
  resp="$(printf '%s' "$text" | curl -sS -w "\nHTTP_STATUS:%{http_code}\n" -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    "${extra_args[@]}" \
    -d "disable_web_page_preview=true" \
    --data-urlencode "text@-")"

  echo "$resp"
  if echo "$resp" | grep -q "HTTP_STATUS:200"; then
    return 0
  fi
  # If 400 and parse_mode was used, retry without HTML so job does not fail
  if [ "$use_html" = "1" ] && echo "$resp" | grep -q "HTTP_STATUS:400"; then
    echo "Telegram HTML parse failed, retrying as plain text..."
    send_telegram "$text" "0"
    return
  fi
  exit 1
}

# -----------------------------
# Normalize status
# -----------------------------
STATUS_RAW="${STATUS:-}"
STATUS_NORM="$(printf '%s' "$STATUS_RAW" | tr '[:lower:]' '[:upper:]')"
case "$STATUS_NORM" in
  SUCCESS|OK|PASSED) STATUS_NORM="SUCCESS" ;;
  FAIL|FAILED|FAILURE|ERROR) STATUS_NORM="FAIL" ;;
  CANCELLED|CANCELED) STATUS_NORM="CANCELLED" ;;
  *) : ;;
esac

ICON="❌"
[ "$STATUS_NORM" = "SUCCESS" ] && ICON="✅"
[ "$STATUS_NORM" = "CANCELLED" ] && ICON="🟨"

# -----------------------------
# URLs (prefer metadata outputs)
# -----------------------------
REPO_URL="${REPO_URL:-}"
RUN_URL="${RUN_URL:-}"
COMMIT_URL="${COMMIT_URL:-}"
COMPARE_URL="${COMPARE_URL:-}"

REPO_SLUG="${REPO:-${GITHUB_REPOSITORY:-}}"
RUN_ID_VAL="${RUN_ID:-${GITHUB_RUN_ID:-}}"
COMMIT_SHA_VAL="${COMMIT_SHA:-${COMMIT:-${GITHUB_SHA:-}}}"

if [ -z "$REPO_URL" ] && [ -n "$REPO_SLUG" ]; then
  REPO_URL="https://github.com/${REPO_SLUG}"
fi
if [ -z "$RUN_URL" ] && [ -n "$REPO_URL" ] && [ -n "$RUN_ID_VAL" ]; then
  RUN_URL="${REPO_URL}/actions/runs/${RUN_ID_VAL}"
fi
if [ -z "$COMMIT_URL" ] && [ -n "$REPO_URL" ] && [ -n "$COMMIT_SHA_VAL" ]; then
  COMMIT_URL="${REPO_URL}/commit/${COMMIT_SHA_VAL}"
fi

COMMIT_URL_ESC="$(esc_url "${COMMIT_URL:-}")"
RUN_URL_ESC="$(esc_url "${RUN_URL:-}")"
# -----------------------------
# Duration (prominent)
# -----------------------------
DURATION_TEXT="—"
if [ -n "${STARTED_AT:-}" ]; then
  STARTED_EPOCH="$(date -d "${STARTED_AT}" +%s 2>/dev/null \
    || date -j -f "%Y-%m-%dT%H:%M:%SZ" "${STARTED_AT}" +%s 2>/dev/null \
    || true)"
  if [ -n "${STARTED_EPOCH:-}" ]; then
    NOW_EPOCH="$(date -u +%s)"
    DURATION="$((NOW_EPOCH - STARTED_EPOCH))"
    DURATION_M="$(((DURATION % 3600) / 60))"
    DURATION_S="$((DURATION % 60))"
    if [ "$DURATION" -ge 3600 ]; then
      DURATION_H="$((DURATION / 3600))"
      DURATION_TEXT="${DURATION_H}h ${DURATION_M}m ${DURATION_S}s"
    else
      DURATION_TEXT="${DURATION_M}m ${DURATION_S}s"
    fi
  fi
fi

# -----------------------------
# Escape fields (minimal)
# -----------------------------
TITLE_ESC="$(esc_html "${TITLE:-Deploy}")"
BRANCH_ESC="$(esc_html "${BRANCH:-${GITHUB_REF_NAME:-}}")"
ACTOR_ESC="$(esc_html "${ACTOR:-${GITHUB_ACTOR:-}}")"

COMMIT_SHORT_IN="${COMMIT_SHORT:-}"
if [ -z "$COMMIT_SHORT_IN" ] && [ -n "$COMMIT_SHA_VAL" ]; then
  COMMIT_SHORT_IN="$(printf '%s' "$COMMIT_SHA_VAL" | cut -c1-7)"
fi
COMMIT_SHORT_ESC="$(esc_html "$COMMIT_SHORT_IN")"
COMMIT_TITLE_ESC="$(esc_html "${COMMIT_TITLE:-}" | head_chars 80)"

# -----------------------------
# Single short message: status, time, link to view/download logs per step
# -----------------------------
MSG="<b>${ICON} ${TITLE_ESC}: ${STATUS_NORM}</b>

⏱ <b>Thời gian chạy:</b> <code>${DURATION_TEXT}</code>
🌿 <b>Branch:</b> <code>${BRANCH_ESC}</code>
👤 <b>Actor:</b> <code>${ACTOR_ESC}</code>

📌 <b>Commit:</b> <a href=\"${COMMIT_URL_ESC}\">${COMMIT_SHORT_ESC}</a> — ${COMMIT_TITLE_ESC}

🔗 <b>Xem log từng step (tải log):</b>
<a href=\"${RUN_URL_ESC}\">GitHub Actions → Run #${RUN_ID_VAL}</a>"

send_telegram "${MSG}"