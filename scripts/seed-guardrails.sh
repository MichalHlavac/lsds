#!/usr/bin/env bash
# Seed canonical guardrails for a new LSDS tenant.
# Safe to re-run — POST /v1/guardrails is idempotent (ON CONFLICT DO UPDATE).
#
# Usage:
#   ./scripts/seed-guardrails.sh [API_URL] [TENANT_ID]
#
# Defaults to the dogfood pilot values. Override for other tenants:
#   API=http://my-lsds:3001 TENANT=<uuid> ./scripts/seed-guardrails.sh
set -euo pipefail

API="${1:-${API:-http://localhost:3094}}"
TENANT="${2:-${TENANT:-aaaaaaaa-bbbb-cccc-dddd-000000000001}}"
HDR=(-H "Content-Type: application/json" -H "x-tenant-id: $TENANT")

guardrail() {
  local label="$1" payload="$2"
  local resp
  resp=$(curl -sf "${HDR[@]}" -X POST "$API/v1/guardrails" -d "$payload") || {
    echo "  ERROR seeding $label" >&2
    curl -s "${HDR[@]}" -X POST "$API/v1/guardrails" -d "$payload" >&2
    return 1
  }
  local key
  key=$(echo "$resp" | jq -r '.data.rule_key // .data.ruleKey // "?"')
  echo "  $key"
}

echo "=== LSDS Canonical Guardrail Seed ==="
echo "API: $API  Tenant: $TENANT"
echo ""

# ── Cross-layer structural rules (XL) — seed first; highest priority ─────────
echo "XL — Cross-layer integrity..."

guardrail "GR-XL-001 object-owner" "$(jq -n '{
  ruleKey: "GR-XL-001",
  description: "Every node must declare an owner (team or person). Unowned objects stall reviews, deprecations, and incident response.",
  severity: "ERROR",
  enabled: true,
  config: {}
}')"

guardrail "GR-XL-002 no-dangling-relationship" "$(jq -n '{
  ruleKey: "GR-XL-002",
  description: "Relationships must target existing objects. Dangling references silently corrupt graph traversal.",
  severity: "ERROR",
  enabled: true,
  config: {}
}')"

guardrail "GR-XL-003 no-cross-layer-violation" "$(jq -n '{
  ruleKey: "GR-XL-003",
  description: "Relationships must respect layer ordering rules (e.g. L1 may not directly depend-on L5). Violations break the architectural spine.",
  severity: "ERROR",
  enabled: true,
  config: {}
}')"

guardrail "GR-XL-004 no-archive-with-active-dependents" "$(jq -n '{
  ruleKey: "GR-XL-004",
  description: "Cannot archive a node while ACTIVE nodes depend on it. Migrate or archive dependents first.",
  severity: "ERROR",
  enabled: true,
  config: {}
}')"

guardrail "GR-XL-005 no-hard-delete-with-dependents" "$(jq -n '{
  ruleKey: "GR-XL-005",
  description: "Hard delete is blocked while incoming relationships exist. Use the lifecycle path (ARCHIVED → PURGE) instead.",
  severity: "ERROR",
  enabled: true,
  config: {}
}')"

guardrail "GR-XL-006 deprecated-has-active-dependents" "$(jq -n '{
  ruleKey: "GR-XL-006",
  description: "DEPRECATED nodes should not have ACTIVE depends-on consumers. Surface migration debt early.",
  severity: "WARN",
  enabled: true,
  config: {}
}')"

guardrail "GR-XL-009 deprecated-active-depends-on" "$(jq -n '{
  ruleKey: "GR-XL-009",
  description: "DEPRECATED nodes with lingering ACTIVE callers signal stalled deprecation and a future breaking change.",
  severity: "WARN",
  enabled: true,
  config: {}
}')"

guardrail "GR-XL-010 archived-non-archived-children" "$(jq -n '{
  ruleKey: "GR-XL-010",
  description: "ARCHIVED containers must not hold non-archived children. Archive children before archiving the parent.",
  severity: "ERROR",
  enabled: true,
  config: {}
}')"

guardrail "GR-XL-011 hard-delete-blocked-incoming" "$(jq -n '{
  ruleKey: "GR-XL-011",
  description: "Hard delete is blocked while any incoming relationship exists — follow DEPRECATED → ARCHIVED → PURGE.",
  severity: "ERROR",
  enabled: true,
  config: {}
}')"

guardrail "GR-XL-007 stale-no-revision" "$(jq -n '{
  ruleKey: "GR-XL-007",
  description: "Nodes with no revision beyond the configured threshold are flagged for review. Default threshold: 365 days.",
  severity: "INFO",
  enabled: true,
  config: {"review_threshold_days": 365}
}')"

guardrail "GR-XL-008 god-object" "$(jq -n '{
  ruleKey: "GR-XL-008",
  description: "Nodes with more than 20 direct relationships likely hide a missing abstraction.",
  severity: "INFO",
  enabled: true,
  config: {}
}')"

echo ""

# ── L1 Business — require strategic traceability ──────────────────────────────
echo "L1 — Business layer..."

guardrail "GR-L1-001 capability-traces-to-goal" "$(jq -n '{
  ruleKey: "GR-L1-001",
  description: "Every BusinessCapability must trace-to a BusinessGoal. Capabilities orphaned from goals create work without strategic justification.",
  severity: "ERROR",
  enabled: true,
  config: {}
}')"

guardrail "GR-L1-002 goal-has-success-metrics" "$(jq -n '{
  ruleKey: "GR-L1-002",
  description: "BusinessGoals must declare success_metrics. A goal without measurable outcomes cannot be evaluated.",
  severity: "ERROR",
  enabled: true,
  config: {}
}')"

guardrail "GR-L1-003 requirement-has-motivation" "$(jq -n '{
  ruleKey: "GR-L1-003",
  description: "Requirements must declare their motivation so the intent survives beyond the author.",
  severity: "ERROR",
  enabled: true,
  config: {}
}')"

guardrail "GR-L1-004 requirement-has-acceptance-criteria" "$(jq -n '{
  ruleKey: "GR-L1-004",
  description: "Requirements must have at least one acceptance criterion — the contract between business and implementation.",
  severity: "ERROR",
  enabled: true,
  config: {}
}')"

echo ""

# ── L2 Domain — bounded context integrity ────────────────────────────────────
echo "L2 — Domain layer..."

guardrail "GR-L2-002 context-traces-to-capability" "$(jq -n '{
  ruleKey: "GR-L2-002",
  description: "Every BoundedContext must trace-to a BusinessCapability. Contexts that do not realise a capability lack business justification.",
  severity: "ERROR",
  enabled: true,
  config: {}
}')"

guardrail "GR-L2-003 entity-has-invariant" "$(jq -n '{
  ruleKey: "GR-L2-003",
  description: "DomainEntities must declare at least one invariant. Without invariants they are mere records, not domain objects.",
  severity: "ERROR",
  enabled: true,
  config: {}
}')"

guardrail "GR-L2-006 no-context-integration-cycle" "$(jq -n '{
  ruleKey: "GR-L2-006",
  description: "Cyclic context-integration relationships between BoundedContexts destroy the upstream/downstream contract.",
  severity: "ERROR",
  enabled: true,
  config: {}
}')"

echo ""

# ── L3 Architecture — system-level integrity ─────────────────────────────────
echo "L3 — Architecture layer..."

guardrail "GR-L3-004 critical-external-has-fallback" "$(jq -n '{
  ruleKey: "GR-L3-004",
  description: "CRITICAL ExternalSystems must declare a fallback_strategy — no fallback means no resilience plan.",
  severity: "ERROR",
  enabled: true,
  config: {}
}')"

guardrail "GR-L3-007 no-arch-component-dep-cycle" "$(jq -n '{
  ruleKey: "GR-L3-007",
  description: "Cyclic depends-on relationships between ArchitectureComponents break deployment ordering and hide missing abstractions.",
  severity: "ERROR",
  enabled: true,
  config: {}
}')"

echo ""

# ── L5 Package — module-level hygiene ────────────────────────────────────────
echo "L5 — Package layer..."

guardrail "GR-L5-technical-debt-cap" "$(jq -n '{
  ruleKey: "GR-L5-001",
  description: "Packages must not carry more than the configured number of open TechnicalDebt items. Default cap: 5.",
  severity: "WARN",
  enabled: true,
  config: {"max_open_items": 5}
}')"

echo ""

# ── L6 Operations — production readiness ─────────────────────────────────────
echo "L6 — Operations layer..."

guardrail "GR-L6-runbook-present" "$(jq -n '{
  ruleKey: "GR-L6-002",
  description: "Every production DeploymentUnit must have an associated Runbook. Unrunbooked services cannot be safely operated on-call.",
  severity: "ERROR",
  enabled: true,
  config: {}
}')"

echo ""
echo "=== Guardrail seed complete ==="
GUARD_COUNT=$(curl -s "${HDR[@]}" "$API/v1/guardrails" | jq '(.data // []) | length')
echo "Guardrails active for tenant $TENANT: $GUARD_COUNT"
echo ""
echo "Tip: run again at any time — all rules use ON CONFLICT DO UPDATE (idempotent)."
