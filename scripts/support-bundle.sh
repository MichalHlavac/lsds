#!/usr/bin/env bash
# SPDX-License-Identifier: BUSL-1.1
# Copyright (c) 2026 Michal Hlavac. All rights reserved.
#
# support-bundle.sh — generates a redacted diagnostics bundle for LSDS support.
# Works on macOS and Linux. Requires: bash 3.2+, sed, awk, tar.
# Docker compose (v2) or docker-compose (v1) required for live container data.
#
# Usage: ./scripts/support-bundle.sh [-o|--out <dir>]
#   -o, --out <dir>   Output directory for the .tar.gz (default: current directory)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

OUT_DIR="."
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--out) OUT_DIR="$2"; shift 2 ;;
    -h|--help)
      sed -n '/^# Usage:/,/^[^#]/{ /^[^#]/d; s/^# //; p }' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *) echo "Unknown argument: $1. Use --help for usage." >&2; exit 1 ;;
  esac
done

# ── Environment ──────────────────────────────────────────────────────────────
ENV_FILE="$REPO_ROOT/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE" 2>/dev/null || true
  set +a
fi
POSTGRES_USER="${POSTGRES_USER:-lsds}"
POSTGRES_DB="${POSTGRES_DB:-lsds}"

cd "$REPO_ROOT"

# ── Docker compose detection ─────────────────────────────────────────────────
if docker compose version &>/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE="docker-compose"
else
  COMPOSE=""
fi

service_running() {
  local svc="$1"
  [[ -n "$COMPOSE" ]] && $COMPOSE ps --quiet "$svc" 2>/dev/null | grep -q .
}

# ── Work area ────────────────────────────────────────────────────────────────
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
BUNDLE_INNER="lsds-support-bundle"
BUNDLE_DIR="$WORK_DIR/$BUNDLE_INNER"
mkdir -p "$BUNDLE_DIR/logs"

TS="$(date -u +%Y%m%dT%H%M%S)"
BUNDLE_NAME="lsds-support-bundle-${TS}.tar.gz"
COLLECTION_LOG="$BUNDLE_DIR/collection.log"

log() {
  local msg="[bundle] $*"
  echo "$msg"
  echo "$msg" >> "$COLLECTION_LOG"
}
warn() {
  local msg="[bundle] WARNING: $*"
  echo "$msg" >&2
  echo "$msg" >> "$COLLECTION_LOG"
}

log "LSDS support bundle — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "Repo root: $REPO_ROOT"
[[ -n "$COMPOSE" ]] && log "Compose: $COMPOSE" || warn "docker / docker compose not found"

# ── Secret-stream redaction ───────────────────────────────────────────────────
# Handles KEY=VALUE (.env style) and "KEY":"VALUE" (JSON/pino log style).
# URL passwords in connection strings are also stripped.
# Patterns mirror apps/cli/src/redact.ts to keep behaviour consistent.
redact_stream() {
  sed -E \
    -e 's/([A-Za-z_]*PASSWORD[A-Za-z_]*=)[^[:space:]",]*/\1<REDACTED>/g' \
    -e 's/([A-Za-z_]+_KEY=)[^[:space:]",]*/\1<REDACTED>/g' \
    -e 's/([A-Za-z_]+_SECRET=)[^[:space:]",]*/\1<REDACTED>/g' \
    -e 's/([A-Za-z_]+_TOKEN=)[^[:space:]",]*/\1<REDACTED>/g' \
    -e 's/([A-Za-z_]*DSN[A-Za-z_]*=)[^[:space:]",]*/\1<REDACTED>/g' \
    -e 's/"([A-Za-z_]*PASSWORD[A-Za-z_]*)":"[^"]*"/"\1":"<REDACTED>"/g' \
    -e 's/"([A-Za-z_]+_KEY)":"[^"]*"/"\1":"<REDACTED>"/g' \
    -e 's/"([A-Za-z_]+_SECRET)":"[^"]*"/"\1":"<REDACTED>"/g' \
    -e 's/"([A-Za-z_]+_TOKEN)":"[^"]*"/"\1":"<REDACTED>"/g' \
    -e 's/"([A-Za-z_]*DSN[A-Za-z_]*)":"[^"]*"/"\1":"<REDACTED>"/g' \
    -e 's|://([^:@/[:space:]"]+):([^@/[:space:]"]+)@|://\1:<REDACTED>@|g'
}

# ── 1. API logs ───────────────────────────────────────────────────────────────
log "Collecting API logs (last 500 lines)..."
LOG_FILE="$BUNDLE_DIR/logs/api-logs.txt"
if service_running api; then
  {
    echo "# LSDS API logs — last 500 lines — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "# Secrets redacted."
    echo ""
    $COMPOSE logs --tail=500 api 2>&1 | redact_stream
  } > "$LOG_FILE"
  log "  API logs: OK"
else
  {
    echo "# API container is not running — live log collection skipped."
    echo "#"
    echo "# If running without Docker, find API logs at:"
    echo "#   journalctl -u lsds-api               (systemd)"
    echo "#   /var/log/lsds/api.log                (if --log-dir was configured)"
  } > "$LOG_FILE"
  warn "API container not running — log collection skipped"
fi

# ── 2. Docker service status ──────────────────────────────────────────────────
log "Collecting docker service status..."
STATUS_FILE="$BUNDLE_DIR/docker-status.txt"
if [[ -n "$COMPOSE" ]]; then
  {
    echo "# docker compose ps — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo ""
    $COMPOSE ps 2>&1 || true
  } > "$STATUS_FILE"
  log "  Docker status: OK"
else
  echo "docker / docker compose not found on PATH" > "$STATUS_FILE"
  warn "docker not available — service status skipped"
fi

# ── 3. DB migration version ───────────────────────────────────────────────────
log "Collecting DB migration version..."
MIGS_FILE="$BUNDLE_DIR/db-migrations.txt"
if service_running db; then
  {
    echo "# Applied DB migrations — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo ""
    $COMPOSE exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
      -c "SELECT filename, applied_at FROM _migrations ORDER BY applied_at;" \
      2>&1 || echo "(could not query _migrations — table may not exist yet)"
  } > "$MIGS_FILE"
  log "  DB migrations: OK"
else
  echo "DB container not running — migration version not collected." > "$MIGS_FILE"
  warn "DB container not running — migration version skipped"
fi

# ── 4. Node / edge count summary ──────────────────────────────────────────────
log "Collecting node/edge/violation/snapshot counts..."
COUNTS_FILE="$BUNDLE_DIR/db-counts.txt"
if service_running db; then
  {
    echo "# Graph object counts — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo ""
    $COMPOSE exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
SELECT 'nodes'      AS tbl, count(*) AS rows FROM nodes
UNION ALL
SELECT 'edges',           count(*) FROM edges
UNION ALL
SELECT 'violations',      count(*) FROM violations
UNION ALL
SELECT 'snapshots',       count(*) FROM snapshots;" \
      2>&1 || echo "(could not query counts — tables may not exist yet)"
  } > "$COUNTS_FILE"
  log "  DB counts: OK"
else
  echo "DB container not running — node/edge counts not collected." > "$COUNTS_FILE"
  warn "DB container not running — counts skipped"
fi

# ── 5. Env var presence check ─────────────────────────────────────────────────
log "Collecting env var presence check..."
ENV_CHECK_FILE="$BUNDLE_DIR/env-check.txt"
{
  echo "# Env var presence — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# Values are NEVER shown. Secrets → <REDACTED>. Others → <present> or <not set>."
  echo ""
} > "$ENV_CHECK_FILE"

if [[ -f "$ENV_FILE" ]]; then
  awk -F= '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { print; next }
    {
      key = $1
      rest = substr($0, index($0, "=") + 1)
      is_secret = (key ~ /PASSWORD/ || key ~ /_KEY$/ || key ~ /_SECRET$/ || key ~ /_TOKEN$/ || key ~ /DSN/)
      if (rest == "" || rest == "\n") {
        suffix = "<not set>"
      } else if (is_secret) {
        suffix = "<REDACTED>"
      } else {
        suffix = "<present>"
      }
      print key "=" suffix
    }
  ' "$ENV_FILE" >> "$ENV_CHECK_FILE"
else
  echo "# .env not found at $ENV_FILE — env check not available" >> "$ENV_CHECK_FILE"
  warn ".env not found — env check skipped"
fi
log "  Env check: OK"

# ── 6. README.txt ─────────────────────────────────────────────────────────────
cat > "$BUNDLE_DIR/README.txt" << 'READMEEOF'
LSDS Support Diagnostics Bundle
================================

Generated by: scripts/support-bundle.sh
Purpose:      Helps the LSDS team diagnose issues with your installation.

IMPORTANT: No credentials, API keys, tokens, or passwords are included.
All sensitive values are replaced with <REDACTED>. Non-secret values show
<present> or <not set> — never the actual value. You can verify this by
inspecting each file before sharing.

Files in this bundle
---------------------
README.txt          This file.
collection.log      Script execution log: which steps ran and any warnings.

logs/api-logs.txt   Last 500 lines of the LSDS API container logs.
                    Secrets are redacted before collection.

docker-status.txt   Output of "docker compose ps" at bundle time.
                    Shows service names, health status, and port bindings.

db-migrations.txt   Migrations applied to the database (from _migrations table),
                    with timestamps. Useful for spotting schema version mismatches.

db-counts.txt       Row counts for nodes, edges, violations, and snapshots.
                    No node names or content — aggregate counts only.

env-check.txt       Which env vars are configured in .env.
                    Values are never shown.

How to share this bundle
------------------------
1. Inspect the files above to confirm nothing sensitive was captured.
2. Email the .tar.gz file to your LSDS support contact, or attach it
   to a GitHub issue at https://github.com/MichalHlavac/lsds/issues

Quick inspect commands:
  tar -tzf <bundle>.tar.gz             # list contents
  tar -xzf <bundle>.tar.gz -C /tmp    # unpack to /tmp
  cat /tmp/lsds-support-bundle/README.txt
READMEEOF
log "  README.txt: OK"

# ── 7. Secret leak audit ──────────────────────────────────────────────────────
log "Running secret leak audit..."
LEAK=0

check_leak() {
  local label="$1" pattern="$2"
  if grep -rE "$pattern" "$BUNDLE_DIR" \
      --include="*.txt" --include="*.json" --include="*.log" \
      --exclude="README.txt" --exclude="collection.log" \
      -q 2>/dev/null; then
    warn "Secret leak DETECTED — pattern: $label"
    LEAK=1
  fi
}

# Values that follow these key patterns must be <REDACTED>, not a real value
check_leak "_KEY unredacted"     '[A-Za-z_]+_KEY=[^<[:space:]]'
check_leak "_SECRET unredacted"  '[A-Za-z_]+_SECRET=[^<[:space:]]'
check_leak "_TOKEN unredacted"   '[A-Za-z_]+_TOKEN=[^<[:space:]]'
check_leak "PASSWORD unredacted" '[A-Za-z_]*PASSWORD[A-Za-z_]*=[^<[:space:]]'
check_leak "URL with password"   '://[^:@/[:space:]"]+:[^<@/[:space:]"]+@'
check_leak "OpenAI key pattern"  'sk-[A-Za-z0-9_-]{20,}'

if [[ $LEAK -eq 1 ]]; then
  echo "" >&2
  echo "ERROR: Secret leak check failed — bundle NOT created." >&2
  echo "Please report this at https://github.com/MichalHlavac/lsds/issues" >&2
  exit 1
fi
log "  Leak audit: PASSED — no secrets detected"

# ── 8. Package ────────────────────────────────────────────────────────────────
log "Packaging bundle..."
mkdir -p "$OUT_DIR"
tar -czf "${OUT_DIR}/${BUNDLE_NAME}" -C "$WORK_DIR" "$BUNDLE_INNER"

echo ""
echo "  Bundle: ${OUT_DIR}/${BUNDLE_NAME}"
echo ""
echo "  Inspect: tar -tzf ${OUT_DIR}/${BUNDLE_NAME}"
echo "  Unpack:  tar -xzf ${OUT_DIR}/${BUNDLE_NAME} -C /tmp"
echo ""
