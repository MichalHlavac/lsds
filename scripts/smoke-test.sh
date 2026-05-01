#!/usr/bin/env bash
# End-to-end smoke test: spins up Docker Compose, validates /health, POSTs a node,
# GETs it back, and tears down.
# Usage: ./scripts/smoke-test.sh [--no-cleanup]
set -euo pipefail

COMPOSE="docker compose"
CLEANUP=true

for arg in "$@"; do
  [[ "$arg" == "--no-cleanup" ]] && CLEANUP=false
done

API_PORT="${API_HOST_PORT:-3001}"
BASE_URL="http://localhost:${API_PORT}"
TENANT_ID="${TENANT_ID:-smoke-test}"

cleanup() {
  if [[ "$CLEANUP" == true ]]; then
    echo "==> Tearing down..."
    $COMPOSE down -v --remove-orphans
  fi
}
trap cleanup EXIT

echo "==> Building image..."
$COMPOSE build --quiet

echo "==> Starting services..."
$COMPOSE up -d

echo "==> Waiting for API to be healthy (up to 120s)..."
timeout=120
elapsed=0
until curl -sf "$BASE_URL/health" > /dev/null 2>&1; do
  sleep 2
  elapsed=$((elapsed + 2))
  if [[ $elapsed -ge $timeout ]]; then
    echo "ERROR: API did not become healthy within ${timeout}s"
    $COMPOSE logs api
    exit 1
  fi
done
echo "    Health OK after ${elapsed}s"

echo "==> Smoke tests..."

# Health endpoint
HEALTH=$(curl -sf "$BASE_URL/health")
echo "    /health: $HEALTH"
echo "$HEALTH" | grep -q '"status":"ok"' || { echo "ERROR: unexpected health response"; exit 1; }

# CLI version check (via docker compose exec)
echo "==> Checking CLI version..."
CLI_VERSION=$($COMPOSE exec -T api node apps/cli/dist/index.js --version 2>/dev/null || echo "cli-unavailable")
echo "    lsds --version: $CLI_VERSION"

# 404 for unknown route
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/nonexistent")
[[ "$STATUS" == "404" ]] || { echo "ERROR: expected 404, got $STATUS"; exit 1; }
echo "    /nonexistent → 404 OK"

# POST a node
echo "==> POST /v1/nodes..."
NODE_PAYLOAD='{"type":"Service","label":"smoke-test-node","attributes":{}}'
CREATE_RESP=$(curl -sf -X POST "$BASE_URL/v1/nodes" \
  -H "Content-Type: application/json" \
  -H "x-tenant-id: $TENANT_ID" \
  -d "$NODE_PAYLOAD")
echo "    Created: $CREATE_RESP"
NODE_ID=$(echo "$CREATE_RESP" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
[[ -n "$NODE_ID" ]] || { echo "ERROR: no id in create response"; exit 1; }
echo "    Node ID: $NODE_ID"

# GET the node back
echo "==> GET /v1/nodes/$NODE_ID..."
GET_RESP=$(curl -sf "$BASE_URL/v1/nodes/$NODE_ID" \
  -H "x-tenant-id: $TENANT_ID")
echo "    Got: $GET_RESP"
echo "$GET_RESP" | grep -q "\"id\":\"$NODE_ID\"" || { echo "ERROR: node not found in GET response"; exit 1; }
echo "    Node round-trip OK"

echo "==> All smoke tests passed."
