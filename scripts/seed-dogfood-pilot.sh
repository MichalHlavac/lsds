#!/usr/bin/env bash
# Seed the dogfood pilot LSDS instance with LSDS's own architecture.
# Target: http://localhost:3094  tenant UUID: aaaaaaaa-bbbb-cccc-dddd-000000000001
# Relationship types & layer constraints: packages/framework/src/relationship/registry.ts
set -euo pipefail

API="http://localhost:3094"
# tenant_id is UUID type in the DB schema
TENANT="aaaaaaaa-bbbb-cccc-dddd-000000000001"
HDR=(-H "Content-Type: application/json" -H "x-tenant-id: $TENANT")

# Create node, return id
node() {
  local label="$1" payload="$2"
  local resp id
  resp=$(curl -sf "${HDR[@]}" -X POST "$API/v1/nodes" -d "$payload") || {
    echo "  ERROR creating $label" >&2
    echo "  response: $(curl -s "${HDR[@]}" -X POST "$API/v1/nodes" -d "$payload")" >&2
    return 1
  }
  id=$(echo "$resp" | jq -r '.data.id')
  echo "$id"
}

# Create edge (fire-and-forget, log errors)
edge() {
  local label="$1" payload="$2"
  local resp
  resp=$(curl -s "${HDR[@]}" -X POST "$API/v1/edges" -d "$payload")
  if echo "$resp" | jq -e '.error' >/dev/null 2>&1; then
    echo "  WARN edge [$label]: $(echo "$resp" | jq -r '.error // .issues[0].message // "unknown"')" >&2
  fi
}

echo "=== LSDS Dogfood Pilot — Architecture Seed ==="
echo "API: $API  Tenant: $TENANT"
echo ""

# ── L1 Business ─────────────────────────────────────────────────────────────
echo "L1 Business..."
bg_arch=$(node "BusinessGoal:Architecture" "$(jq -n '{
  layer: "L1", type: "BusinessGoal",
  name: "Document software architecture as typed knowledge graph",
  version: "1.0.0",
  attributes: {
    description: "Enable teams to capture, navigate, and enforce software architecture as a live typed knowledge graph.",
    priority: "P0"
  }
}')")
echo "  BusinessGoal: $bg_arch"

bc_akm=$(node "BusinessCapability:ArchKM" "$(jq -n '{
  layer: "L1", type: "BusinessCapability",
  name: "Architecture Knowledge Management",
  version: "1.0.0",
  attributes: {
    description: "Ability to ingest, maintain, query, and enforce architectural knowledge graphs at scale."
  }
}')")
echo "  BusinessCapability: $bc_akm"

# ── L2 Domain ────────────────────────────────────────────────────────────────
echo "L2 Domain (BoundedContexts)..."
bc_api=$(node "BoundedContext:API" "$(jq -n '{
  layer: "L2", type: "BoundedContext",
  name: "API Server (apps/api)",
  version: "1.0.1",
  attributes: {
    description: "REST API for the LSDS knowledge graph. Handles node/edge CRUD, lifecycle governance, violation detection, multi-tenant routing, and AI-agent endpoints.",
    technology: "Hono 4.3.0 + TypeScript 5.4 + PostgreSQL",
    repoPath: "apps/api"
  }
}')")
echo "  BoundedContext API: $bc_api"

bc_web=$(node "BoundedContext:Web" "$(jq -n '{
  layer: "L2", type: "BoundedContext",
  name: "Web Frontend (apps/web)",
  version: "1.0.1",
  attributes: {
    description: "Next.js 15 frontend for browsing and managing the knowledge graph. Covers node/edge forms, layer navigation, violation review, interactive graph viz, and global search.",
    technology: "Next.js 15 + React 19 + TypeScript 5.4 + Tailwind CSS + XYFlow",
    repoPath: "apps/web"
  }
}')")
echo "  BoundedContext Web: $bc_web"

bc_fw=$(node "BoundedContext:Framework" "$(jq -n '{
  layer: "L2", type: "BoundedContext",
  name: "Framework Core (packages/framework)",
  version: "1.0.1",
  attributes: {
    description: "Tenant-agnostic, persistence-agnostic core of LSDS. Encodes layer model, lifecycle state machine, 20 relationship types, 50+ guardrail catalog, traversal engine, and change-propagation policies.",
    technology: "TypeScript 5.4 + Zod 3.23.8 (no DB, no HTTP)",
    repoPath: "packages/framework"
  }
}')")
echo "  BoundedContext Framework: $bc_fw"

# ── L3 Architecture ──────────────────────────────────────────────────────────
echo "L3 Architecture..."
as_lsds=$(node "ArchSystem:LSDS" "$(jq -n '{
  layer: "L3", type: "ArchitectureSystem",
  name: "LSDS Knowledge Graph Platform",
  version: "1.0.1",
  attributes: {
    description: "End-to-end system for capturing and enforcing software architecture as a typed knowledge graph. Three Docker containers: api, web, postgres.",
    githubRepo: "MichalHlavac/lsds",
    license: "BSL 1.1"
  }
}')")
echo "  ArchitectureSystem: $as_lsds"

ac_graph=$(node "ArchComp:GraphEngine" "$(jq -n '{
  layer: "L3", type: "ArchitectureComponent",
  name: "Graph Engine",
  version: "1.0.0",
  attributes: {
    description: "Core graph traversal and guardrail evaluation. DefaultTraversalEngine + GraphRepository interface in packages/framework; PostgresGraphRepository in apps/api.",
    ownedBy: "packages/framework + apps/api"
  }
}')")
echo "  ArchComp GraphEngine: $ac_graph"

ac_lc=$(node "ArchComp:LifecycleGovernance" "$(jq -n '{
  layer: "L3", type: "ArchitectureComponent",
  name: "Lifecycle Governance Engine",
  version: "1.0.0",
  attributes: {
    description: "State machine ACTIVE→DEPRECATED→ARCHIVED→PURGE. Rules in packages/framework/lifecycle.ts; enforcement in apps/api LifecycleService.",
    stateMachine: "ACTIVE→DEPRECATED→ARCHIVED→PURGE (PURGE terminal)"
  }
}')")
echo "  ArchComp LifecycleGovernance: $ac_lc"

ac_auth=$(node "ArchComp:Auth" "$(jq -n '{
  layer: "L3", type: "ArchitectureComponent",
  name: "OIDC Authentication",
  version: "1.0.0",
  attributes: {
    description: "JWT verification against remote JWKS endpoint. Covers /v1/* and /agent/* routes. Dev bypass when OIDC_ISSUER unset.",
    implementation: "apps/api/src/auth/oidc.ts"
  }
}')")
echo "  ArchComp Auth: $ac_auth"

ac_mt=$(node "ArchComp:MultiTenancy" "$(jq -n '{
  layer: "L3", type: "ArchitectureComponent",
  name: "Multi-Tenancy",
  version: "1.0.0",
  attributes: {
    description: "All data scoped by tenant_id UUID column. Tenant extracted from x-tenant-id request header. Cache keys prefixed by tenant. Framework and web are tenant-unaware.",
    isolationLevel: "Row-level (tenant_id UUID on every entity table)"
  }
}')")
echo "  ArchComp MultiTenancy: $ac_mt"

adr_a1=$(node "ADR:A1" "$(jq -n '{
  layer: "L3", type: "ADR",
  name: "A1: Framework/Application Separation",
  version: "1.0.0",
  attributes: {
    status: "ACCEPTED",
    decision: "Framework (packages/framework) has zero DB and HTTP dependencies. Apps import framework; framework never imports apps.",
    rationale: "Ensures framework is reusable across different persistence backends and deployment targets."
  }
}')")
echo "  ADR A1: $adr_a1"

adr_a2=$(node "ADR:A2" "$(jq -n '{
  layer: "L3", type: "ADR",
  name: "A2: Hybrid Guardrails (structural + semantic)",
  version: "1.0.0",
  attributes: {
    status: "ACCEPTED",
    decision: "Structural guardrails are immutable (built-in). Semantic guardrails are configurable per tenant.",
    rationale: "Preserves architectural integrity while allowing tenant-specific flexibility."
  }
}')")
echo "  ADR A2: $adr_a2"

adr_a10=$(node "ADR:A10" "$(jq -n '{
  layer: "L3", type: "ADR",
  name: "A10: PostgreSQL + abstract TraversalEngine + cache",
  version: "1.0.0",
  attributes: {
    status: "ACCEPTED",
    decision: "Primary store is PostgreSQL with pgvector + recursive CTEs. GraphRepository interface abstracts storage. LsdsCache provides TTL-based in-process caching.",
    rationale: "PostgreSQL covers relational and vector search in one system."
  }
}')")
echo "  ADR A10: $adr_a10"

ext_oidc=$(node "ExternalSystem:OIDC" "$(jq -n '{
  layer: "L3", type: "ExternalSystem",
  name: "OIDC Identity Provider",
  version: "0.0.0",
  attributes: {
    description: "External OIDC provider for JWT issuance and JWKS endpoint. Optional in dev (bypass via unset OIDC_ISSUER).",
    required: "production only"
  }
}')")
echo "  ExternalSystem OIDC: $ext_oidc"

ext_pg=$(node "ExternalSystem:Postgres" "$(jq -n '{
  layer: "L3", type: "ExternalSystem",
  name: "PostgreSQL 16",
  version: "16.0.0",
  attributes: {
    description: "Primary data store. Nodes, edges, violations, snapshots, history tables, pgvector.",
    image: "postgres:16-alpine"
  }
}')")
echo "  ExternalSystem Postgres: $ext_pg"

# ── L4 Service ───────────────────────────────────────────────────────────────
echo "L4 Service..."
svc_api=$(node "Service:RestAPI" "$(jq -n '{
  layer: "L4", type: "Service",
  name: "REST API (/v1/)",
  version: "1.0.1",
  attributes: {
    description: "Human-oriented graph management API. CRUD for nodes/edges, lifecycle transitions, violations, guardrails, snapshots, layers, RBAC.",
    basePath: "/v1/",
    auth: "OIDC JWT (bypass in dev)"
  }
}')")
echo "  Service RestAPI: $svc_api"

svc_agent=$(node "Service:AgentAPI" "$(jq -n '{
  layer: "L4", type: "Service",
  name: "Agent API (/agent/v1/)",
  version: "1.0.1",
  attributes: {
    description: "AI-oriented machine API for context assembly, guardrail evaluation, architectural change reasoning, and graph stats.",
    basePath: "/agent/v1/",
    keyEndpoints: "context/:nodeId, architect/analyze, violations/summary, write-guidance/:type"
  }
}')")
echo "  Service AgentAPI: $svc_agent"

svc_web=$(node "Service:WebUI" "$(jq -n '{
  layer: "L4", type: "Service",
  name: "LSDS Web UI",
  version: "1.0.1",
  attributes: {
    description: "Next.js 15 web application. Node/edge CRUD forms, layer navigation, violation review, XYFlow graph visualization, global search.",
    port: "3000",
    renderer: "Next.js app router + React 19"
  }
}')")
echo "  Service WebUI: $svc_web"

# ── L5 Package ───────────────────────────────────────────────────────────────
echo "L5 Package..."
pkg_fw=$(node "Package:framework" "$(jq -n '{
  layer: "L5", type: "Package",
  name: "packages/framework",
  version: "1.0.1",
  attributes: {
    description: "Core domain package. 68 source files: layer catalog, lifecycle state machine, 20 relationship types, 50+ guardrail catalog, DefaultTraversalEngine, Zod schemas per node type.",
    exports: "ES modules + TypeScript declarations",
    noDeps: "no DB, no HTTP — only Zod 3.23.8"
  }
}')")
echo "  Package framework: $pkg_fw"

pkg_shared=$(node "Package:shared" "$(jq -n '{
  layer: "L5", type: "Package",
  name: "packages/shared",
  version: "1.0.1",
  attributes: {
    description: "Primitive enums shared across api and web: Layer, LifecycleStatus, Severity, Result<T>."
  }
}')")
echo "  Package shared: $pkg_shared"

mod_db=$(node "Module:db" "$(jq -n '{
  layer: "L5", type: "Module",
  name: "apps/api/src/db",
  version: "1.0.1",
  attributes: {
    description: "PostgreSQL integration: connection pool, GraphRepository implementation, traversal adapter, history recording, migration runner.",
    keyFiles: "client.ts, graph-repository.ts, traversal-adapter.ts, history.ts, migrate.ts"
  }
}')")
echo "  Module db: $mod_db"

mod_guardrails=$(node "Module:guardrails" "$(jq -n '{
  layer: "L5", type: "Module",
  name: "apps/api/src/guardrails",
  version: "1.0.1",
  attributes: {
    description: "GuardrailsRegistry — loads and evaluates tenant guardrail rules, persists violations.",
    keyFile: "apps/api/src/guardrails/index.ts"
  }
}')")
echo "  Module guardrails: $mod_guardrails"

mod_lifecycle=$(node "Module:lifecycle" "$(jq -n '{
  layer: "L5", type: "Module",
  name: "apps/api/src/lifecycle",
  version: "1.0.1",
  attributes: {
    description: "LifecycleService — enforces state transitions in DB, cascades to edges, invalidates cache, records audit trail.",
    keyFile: "apps/api/src/lifecycle/index.ts"
  }
}')")
echo "  Module lifecycle: $mod_lifecycle"

mod_agent=$(node "Module:agent-api" "$(jq -n '{
  layer: "L5", type: "Module",
  name: "apps/api/src/agent",
  version: "1.0.1",
  attributes: {
    description: "AI-agent machine API implementation. Bulk search, context assembly (ContextPackage), guardrail evaluation, architectural change reasoning.",
    keyFiles: "agent/index.ts, agent/architect.ts"
  }
}')")
echo "  Module agent: $mod_agent"

ed_hono=$(node "ExternalDep:Hono" "$(jq -n '{
  layer: "L5", type: "ExternalDependency",
  name: "hono",
  version: "4.3.0",
  attributes: {
    description: "Lightweight HTTP framework for apps/api.",
    license: "MIT",
    usedIn: "apps/api"
  }
}')")
echo "  ExternalDep Hono: $ed_hono"

ed_next=$(node "ExternalDep:Next" "$(jq -n '{
  layer: "L5", type: "ExternalDependency",
  name: "next",
  version: "15.5.15",
  attributes: {
    description: "Next.js app router for apps/web. SSR, RSC, file-system routing.",
    license: "MIT",
    usedIn: "apps/web"
  }
}')")
echo "  ExternalDep Next.js: $ed_next"

ed_zod=$(node "ExternalDep:Zod" "$(jq -n '{
  layer: "L5", type: "ExternalDependency",
  name: "zod",
  version: "3.23.8",
  attributes: {
    description: "Schema validation. Ground truth for node/edge schemas in framework; also used in API routes and web forms.",
    license: "MIT",
    usedIn: "packages/framework, apps/api, apps/web"
  }
}')")
echo "  ExternalDep Zod: $ed_zod"

ed_xyflow=$(node "ExternalDep:XYFlow" "$(jq -n '{
  layer: "L5", type: "ExternalDependency",
  name: "@xyflow/react",
  version: "12.10.2",
  attributes: {
    description: "Interactive graph visualization canvas for apps/web /graph page.",
    license: "MIT",
    usedIn: "apps/web"
  }
}')")
echo "  ExternalDep XYFlow: $ed_xyflow"

# ── L6 Operations ─────────────────────────────────────────────────────────────
echo "L6 Operations..."
du_api=$(node "DeployUnit:lsds-api" "$(jq -n '{
  layer: "L6", type: "DeploymentUnit",
  name: "lsds-api",
  version: "1.0.1",
  attributes: {
    description: "Docker container running the Hono API server.",
    image: "ghcr.io/michalhlavac/lsds:1.0.1",
    defaultPort: "3001"
  }
}')")
echo "  DeploymentUnit lsds-api: $du_api"

du_web=$(node "DeployUnit:lsds-web" "$(jq -n '{
  layer: "L6", type: "DeploymentUnit",
  name: "lsds-web",
  version: "1.0.1",
  attributes: {
    description: "Docker container running the Next.js standalone server.",
    image: "ghcr.io/michalhlavac/lsds:1.0.1",
    defaultPort: "3000"
  }
}')")
echo "  DeploymentUnit lsds-web: $du_web"

du_pg=$(node "DeployUnit:postgres" "$(jq -n '{
  layer: "L6", type: "DeploymentUnit",
  name: "lsds-postgres",
  version: "16.0.0",
  attributes: {
    description: "PostgreSQL 16 container. Persistent volume for data directory.",
    image: "postgres:16-alpine",
    defaultPort: "5432"
  }
}')")
echo "  DeploymentUnit postgres: $du_pg"

env_prod=$(node "Environment:prod" "$(jq -n '{
  layer: "L6", type: "Environment",
  name: "Production (on-premises)",
  version: "1.0.0",
  attributes: {
    description: "Single-tenant on-premises deployment via docker compose.",
    topology: "docker compose: db + migrate + api + web"
  }
}')")
echo "  Environment prod: $env_prod"

rb_onboard=$(node "Runbook:onboarding" "$(jq -n '{
  layer: "L6", type: "Runbook",
  name: "Design Partner Onboarding Runbook",
  version: "1.0.1",
  attributes: {
    description: "End-to-end runbook for deploying LSDS on-premises. Covers prerequisites, Docker setup, config, OIDC, first node, diagnostics bundle. Target time: ≤2h.",
    location: "lsds-research/specs/design-partner-onboarding-runbook.md",
    validated: "v1.0.1"
  }
}')")
echo "  Runbook onboarding: $rb_onboard"

echo ""
echo "=== Edges (relationships) ==="
# Layer constraints from registry.ts (lowercase-hyphen types):
#   motivated-by  : L2-L6 → L1  (any ordinal)
#   realizes      : ALL → L1-L4  (source ordinal >= target ordinal)
#   contains      : ALL → ALL    (source ordinal <= target ordinal)
#   depends-on    : ALL → ALL    (any ordinal)
#   uses          : ALL → ALL    (any ordinal)
#   decided-by    : ALL → L3     (any ordinal)
#   traces-to     : ALL → ALL    (any ordinal)
#   deploys-to    : L4/L5 → L6  (source ordinal <= target ordinal, i.e. source < target)

# L2/L3 → L1 (motivated-by)
edge "BC:API motivated-by BusinessGoal" "$(jq -n --arg s "$bc_api" --arg t "$bg_arch" '{
  sourceId: $s, targetId: $t, type: "motivated-by", layer: "L2", traversalWeight: 1.0, attributes: {}
}')"
echo "  BC:API → BusinessGoal (motivated-by)"

edge "BC:Web motivated-by BusinessGoal" "$(jq -n --arg s "$bc_web" --arg t "$bg_arch" '{
  sourceId: $s, targetId: $t, type: "motivated-by", layer: "L2", traversalWeight: 1.0, attributes: {}
}')"
echo "  BC:Web → BusinessGoal (motivated-by)"

edge "BC:Framework motivated-by BusinessGoal" "$(jq -n --arg s "$bc_fw" --arg t "$bg_arch" '{
  sourceId: $s, targetId: $t, type: "motivated-by", layer: "L2", traversalWeight: 1.0, attributes: {}
}')"
echo "  BC:Framework → BusinessGoal (motivated-by)"

edge "ArchSystem motivated-by BusinessGoal" "$(jq -n --arg s "$as_lsds" --arg t "$bg_arch" '{
  sourceId: $s, targetId: $t, type: "motivated-by", layer: "L3", traversalWeight: 1.0, attributes: {}
}')"
echo "  ArchSystem → BusinessGoal (motivated-by)"

# L3 → L1 (realizes: source ordinal >= target, L3>=L1 ✓)
edge "ArchSystem realizes BusinessCapability" "$(jq -n --arg s "$as_lsds" --arg t "$bc_akm" '{
  sourceId: $s, targetId: $t, type: "realizes", layer: "L3", traversalWeight: 1.0, attributes: {}
}')"
echo "  ArchSystem → BusinessCapability (realizes)"

# L2 → L2 (depends-on: any ordinal)
edge "BC:API depends-on BC:Framework" "$(jq -n --arg s "$bc_api" --arg t "$bc_fw" '{
  sourceId: $s, targetId: $t, type: "depends-on", layer: "L2", traversalWeight: 1.0,
  attributes: {reason: "apps/api imports packages/framework for domain logic, guardrails, and traversal engine"}
}')"
echo "  BC:API → BC:Framework (depends-on)"

edge "BC:Web depends-on BC:API" "$(jq -n --arg s "$bc_web" --arg t "$bc_api" '{
  sourceId: $s, targetId: $t, type: "depends-on", layer: "L2", traversalWeight: 1.0,
  attributes: {reason: "apps/web fetches data from apps/api REST endpoints via lib/api.ts"}
}')"
echo "  BC:Web → BC:API (depends-on)"

# L3 same-layer: ArchSystem contains other L3 components (contains: source<=target, L3<=L3 ✓)
edge "ArchSystem contains ArchComp:GraphEngine" "$(jq -n --arg s "$as_lsds" --arg t "$ac_graph" '{
  sourceId: $s, targetId: $t, type: "contains", layer: "L3", traversalWeight: 1.0, attributes: {}
}')"
echo "  ArchSystem → ArchComp:GraphEngine (contains)"

edge "ArchSystem contains ArchComp:Lifecycle" "$(jq -n --arg s "$as_lsds" --arg t "$ac_lc" '{
  sourceId: $s, targetId: $t, type: "contains", layer: "L3", traversalWeight: 1.0, attributes: {}
}')"
echo "  ArchSystem → ArchComp:Lifecycle (contains)"

edge "ArchSystem contains ArchComp:Auth" "$(jq -n --arg s "$as_lsds" --arg t "$ac_auth" '{
  sourceId: $s, targetId: $t, type: "contains", layer: "L3", traversalWeight: 1.0, attributes: {}
}')"
echo "  ArchSystem → ArchComp:Auth (contains)"

edge "ArchSystem contains ArchComp:MultiTenancy" "$(jq -n --arg s "$as_lsds" --arg t "$ac_mt" '{
  sourceId: $s, targetId: $t, type: "contains", layer: "L3", traversalWeight: 1.0, attributes: {}
}')"
echo "  ArchSystem → ArchComp:MultiTenancy (contains)"

# L3 → L3 contains for services in system (contains: source<=target, L3<=L4 ✓)
edge "ArchSystem contains Service:RestAPI" "$(jq -n --arg s "$as_lsds" --arg t "$svc_api" '{
  sourceId: $s, targetId: $t, type: "contains", layer: "L3", traversalWeight: 1.0, attributes: {}
}')"
echo "  ArchSystem → Service:RestAPI (contains)"

edge "ArchSystem contains Service:AgentAPI" "$(jq -n --arg s "$as_lsds" --arg t "$svc_agent" '{
  sourceId: $s, targetId: $t, type: "contains", layer: "L3", traversalWeight: 1.0, attributes: {}
}')"
echo "  ArchSystem → Service:AgentAPI (contains)"

edge "ArchSystem contains Service:WebUI" "$(jq -n --arg s "$as_lsds" --arg t "$svc_web" '{
  sourceId: $s, targetId: $t, type: "contains", layer: "L3", traversalWeight: 1.0, attributes: {}
}')"
echo "  ArchSystem → Service:WebUI (contains)"

# ADRs: ALL decided-by L3 ADR
edge "ArchSystem decided-by ADR:A1" "$(jq -n --arg s "$as_lsds" --arg t "$adr_a1" '{
  sourceId: $s, targetId: $t, type: "decided-by", layer: "L3", traversalWeight: 1.0, attributes: {}
}')"
echo "  ArchSystem → ADR:A1 (decided-by)"

edge "ArchSystem decided-by ADR:A2" "$(jq -n --arg s "$as_lsds" --arg t "$adr_a2" '{
  sourceId: $s, targetId: $t, type: "decided-by", layer: "L3", traversalWeight: 1.0, attributes: {}
}')"
echo "  ArchSystem → ADR:A2 (decided-by)"

edge "ArchSystem decided-by ADR:A10" "$(jq -n --arg s "$as_lsds" --arg t "$adr_a10" '{
  sourceId: $s, targetId: $t, type: "decided-by", layer: "L3", traversalWeight: 1.0, attributes: {}
}')"
echo "  ArchSystem → ADR:A10 (decided-by)"

# L3 → L3 uses (external systems)
edge "ArchSystem uses ExternalSystem:Postgres" "$(jq -n --arg s "$as_lsds" --arg t "$ext_pg" '{
  sourceId: $s, targetId: $t, type: "uses", layer: "L3", traversalWeight: 1.0, attributes: {}
}')"
echo "  ArchSystem → Postgres (uses)"

edge "ArchSystem uses ExternalSystem:OIDC" "$(jq -n --arg s "$as_lsds" --arg t "$ext_oidc" '{
  sourceId: $s, targetId: $t, type: "uses", layer: "L3", traversalWeight: 0.8,
  attributes: {note: "optional — bypass available in dev via OIDC_ISSUER unset"}
}')"
echo "  ArchSystem → OIDC (uses)"

# L4 → L3 traces-to: services trace to bounded contexts (any ordinal)
edge "Service:RestAPI traces-to BC:API" "$(jq -n --arg s "$svc_api" --arg t "$bc_api" '{
  sourceId: $s, targetId: $t, type: "traces-to", layer: "L4", traversalWeight: 1.0, attributes: {}
}')"
echo "  Service:RestAPI → BC:API (traces-to)"

edge "Service:AgentAPI traces-to BC:API" "$(jq -n --arg s "$svc_agent" --arg t "$bc_api" '{
  sourceId: $s, targetId: $t, type: "traces-to", layer: "L4", traversalWeight: 1.0, attributes: {}
}')"
echo "  Service:AgentAPI → BC:API (traces-to)"

edge "Service:WebUI traces-to BC:Web" "$(jq -n --arg s "$svc_web" --arg t "$bc_web" '{
  sourceId: $s, targetId: $t, type: "traces-to", layer: "L4", traversalWeight: 1.0, attributes: {}
}')"
echo "  Service:WebUI → BC:Web (traces-to)"

# L4 → L3 realizes (service realizes arch component: source>=target, L4>=L3 ✓)
edge "Service:RestAPI realizes ArchComp:GraphEngine" "$(jq -n --arg s "$svc_api" --arg t "$ac_graph" '{
  sourceId: $s, targetId: $t, type: "realizes", layer: "L4", traversalWeight: 1.0, attributes: {}
}')"
echo "  Service:RestAPI → ArchComp:GraphEngine (realizes)"

edge "Service:AgentAPI realizes ArchComp:GraphEngine" "$(jq -n --arg s "$svc_agent" --arg t "$ac_graph" '{
  sourceId: $s, targetId: $t, type: "realizes", layer: "L4", traversalWeight: 1.0, attributes: {}
}')"
echo "  Service:AgentAPI → ArchComp:GraphEngine (realizes)"

# L5 → L2 realizes (package realizes bounded context: source>=target, L5>=L2 ✓)
edge "Package:framework realizes BC:Framework" "$(jq -n --arg s "$pkg_fw" --arg t "$bc_fw" '{
  sourceId: $s, targetId: $t, type: "realizes", layer: "L5", traversalWeight: 1.0, attributes: {}
}')"
echo "  Package:framework → BC:Framework (realizes)"

# L5 same-layer: package contains modules (contains: L5<=L5 ✓)
edge "Package:framework contains Module:db" "$(jq -n --arg s "$pkg_fw" --arg t "$mod_db" '{
  sourceId: $s, targetId: $t, type: "contains", layer: "L5", traversalWeight: 1.0, attributes: {}
}')"
echo "  Package:framework → Module:db (contains)"

edge "Package:framework contains Module:guardrails" "$(jq -n --arg s "$pkg_fw" --arg t "$mod_guardrails" '{
  sourceId: $s, targetId: $t, type: "contains", layer: "L5", traversalWeight: 1.0, attributes: {}
}')"
echo "  Package:framework → Module:guardrails (contains)"

edge "Package:framework contains Module:lifecycle" "$(jq -n --arg s "$pkg_fw" --arg t "$mod_lifecycle" '{
  sourceId: $s, targetId: $t, type: "contains", layer: "L5", traversalWeight: 1.0, attributes: {}
}')"
echo "  Package:framework → Module:lifecycle (contains)"

edge "Package:framework contains Module:agent" "$(jq -n --arg s "$pkg_fw" --arg t "$mod_agent" '{
  sourceId: $s, targetId: $t, type: "contains", layer: "L5", traversalWeight: 1.0, attributes: {}
}')"
echo "  Package:framework → Module:agent (contains)"

# L5 → L5 depends-on (external deps)
edge "Package:framework depends-on Zod" "$(jq -n --arg s "$pkg_fw" --arg t "$ed_zod" '{
  sourceId: $s, targetId: $t, type: "depends-on", layer: "L5", traversalWeight: 1.0, attributes: {}
}')"
echo "  Package:framework → Zod (depends-on)"

edge "Module:db depends-on Zod" "$(jq -n --arg s "$mod_db" --arg t "$ed_zod" '{
  sourceId: $s, targetId: $t, type: "depends-on", layer: "L5", traversalWeight: 1.0, attributes: {}
}')"
echo "  Module:db → Zod (depends-on)"

edge "Module:agent depends-on Package:framework" "$(jq -n --arg s "$mod_agent" --arg t "$pkg_fw" '{
  sourceId: $s, targetId: $t, type: "depends-on", layer: "L5", traversalWeight: 1.0, attributes: {}
}')"
echo "  Module:agent → Package:framework (depends-on)"

edge "Module:lifecycle depends-on Package:framework" "$(jq -n --arg s "$mod_lifecycle" --arg t "$pkg_fw" '{
  sourceId: $s, targetId: $t, type: "depends-on", layer: "L5", traversalWeight: 1.0, attributes: {}
}')"
echo "  Module:lifecycle → Package:framework (depends-on)"

edge "Module:guardrails depends-on Package:framework" "$(jq -n --arg s "$mod_guardrails" --arg t "$pkg_fw" '{
  sourceId: $s, targetId: $t, type: "depends-on", layer: "L5", traversalWeight: 1.0, attributes: {}
}')"
echo "  Module:guardrails → Package:framework (depends-on)"

# L5 → L5 hono/next deps
edge "Module:db depends-on Hono" "$(jq -n --arg s "$mod_db" --arg t "$ed_hono" '{
  sourceId: $s, targetId: $t, type: "depends-on", layer: "L5", traversalWeight: 0.5,
  attributes: {note: "apps/api as a whole depends on Hono; attributed to db module as runtime host"}
}')"
echo "  Module:db → Hono (depends-on)"

edge "Package:shared depends-on Next.js" "$(jq -n --arg s "$pkg_shared" --arg t "$ed_next" '{
  sourceId: $s, targetId: $t, type: "depends-on", layer: "L5", traversalWeight: 1.0, attributes: {}
}')"
echo "  Package:shared → Next.js (depends-on)"

edge "Package:shared depends-on XYFlow" "$(jq -n --arg s "$pkg_shared" --arg t "$ed_xyflow" '{
  sourceId: $s, targetId: $t, type: "depends-on", layer: "L5", traversalWeight: 1.0, attributes: {}
}')"
echo "  Package:shared → XYFlow (depends-on)"

# L4/L5 → L6 deploys-to (source ordinal <= target ordinal, L4/L5 <= L6 ✓)
edge "Service:RestAPI deploys-to lsds-api" "$(jq -n --arg s "$svc_api" --arg t "$du_api" '{
  sourceId: $s, targetId: $t, type: "deploys-to", layer: "L4", traversalWeight: 1.0, attributes: {}
}')"
echo "  Service:RestAPI → DeployUnit:lsds-api (deploys-to)"

edge "Service:AgentAPI deploys-to lsds-api" "$(jq -n --arg s "$svc_agent" --arg t "$du_api" '{
  sourceId: $s, targetId: $t, type: "deploys-to", layer: "L4", traversalWeight: 1.0, attributes: {}
}')"
echo "  Service:AgentAPI → DeployUnit:lsds-api (deploys-to)"

edge "Service:WebUI deploys-to lsds-web" "$(jq -n --arg s "$svc_web" --arg t "$du_web" '{
  sourceId: $s, targetId: $t, type: "deploys-to", layer: "L4", traversalWeight: 1.0, attributes: {}
}')"
echo "  Service:WebUI → DeployUnit:lsds-web (deploys-to)"

edge "Package:framework deploys-to lsds-api" "$(jq -n --arg s "$pkg_fw" --arg t "$du_api" '{
  sourceId: $s, targetId: $t, type: "deploys-to", layer: "L5", traversalWeight: 1.0, attributes: {}
}')"
echo "  Package:framework → DeployUnit:lsds-api (deploys-to)"

# L6 → L6 contains (env contains deployment units: L6<=L6 ✓)
edge "Environment:prod contains lsds-api" "$(jq -n --arg s "$env_prod" --arg t "$du_api" '{
  sourceId: $s, targetId: $t, type: "contains", layer: "L6", traversalWeight: 1.0, attributes: {}
}')"
echo "  Environment:prod → lsds-api (contains)"

edge "Environment:prod contains lsds-web" "$(jq -n --arg s "$env_prod" --arg t "$du_web" '{
  sourceId: $s, targetId: $t, type: "contains", layer: "L6", traversalWeight: 1.0, attributes: {}
}')"
echo "  Environment:prod → lsds-web (contains)"

edge "Environment:prod contains lsds-postgres" "$(jq -n --arg s "$env_prod" --arg t "$du_pg" '{
  sourceId: $s, targetId: $t, type: "contains", layer: "L6", traversalWeight: 1.0, attributes: {}
}')"
echo "  Environment:prod → lsds-postgres (contains)"

# Runbook governs env via decided-by (ALL → L3 only) — runbook is L6, env is L6 → use traces-to
edge "Runbook traces-to Environment:prod" "$(jq -n --arg s "$rb_onboard" --arg t "$env_prod" '{
  sourceId: $s, targetId: $t, type: "traces-to", layer: "L6", traversalWeight: 1.0, attributes: {}
}')"
echo "  Runbook → Environment:prod (traces-to)"

echo ""
echo "=== Seed complete ==="
NODE_COUNT=$(curl -s -H "x-tenant-id: $TENANT" "$API/v1/nodes?limit=100" | jq '(.data // []) | length')
EDGE_COUNT=$(curl -s -H "x-tenant-id: $TENANT" "$API/v1/edges?limit=100" | jq '(.data // []) | length')
echo "Nodes seeded: $NODE_COUNT"
echo "Edges seeded: $EDGE_COUNT"
echo "Tenant: $TENANT"
echo "Web UI: http://localhost:3093"
