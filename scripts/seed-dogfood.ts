#!/usr/bin/env tsx
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Idempotent dogfood seed script for LSDS-264 Phase 0 pilot.
// Seeds LSDS's own bounded-context architecture into a running LSDS instance.
//
// Usage:
//   LSDS_API_URL=http://localhost:3000 LSDS_TENANT_ID=<uuid> tsx scripts/seed-dogfood.ts
//
// Safe to re-run — uses PUT (upsert) so duplicate nodes/edges are never created.

const API_URL = process.env.LSDS_API_URL ?? "http://localhost:3000";
const TENANT_ID = process.env.LSDS_TENANT_ID;

if (!TENANT_ID) {
  console.error("Error: LSDS_TENANT_ID env var is required");
  process.exit(1);
}

const headers = {
  "content-type": "application/json",
  "x-tenant-id": TENANT_ID,
};

// ── helpers ───────────────────────────────────────────────────────────────────

async function upsertNode(node: {
  type: string;
  layer: string;
  name: string;
  version?: string;
  attributes?: Record<string, unknown>;
}): Promise<{ id: string; name: string }> {
  const res = await fetch(`${API_URL}/v1/nodes`, {
    method: "PUT",
    headers,
    body: JSON.stringify(node),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PUT /v1/nodes failed (${res.status}): ${body}`);
  }
  const { data } = (await res.json()) as { data: { id: string; name: string } };
  const verb = res.status === 201 ? "created" : "updated";
  console.log(`  [${verb}] ${node.layer} ${node.type} "${node.name}" (${data.id})`);
  return data;
}

async function upsertEdge(edge: {
  sourceId: string;
  targetId: string;
  type: string;
  layer: string;
  traversalWeight?: number;
  attributes?: Record<string, unknown>;
}): Promise<void> {
  const res = await fetch(`${API_URL}/v1/edges`, {
    method: "PUT",
    headers,
    body: JSON.stringify(edge),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PUT /v1/edges failed (${res.status}): ${body}`);
  }
  const verb = res.status === 201 ? "created" : "updated";
  console.log(`  [${verb}] edge ${edge.type} (${edge.sourceId} → ${edge.targetId})`);
}

// ── seed data ─────────────────────────────────────────────────────────────────
//
// Layer semantics (kap. 4 of LSDS research):
//   L1 — Business goals, capabilities, requirements
//   L2 — Bounded contexts, aggregates, domain entities
//   L3 — Architecture components, ADRs, systems
//   L4 — Services, API contracts, data contracts
//   L5 — Packages, modules, implementation units
//   L6 — Deployment units, environments, infrastructure

type SeedNode = { type: string; layer: string; name: string; attributes?: Record<string, unknown> };

const NODES: SeedNode[] = [
  // ── L1: Business goals ────────────────────────────────────────────────────
  {
    type: "BusinessGoal",
    layer: "L1",
    name: "Architecture Documentation",
    attributes: { description: "Maintain a living, queryable record of system architecture across all layers." },
  },
  {
    type: "BusinessCapability",
    layer: "L1",
    name: "Architecture Governance",
    attributes: { description: "Detect drift, enforce guardrails, and manage lifecycle of architectural elements." },
  },

  // ── L2: Bounded contexts ─────────────────────────────────────────────────
  {
    type: "BoundedContext",
    layer: "L2",
    name: "Framework Core",
    attributes: { description: "Type system, relationship registry, traversal engine, guardrail framework.", path: "packages/framework" },
  },
  {
    type: "BoundedContext",
    layer: "L2",
    name: "Core Application",
    attributes: { description: "Persistence, REST/Agent API, cache, lifecycle, semantic guardrails registry.", path: "apps/api" },
  },
  {
    type: "BoundedContext",
    layer: "L2",
    name: "Web UI",
    attributes: { description: "Browser-based interface for graph exploration, lifecycle management, and search.", path: "apps/web" },
  },
  {
    type: "BoundedContext",
    layer: "L2",
    name: "CLI Tools",
    attributes: { description: "Backup, restore, and diagnostics bundle commands.", path: "apps/cli" },
  },
  {
    type: "BoundedContext",
    layer: "L2",
    name: "MCP Integration",
    attributes: { description: "MCP server wrapping the agent API for LLM tool-use.", path: "apps/mcp" },
  },

  // ── L3: Architecture components ───────────────────────────────────────────
  {
    type: "ArchitectureComponent",
    layer: "L3",
    name: "PostgreSQL Graph Store",
    attributes: { description: "Nodes/edges/violations/snapshots tables with JSONB attributes and tenant isolation.", technology: "PostgreSQL 15+" },
  },
  {
    type: "ArchitectureComponent",
    layer: "L3",
    name: "Traversal Engine",
    attributes: { description: "Recursive CTE-based depth-first traversal with per-profile context package cache.", technology: "postgres-js" },
  },
  {
    type: "ArchitectureComponent",
    layer: "L3",
    name: "REST API Server",
    attributes: { description: "Hono-based typed REST API for nodes/edges/violations/lifecycle/guardrails.", technology: "Hono + Zod" },
  },
  {
    type: "ArchitectureComponent",
    layer: "L3",
    name: "Auth Middleware",
    attributes: { description: "OIDC JWT validation middleware; bypassed in dev mode.", technology: "jose" },
  },
  {
    type: "ArchitectureComponent",
    layer: "L3",
    name: "Lifecycle Engine",
    attributes: { description: "Soft deprecate → archive → purge with configurable retention policy (default 2 years)." },
  },
  {
    type: "ArchitectureComponent",
    layer: "L3",
    name: "Semantic Guardrails Registry",
    attributes: { description: "Configurable per-installation rules: thresholds, naming conventions, review cycles." },
  },

  // ── L5: Implementation packages ───────────────────────────────────────────
  {
    type: "Package",
    layer: "L5",
    name: "apps/api",
    attributes: { description: "Core Application: Hono API server, PostgreSQL persistence, cache.", language: "TypeScript" },
  },
  {
    type: "Package",
    layer: "L5",
    name: "apps/web",
    attributes: { description: "Web UI: Next.js browser application.", language: "TypeScript" },
  },
  {
    type: "Package",
    layer: "L5",
    name: "apps/cli",
    attributes: { description: "CLI: backup/restore/diagnostics commands.", language: "TypeScript" },
  },
  {
    type: "Package",
    layer: "L5",
    name: "apps/mcp",
    attributes: { description: "MCP server wrapping the agent API.", language: "TypeScript" },
  },
  {
    type: "Package",
    layer: "L5",
    name: "packages/framework",
    attributes: { description: "Framework Core: type system, relationship registry, traversal, guardrails.", language: "TypeScript" },
  },
  {
    type: "Package",
    layer: "L5",
    name: "packages/shared",
    attributes: { description: "Shared Zod schemas and domain types used across packages.", language: "TypeScript" },
  },
];

// Edge definitions referencing node names; resolved to IDs after upsert.
// Edge type layer rules enforced by the API (kap. 2.2 / relationship registry).
type SeedEdge = {
  sourceName: string;
  targetName: string;
  type: string;
  layer: string;
  traversalWeight?: number;
};

const EDGES: SeedEdge[] = [
  // L2 bounded contexts trace-to L1 goals (traces-to: SOURCE_GTE_TARGET, L2→L1 ✓)
  { sourceName: "Core Application",  targetName: "Architecture Documentation", type: "traces-to", layer: "L2" },
  { sourceName: "Framework Core",    targetName: "Architecture Documentation", type: "traces-to", layer: "L2" },
  { sourceName: "Web UI",            targetName: "Architecture Governance",    type: "traces-to", layer: "L2" },

  // L2 contains L3 components (contains: SOURCE_LTE_TARGET, L2→L3 ✓)
  { sourceName: "Core Application",  targetName: "PostgreSQL Graph Store",      type: "contains", layer: "L2" },
  { sourceName: "Core Application",  targetName: "Traversal Engine",            type: "contains", layer: "L2" },
  { sourceName: "Core Application",  targetName: "REST API Server",             type: "contains", layer: "L2" },
  { sourceName: "Core Application",  targetName: "Auth Middleware",             type: "contains", layer: "L2" },
  { sourceName: "Core Application",  targetName: "Lifecycle Engine",            type: "contains", layer: "L2" },
  { sourceName: "Core Application",  targetName: "Semantic Guardrails Registry",type: "contains", layer: "L2" },

  // L5 packages realize L2 bounded contexts (realizes: SOURCE_GTE_TARGET, L5→L2 ✓)
  { sourceName: "apps/api",          targetName: "Core Application",  type: "realizes", layer: "L5" },
  { sourceName: "apps/web",          targetName: "Web UI",            type: "realizes", layer: "L5" },
  { sourceName: "apps/cli",          targetName: "CLI Tools",         type: "realizes", layer: "L5" },
  { sourceName: "apps/mcp",          targetName: "MCP Integration",   type: "realizes", layer: "L5" },
  { sourceName: "packages/framework",targetName: "Framework Core",    type: "realizes", layer: "L5" },

  // L5 package dependencies (depends-on: SOURCE_LTE_TARGET, L5→L5 ✓)
  { sourceName: "apps/api",          targetName: "packages/framework", type: "depends-on", layer: "L5" },
  { sourceName: "apps/api",          targetName: "packages/shared",    type: "depends-on", layer: "L5" },
  { sourceName: "apps/web",          targetName: "packages/shared",    type: "depends-on", layer: "L5" },
  { sourceName: "apps/cli",          targetName: "packages/shared",    type: "depends-on", layer: "L5" },
  { sourceName: "apps/mcp",          targetName: "packages/shared",    type: "depends-on", layer: "L5" },
  { sourceName: "packages/framework",targetName: "packages/shared",    type: "depends-on", layer: "L5" },
];

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Seeding LSDS dogfood instance at ${API_URL} (tenant: ${TENANT_ID})\n`);

  // Health check
  const health = await fetch(`${API_URL}/health`);
  if (!health.ok) throw new Error(`API not reachable at ${API_URL}/health`);

  // Upsert all nodes, build name → id map
  console.log("── Nodes ─────────────────────────────────────────────────");
  const idByName = new Map<string, string>();
  for (const node of NODES) {
    const data = await upsertNode(node);
    idByName.set(data.name, data.id);
  }

  // Upsert all edges
  console.log("\n── Edges ─────────────────────────────────────────────────");
  for (const edge of EDGES) {
    const sourceId = idByName.get(edge.sourceName);
    const targetId = idByName.get(edge.targetName);
    if (!sourceId) throw new Error(`Unknown source node name: "${edge.sourceName}"`);
    if (!targetId) throw new Error(`Unknown target node name: "${edge.targetName}"`);
    await upsertEdge({ ...edge, sourceId, targetId });
  }

  console.log(`\n✓ Seed complete — ${NODES.length} nodes, ${EDGES.length} edges`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
