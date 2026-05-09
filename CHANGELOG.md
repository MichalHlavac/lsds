# Changelog

All notable changes to LSDS are documented here.
Format follows the [§5 template](https://github.com/MichalHlavac/LSDS-research/blob/main/release/bsl-1.1-process.md#5-release-notes-template) from the BSL 1.1 release process.

---

## v1.3.0 — TBD

### Highlights

- **Audit log** — every graph mutation is recorded in an append-only `audit_log` table with actor, tenant, operation, and before/after snapshots.
- **Webhook notifications** — operators register webhook endpoints for real-time mutation events; delivery is async with retry.
- **Token-bucket rate limiting** — per-API-key and per-tenant limits with configurable burst/refill, persisted in Postgres.
- **Import / export** — NDJSON bulk export and import with row caps, audit trail, and webhook delivery; CLI commands `lsds export` / `lsds import`.
- **Stale-flag propagation** — `propagateChange()` marks downstream nodes/edges stale on each mutation; `GET /v1/stale-flags` gives operators a review surface.
- **Node reactivate** — restore archived nodes to active via `POST /v1/nodes/:id/reactivate`; edge reactivate also added.
- **Graph-level cardinality enforcement** — `validateGraphCardinality` rejects writes that violate cardinality rules declared on edge types.
- **Tenant diagnostics** — `GET /v1/tenant/diagnostics` returns a redacted health snapshot for support.
- **Tenant usage** — `GET /v1/tenant/usage` surfaces graph size, node/edge counts, and API key stats.

### Breaking Changes

None.

### New Features

- `audit_log` table (migration `013_audit_log.sql`) — append-only record of all graph mutations (`tenant_id`, `api_key_id`, `operation`, `entity_type`, `entity_id`, `before_snapshot`, `after_snapshot`, `created_at`).
- `POST /v1/webhook-subscriptions` — register a webhook URL for one or more event types (`node.created`, `node.updated`, `node.deleted`, `edge.created`, `edge.updated`, `edge.deleted`).
- `GET /v1/webhook-subscriptions` — list registered webhooks for the current tenant.
- `DELETE /v1/webhook-subscriptions/:id` — remove a webhook subscription.
- `rate_limit` override columns on `api_keys`; per-tenant defaults on `tenants` (migration `014_rate_limit.sql`).
- `webhooks` / `webhook_deliveries` tables (migration `015_webhooks.sql`).
- All node/edge mutations (`POST`, `PATCH`, `DELETE`) wrapped in `sql.begin()` for atomic audit + history writes.
- `POST /v1/export` — NDJSON bulk export of nodes and edges; respects row cap and records an audit entry.
- `POST /v1/import` — NDJSON bulk import with audit trail and webhook delivery on each upserted entity.
- `GET /v1/tenant/usage` — graph size (node count, edge count) and API key stats for the current tenant.
- `POST /v1/nodes/:id/reactivate` and `POST /v1/edges/:id/reactivate` — restore archived entities to `active`; reactivation is recorded in the audit log (migration `016_reactivate.sql`).
- `stale_flags` persistence (migration `017_stale_flags.sql`) — `propagateChange()` output is written to the DB on every mutation.
- `staleFlags` field on node/edge GET responses — indicates whether an entity has been marked stale by an upstream change.
- `GET /v1/stale-flags` — paginated list of all stale entities with staleness reason; `GET /v1/stale-flags/summary` — aggregate counts by layer and type.
- `GET /v1/tenant/diagnostics` — redacted health snapshot (DB connectivity, migration status, queue depth) for operator triage.
- `validateGraphCardinality` in Framework Core — enforces min/max cardinality constraints declared on edge types; write rejected with `422` on violation.
- `sunset_at` field on `L4 APIEndpoint` nodes — optional date marking when the endpoint is scheduled for removal.
- Canonical NDJSON serialization spec for nodes/edges (Framework Core `serialization.ts`).
- `StaleFlag` schema and `propagateChange()` change-event emitter in Framework Core.
- CLI `lsds export` and `lsds import` commands wrapping the bulk import/export API.

### Bug Fixes

- `fix(deploy)`: added missing `LSDS_ADMIN_SECRET` to `.env.example` and `docker-compose.yml`.
- `fix(api)`: removed NodeRow/AuditDiff coercion casts via widened `jsonb()` helper — eliminates a class of silent type-cast bugs.
- `fix(api)`: edge `reactivate` returns `422` with the list of allowed transitions when called from a non-archivable state.
- `fix(api)`: replaced `String(e)` error serialisation in lifecycle/nodes/edges routes to prevent internal stack-trace leakage.
- `fix(mcp)`: renamed `analyze-change` tool to `classify-change` to resolve identifier conflict with LSDS-719.

### Security

None.

### Upgrading from v1.2.0

```bash
# Stop the running instance
docker compose down

# Pull the new image / update source
git pull && git checkout v1.3.0

# Migrate (five new schema migrations)
pnpm --filter @lsds/api run db:migrate

# Restart
docker compose up -d
```

Migration notes:
- `013_audit_log.sql` — adds `audit_log` table; existing data is unaffected.
- `014_rate_limit.sql` — adds nullable rate-limit override columns to `api_keys` and default columns to `tenants`; existing rows get NULL / system defaults.
- `015_webhooks.sql` — adds `webhooks` and `webhook_deliveries` tables; extends `audit_log.operation` check constraint to include webhook event types.
- `016_reactivate.sql` — adds `reactivate` lifecycle transition support; existing node/edge rows are unaffected.
- `017_stale_flags.sql` — adds `stale_flags` table for persisting `propagateChange()` output; existing data is unaffected.

### License

This release is licensed under BSL 1.1.
Change Date: 2030-05-31 — on that date this version converts to Apache License 2.0.
For commercial licensing enquiries: https://github.com/MichalHlavac

---

## v1.2.0 — 2026-05-09

### Highlights

- **Design Partner API surface** — tenant management, API key lifecycle (rotation, expiry), and a CLI (`import`, `export`, `verify`) for self-hosted operators.
- **OpenAPI 3.1 spec** served live at `GET /api/openapi.json`.
- **Semantic node search** via `pgvector` — `POST /v1/nodes/similar` returns nearest-neighbour results by embedding.
- **Bulk import** — `POST /v1/nodes/bulk` accepts up to 5 000 nodes in one call; MCP tool `lsds_bulk_import` exposes the same surface to AI agents.

### Breaking Changes

None.

### New Features

- `GET /api/openapi.json` — machine-readable OpenAPI 3.1 spec.
- `GET /health/live` and `GET /health/ready` — split health probes replacing the single `/health` endpoint (old endpoint removed; update your liveness/readiness probe config).
- `POST /api/admin/tenants` — admin bootstrap endpoint to provision a new tenant and rotate its first API key.
- `GET /v1/tenant` / `PATCH /v1/tenant` — tenant info and settings management.
- `POST /v1/api-keys/rotate` — rotate the current API key; old key is invalidated.
- API key expiry — keys gain an optional `expires_at` field; expired keys are rejected at the API boundary.
- `POST /v1/nodes/bulk` — batch node import (up to 5 000 nodes); smoke-tested at 1 k and 5 k sizes.
- `POST /v1/nodes/similar` — semantic nearest-neighbour search via pgvector.
- `lsds_bulk_import` MCP tool.
- `lsds_impact_predict` MCP tool — pre-change impact analysis.
- `lsds_search_by_attributes` MCP tool — GIN JSONB containment search.
- Architect Agent MCP tools: `lsds_analyze`, `lsds_consistency`, `lsds_drift`, `lsds_debt`.
- `POST /agent/v1/architect/analyze` — bulk drift scan.
- `POST /agent/v1/context` — Knowledge Agent context package endpoint.
- CLI commands: `lsds import`, `lsds export`, `lsds verify`.
- Pino structured JSON request/response logging with correlation ID (`X-Request-Id`).
- Per-tenant sliding-window rate limiting middleware (superseded by per-key token bucket in v1.3.0).
- Non-blocking cache warm-up background job on server restart.
- Production-grade connection pool config with metrics endpoint.
- `CORS` middleware — unblocks browser-to-API requests from the frontend.
- Migrations now run automatically on server startup (separate `migrate` service removed).
- Lifecycle management: archived nodes are excluded from traversal by default; purge enforces retention policy (default 2 years).
- Tenant provisioning bootstrap script (`scripts/provision-tenant.sh`).
- Diagnostics bundle script (`scripts/diagnostics.sh`).
- Canonical guardrail seed script.
- Build provenance attestation in the release workflow (SLSA).
- `owner` field propagated through node create and simulation paths.
- `InMemoryGraphRepository` published at the `GraphRepository` boundary for framework testing.

### Bug Fixes

- `fix(migrations)`: use `clock_timestamp()` for `node/edge history changed_at` to get wall-clock time inside transactions.
- `fix(web)`: `aria-expanded` invalid on `textbox` role in `GlobalSearch` — removed.
- `fix(framework)`: `GR-XL-001` remediation no longer advises the removed `PersonRef`.
- `fix(framework)`: `GR-L6-002` is field-level — removed fake `runbook_reference` edge.
- `fix(dogfood)`: align tenant UUID across API, web bundle, and seed data.
- `fix(api)`: CORS origin applied; browser requests from the web frontend now succeed.
- `fix(api)`: fall back to context `tenantId` in request-logger for API-key-authed requests.
- `fix(api)`: idempotent node/edge upsert prevents duplicate seeding.
- `fix(api)`: severity coerced to uppercase at API boundary.

### Security

- `sec(api)`: enforce `tenant_id` in traversal CTE `JOIN` clauses — prevents cross-tenant data leakage in recursive queries (LSDS-644).
- `sec`: upgrade Hono to 4.12.18 (CVE-2026-44456, CVE-2026-44455).
- `sec`: upgrade `express-rate-limit` to 8.5.1 via pnpm override (CVE-2026-42338).

### Upgrading from v1.1.0

```bash
docker compose down
git pull && git checkout v1.2.0
pnpm --filter @lsds/api run db:migrate
docker compose up -d
```

Migration notes: multiple new tables (`tenants`, `api_keys` expiry columns, `node_embeddings`, `migration_drafts`). Existing data is unaffected. Update liveness/readiness probe URLs from `/health` to `/health/live` and `/health/ready`.

### License

This release is licensed under BSL 1.1.
Change Date: 2030-04-26 — on that date this version converts to Apache License 2.0.
For commercial licensing enquiries: https://github.com/MichalHlavac

---

## v1.1.0 — 2026-05-02

### Highlights

- **Migration Agent** — AI-assisted schema migration via MCP tools (`lsds_migration_propose`, `lsds_migration_session`, `lsds_migration_review`, `lsds_migration_commit`).
- **Batch endpoints** — `POST /v1/nodes/batch-lifecycle` and `POST /v1/violations/batch-resolve` for bulk operations.
- **Build provenance attestation** — release workflow now attaches SLSA provenance to Docker images.
- **Web UI polish** — Global Search typeahead, full-text filter bars on Nodes and Edges views, accessibility improvements.

### Breaking Changes

None.

### New Features

- Migration Agent MCP tools: `lsds_migration_propose`, `lsds_migration_session`, `lsds_migration_review`, `lsds_migration_commit`.
- `POST /v1/nodes/batch-lifecycle` — apply lifecycle transitions to multiple nodes in one call.
- `POST /v1/violations/batch-resolve` — resolve multiple violations at once.
- `POST /agent/v1/architect/analyze` — bulk drift scan (preliminary; expanded in v1.2.0).
- MCP tools: `lsds_upsert_node`, `lsds_upsert_edge`, `lsds_query_edges`, `lsds_get_violations`.
- Canonical guardrail seed script (`scripts/seed-guardrails.sh`).
- Dogfood pilot `docker-compose.dogfood.yml` + seed script.
- SLSA build provenance attestation in release GitHub Actions workflow.
- `GuardrailsRegistry.evaluateBatch` for bulk guardrail evaluation.
- `AgentAnalyzeSchema` — Zod schema for agent drift-scan request/response.
- `GR-XL-003` auto-evaluated on every `POST /v1/edges`.
- Violations now capture `source_node_id` / `target_node_id` for edge-based rules.
- Web: Global Search typeahead.
- Web: full-text search field on Nodes and Edges filter bars.
- Web: node count and edge count in pagination headers.
- Web: a11y polish — improved layout, Sidebar, and LifecycleControls keyboard navigation.

### Bug Fixes

- `fix(api)`: case-insensitive severity enum at API boundary.
- `fix(framework)`: `GR-L3-008` reads `quality_attributes` field, not an invented edge.
- `fix(framework)`: `GR-L6-002` is field-level — fake `runbook_reference` edge removed.
- `fix(mcp)`: `lsds_get_context` aligned with API `tokenBudget` parameter.
- `fix(api)`: idempotent node/edge upsert (prevents duplicate seeding on restart).
- `fix(dogfood)`: CORS origin set for frontend-to-API requests.
- `fix(dogfood)`: bump image tags to `1.1.0`.

### Security

None.

### Upgrading from v1.0.1

```bash
docker compose down
git pull && git checkout v1.1.0
pnpm --filter @lsds/api run db:migrate
docker compose up -d
```

### License

This release is licensed under BSL 1.1.
Change Date: 2030-04-26 — on that date this version converts to Apache License 2.0.
For commercial licensing enquiries: https://github.com/MichalHlavac

---

## v1.0.1 — 2026-05-01

### Highlights

Patch release fixing two Docker/smoke-test regressions discovered immediately after v1.0.0.

### Breaking Changes

None.

### New Features

None.

### Bug Fixes

- `fix(docker)`: correct Next.js standalone output path in pnpm monorepo layout — the web service failed to start with `MODULE_NOT_FOUND` on fresh deploys.
- `fix(smoke-test)`: use a valid UUID for the `TENANT_ID` default in the smoke-test script.

### Security

None.

### Upgrading from v1.0.0

```bash
docker compose down
git pull && git checkout v1.0.1
docker compose up -d
```

No schema migrations.

### License

This release is licensed under BSL 1.1.
Change Date: 2030-04-26 — on that date this version converts to Apache License 2.0.
For commercial licensing enquiries: https://github.com/MichalHlavac

---

## v1.0.0 — 2026-05-01

### Highlights

- **Initial production release** of LSDS — Layered Software Documentation System.
- **Customer-deployable Docker image** — single `docker compose up` stands up the API, web frontend, and Postgres.
- **Framework Core** — typed node/edge graph with 6 architecture layers, 19 relationship types, and a guardrail engine.
- **REST API** — full CRUD for nodes, edges, violations, traversal, and semantic context packages.
- **MCP server** — AI-agent surface wrapping the REST API for Claude / other LLM-based tools.

### Breaking Changes

Not applicable — first stable release.

### New Features

- PostgreSQL-backed graph store with JSONB attributes, GIN indexes, and recursive CTE traversal.
- Lifecycle management (`active` → `deprecated` → `archived` → `purged`) with retention policy.
- Semantic guardrails registry — configurable rules evaluated on every mutation.
- Per-tenant and per-traversal-profile context package cache (5 min TTL, warm-up on restart).
- MCP server exposing core graph operations to AI agents.
- Web frontend — layer explorer, node/edge browser, violation dashboard.

### Bug Fixes

None (initial release).

### Security

None (initial release).

### Upgrading

First installation — see README for setup instructions.

### License

This release is licensed under BSL 1.1.
Change Date: 2030-04-26 — on that date this version converts to Apache License 2.0.
For commercial licensing enquiries: https://github.com/MichalHlavac
