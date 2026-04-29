import { Hono } from "hono";
import type { Sql } from "../db/client.js";
import type { LsdsCache } from "../cache/index.js";
import type { PostgresTraversalAdapter } from "../db/traversal-adapter.js";
import type { GuardrailsRegistry } from "../guardrails/index.js";
import type { LifecycleService } from "../lifecycle/index.js";
import type { NodeRow, EdgeRow, ViolationRow } from "../db/types.js";
import { getTenantId, jsonb } from "../routes/util.js";

// Agent API — machine-friendly surface for AI agent consumption.
// Returns minimal, structured payloads; uses application/json throughout.
// Bulk operations are preferred over per-item round-trips.

export function agentRouter(
  sql: Sql,
  cache: LsdsCache,
  adapter: PostgresTraversalAdapter,
  guardrails: GuardrailsRegistry,
  lifecycle: LifecycleService
): Hono {
  const app = new Hono();

  // ── Context package: full graph context for a node ─────────────────────────
  // Returns the node + its neighbors + open violations in one round-trip.
  app.get("/context/:nodeId", async (c) => {
    const tenantId = getTenantId(c);
    const { nodeId } = c.req.param();
    const depth = Math.min(Number(c.req.query("depth") ?? 2), 5);

    const cacheKey = `agent:ctx:${cache.traversalKey(tenantId, nodeId, depth, "both")}`;
    const hit = cache.traversals.get(cacheKey);
    if (hit) return c.json({ data: hit, cached: true });

    const [node] = await sql<NodeRow[]>`
      SELECT * FROM nodes WHERE id = ${nodeId} AND tenant_id = ${tenantId}
    `;
    if (!node) return c.json({ error: "not found" }, 404);

    const traversalResults = await adapter.traverseWithDepth(nodeId, depth, "both");
    const neighborIds = traversalResults.map((r) => r.nodeId).filter((id) => id !== nodeId);

    const [neighbors, edges, violations] = await Promise.all([
      neighborIds.length > 0
        ? sql<NodeRow[]>`SELECT * FROM nodes WHERE id = ANY(${neighborIds}) AND tenant_id = ${tenantId}`
        : Promise.resolve([] as NodeRow[]),
      sql<EdgeRow[]>`
        SELECT * FROM edges
        WHERE tenant_id = ${tenantId}
          AND (source_id = ${nodeId} OR target_id = ${nodeId})
      `,
      sql<ViolationRow[]>`
        SELECT * FROM violations
        WHERE tenant_id = ${tenantId} AND node_id = ${nodeId} AND resolved = FALSE
      `,
    ]);

    const result = {
      node,
      neighbors,
      edges,
      violations,
      traversal: traversalResults,
    };
    cache.traversals.set(cacheKey, result);
    return c.json({ data: result, cached: false });
  });

  // ── Bulk node lookup ────────────────────────────────────────────────────────
  app.post("/nodes/batch", async (c) => {
    const tenantId = getTenantId(c);
    const { ids } = await c.req.json() as { ids: string[] };
    if (!Array.isArray(ids) || ids.length === 0) return c.json({ data: [] });
    const nodes = await sql<NodeRow[]>`
      SELECT * FROM nodes WHERE id = ANY(${ids}) AND tenant_id = ${tenantId}
    `;
    return c.json({ data: nodes });
  });

  // ── Search nodes by attributes + text ──────────────────────────────────────
  app.post("/search", async (c) => {
    const tenantId = getTenantId(c);
    const body = await c.req.json() as {
      query?: string;
      attributes?: Record<string, unknown>;
      type?: string;
      layer?: string;
      lifecycleStatus?: string;
      limit?: number;
    };

    const limit = Math.min(body.limit ?? 20, 100);

    const nodes = await sql<NodeRow[]>`
      SELECT * FROM nodes
      WHERE tenant_id = ${tenantId}
        ${body.type ? sql`AND type = ${body.type}` : sql``}
        ${body.layer ? sql`AND layer = ${body.layer}` : sql``}
        ${body.lifecycleStatus ? sql`AND lifecycle_status = ${body.lifecycleStatus}` : sql``}
        ${body.attributes ? sql`AND attributes @> ${jsonb(sql, body.attributes)}` : sql``}
        ${body.query ? sql`AND (name ILIKE ${"%" + body.query + "%"} OR type ILIKE ${"%" + body.query + "%"})` : sql``}
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `;
    return c.json({ data: nodes });
  });

  // ── Active violations summary ───────────────────────────────────────────────
  app.get("/violations/summary", async (c) => {
    const tenantId = getTenantId(c);
    const summary = await sql<{ severity: string; count: string }[]>`
      SELECT severity, COUNT(*) AS count
      FROM violations
      WHERE tenant_id = ${tenantId} AND resolved = FALSE
      GROUP BY severity
    `;
    return c.json({
      data: summary.map((r) => ({ severity: r.severity, count: Number(r.count) })),
    });
  });

  // ── Evaluate guardrails for a node (dry-run) ───────────────────────────────
  app.post("/evaluate/:nodeId", async (c) => {
    const tenantId = getTenantId(c);
    const { nodeId } = c.req.param();
    const persist = c.req.query("persist") === "true";

    const [node] = await sql<NodeRow[]>`
      SELECT * FROM nodes WHERE id = ${nodeId} AND tenant_id = ${tenantId}
    `;
    if (!node) return c.json({ error: "not found" }, 404);

    const violations = await guardrails.evaluate(tenantId, node);
    if (persist && violations.length > 0) {
      await guardrails.persistViolations(tenantId, violations);
    }
    return c.json({ data: violations, persisted: persist && violations.length > 0 });
  });

  // ── Graph stats ─────────────────────────────────────────────────────────────
  app.get("/stats", async (c) => {
    const tenantId = getTenantId(c);
    const [stats] = await sql<{
      nodeCount: string;
      edgeCount: string;
      violationCount: string;
      activeNodes: string;
      deprecatedNodes: string;
      archivedNodes: string;
    }[]>`
      SELECT
        (SELECT COUNT(*) FROM nodes WHERE tenant_id = ${tenantId}) AS node_count,
        (SELECT COUNT(*) FROM edges WHERE tenant_id = ${tenantId}) AS edge_count,
        (SELECT COUNT(*) FROM violations WHERE tenant_id = ${tenantId} AND resolved = FALSE) AS violation_count,
        (SELECT COUNT(*) FROM nodes WHERE tenant_id = ${tenantId} AND lifecycle_status = 'ACTIVE') AS active_nodes,
        (SELECT COUNT(*) FROM nodes WHERE tenant_id = ${tenantId} AND lifecycle_status = 'DEPRECATED') AS deprecated_nodes,
        (SELECT COUNT(*) FROM nodes WHERE tenant_id = ${tenantId} AND lifecycle_status = 'ARCHIVED') AS archived_nodes
    `;
    return c.json({
      data: {
        nodes: {
          total: Number(stats.nodeCount),
          active: Number(stats.activeNodes),
          deprecated: Number(stats.deprecatedNodes),
          archived: Number(stats.archivedNodes),
        },
        edges: { total: Number(stats.edgeCount) },
        violations: { open: Number(stats.violationCount) },
      },
    });
  });

  return app;
}
