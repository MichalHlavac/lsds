// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import {
  DefaultTraversalEngine,
  TraversalError,
  type TraversalProfile,
} from "@lsds/framework";
import type { Sql } from "../db/client.js";
import type { LsdsCache } from "../cache/index.js";
import type { GuardrailsRegistry } from "../guardrails/index.js";
import type { LifecycleService } from "../lifecycle/index.js";
import type { NodeRow, EdgeRow, ViolationRow } from "../db/types.js";

// json_agg serializes PG timestamps as ISO 8601 strings, not Date objects.
// These DTOs reflect the actual runtime shape returned by the single-CTE query.
type IsoString = string;
interface ContextNodeRow extends Omit<NodeRow, "createdAt" | "updatedAt" | "deprecatedAt" | "archivedAt" | "purgeAfter"> {
  createdAt: IsoString; updatedAt: IsoString;
  deprecatedAt: IsoString | null; archivedAt: IsoString | null; purgeAfter: IsoString | null;
}
interface ContextEdgeRow extends Omit<EdgeRow, "createdAt" | "updatedAt" | "deprecatedAt" | "archivedAt" | "purgeAfter"> {
  createdAt: IsoString; updatedAt: IsoString;
  deprecatedAt: IsoString | null; archivedAt: IsoString | null; purgeAfter: IsoString | null;
}
interface ContextViolationRow extends Omit<ViolationRow, "createdAt" | "updatedAt" | "resolvedAt"> {
  createdAt: IsoString; updatedAt: IsoString; resolvedAt: IsoString | null;
}
import { getTenantId, jsonb } from "../routes/util.js";
import { AgentSearchSchema, BatchIdsSchema, SemanticSearchSchema, KnowledgeContextSchema } from "../routes/schemas.js";
import type { EmbeddingService } from "../embeddings/index.js";
import { PostgresGraphRepository } from "../db/graph-repository.js";
import { PostgresTraversalAdapter } from "../db/traversal-adapter.js";
import { checkNaming } from "../guardrails/naming.js";

// Dependency-class edge types followed by the "depth" traversal profile.
const DEPTH_EDGE_TYPES = ["depends-on", "implements", "realizes"] as const;

// Agent API — machine-friendly surface for AI agent consumption.
// Returns minimal, structured payloads; uses application/json throughout.
// Bulk operations are preferred over per-item round-trips.

const VALID_PROFILES: ReadonlySet<string> = new Set(["OPERATIONAL", "ANALYTICAL", "FULL"]);

export function agentRouter(
  sql: Sql,
  cache: LsdsCache,
  guardrails: GuardrailsRegistry,
  lifecycle: LifecycleService,
  embeddingService?: EmbeddingService
): Hono {
  const app = new Hono();

  // ── Context package: full graph context for a node ─────────────────────────
  // Returns a ContextPackage assembled by DefaultTraversalEngine.
  // ?profile=OPERATIONAL|ANALYTICAL|FULL (default OPERATIONAL)
  // ?tokenBudget=<number>               (default 4000)
  app.get("/context/:nodeId", async (c) => {
    const tenantId = getTenantId(c);
    const { nodeId } = c.req.param();

    const profileParam = c.req.query("profile") ?? "OPERATIONAL";
    if (!VALID_PROFILES.has(profileParam)) {
      return c.json({ error: "invalid profile: must be OPERATIONAL, ANALYTICAL, or FULL" }, 400);
    }
    const profile = profileParam as TraversalProfile;

    const tokenBudgetParam = c.req.query("tokenBudget");
    const tokenBudget = tokenBudgetParam != null ? Number(tokenBudgetParam) : undefined;
    if (tokenBudget !== undefined && (!Number.isFinite(tokenBudget) || tokenBudget <= 0)) {
      return c.json({ error: "tokenBudget must be a positive number" }, 400);
    }

    const cacheKey = `agent:ctx:${tenantId}:${nodeId}:${profile}:${tokenBudget ?? ""}`;
    const hit = cache.traversals.get(cacheKey);
    if (hit) return c.json({ data: hit, cached: true });

    const repo = new PostgresGraphRepository(sql, tenantId);
    const engine = new DefaultTraversalEngine(repo);

    try {
      const pkg = await engine.traverse(nodeId, { profile, tokenBudget });
      cache.traversals.set(cacheKey, pkg);
      return c.json({ data: pkg, cached: false });
    } catch (e) {
      if (e instanceof TraversalError) {
        return c.json({ error: e.message }, 404);
      }
      throw e;
    }
  });

  // ── Knowledge Agent context package ────────────────────────────────────────
  // POST /agent/v1/context
  // Returns structured graph context for an AI agent via one of three profiles:
  //   depth    — outbound DFS via dependency edges (depends-on/implements/realizes), max depth 5
  //   breadth  — BFS via all edge types, max hops 2
  //   semantic — cosine-similarity neighbourhood; falls back to breadth if no embedding
  app.post("/context", async (c) => {
    const tenantId = getTenantId(c);
    const body = KnowledgeContextSchema.parse(await c.req.json());
    const { nodeId, profile, maxNodes, minSimilarity } = body;

    const [root] = await sql<NodeRow[]>`
      SELECT * FROM nodes
      WHERE id = ${nodeId} AND tenant_id = ${tenantId}
        AND lifecycle_status NOT IN ('ARCHIVED', 'PURGE')
    `;
    if (!root) return c.json({ error: "not found" }, 404);

    const cacheKey = `agent:kctx:${tenantId}:${nodeId}:${profile}:${maxNodes}:${minSimilarity}`;
    const hit = cache.traversals.get(cacheKey);
    if (hit) return c.json({ ...hit, cached: true });

    const adapter = new PostgresTraversalAdapter(sql, tenantId);
    let traversalIds: string[] = [];

    if (profile === "depth") {
      const results = await adapter.traverseWithDepth(nodeId, 5, "outbound", [...DEPTH_EDGE_TYPES]);
      traversalIds = results.filter((r) => r.nodeId !== nodeId).map((r) => r.nodeId);
    } else if (profile === "breadth") {
      const results = await adapter.traverseWithDepth(nodeId, 2, "both");
      traversalIds = results.filter((r) => r.nodeId !== nodeId).map((r) => r.nodeId);
    } else {
      // semantic: find nodes closest by cosine similarity; fallback to breadth
      let usedBreadthFallback = false;
      if (embeddingService) {
        const [embRow] = await sql<[{ embedding: string | null }]>`
          SELECT embedding::text AS embedding FROM nodes
          WHERE id = ${nodeId} AND tenant_id = ${tenantId}
        `;
        if (embRow?.embedding) {
          const emb = embRow.embedding;
          const rows = await sql<Array<{ id: string; score: number }>>`
            SELECT id, (1 - (embedding <=> ${emb}::vector))::float AS score
            FROM nodes
            WHERE tenant_id = ${tenantId}
              AND id != ${nodeId}
              AND embedding IS NOT NULL
              AND lifecycle_status NOT IN ('ARCHIVED', 'PURGE')
            ORDER BY embedding <=> ${emb}::vector
            LIMIT ${maxNodes + 1}
          `;
          traversalIds = rows
            .filter((r) => r.score >= minSimilarity)
            .slice(0, maxNodes)
            .map((r) => r.id);
        } else {
          usedBreadthFallback = true;
        }
      } else {
        usedBreadthFallback = true;
      }
      if (usedBreadthFallback) {
        const results = await adapter.traverseWithDepth(nodeId, 2, "both");
        traversalIds = results.filter((r) => r.nodeId !== nodeId).map((r) => r.nodeId);
      }
    }

    // Single CTE: collapse nodes + edges + violations into one round-trip.
    // json_agg preserves DB column names (snake_case); sc2cc converts them to
    // camelCase. T is one of the Context*Row DTOs above — dates are strings.
    const sc2cc = <T>(rows: Array<Record<string, unknown>>): T[] =>
      rows.map((r) =>
        Object.fromEntries(
          Object.entries(r).map(([k, v]) => [
            k.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase()),
            v,
          ])
        )
      ) as unknown as T[];

    const [ctx] = await sql<[{
      nodesJson: Array<Record<string, unknown>> | null;
      edgesJson: Array<Record<string, unknown>> | null;
      violationsJson: Array<Record<string, unknown>> | null;
    }]>`
      WITH ctx_nodes AS (
        ${traversalIds.length > 0
          ? sql`SELECT * FROM nodes
                WHERE id = ANY(${traversalIds})
                  AND tenant_id = ${tenantId}
                  AND lifecycle_status NOT IN ('ARCHIVED', 'PURGE')`
          : sql`SELECT * FROM nodes WHERE FALSE`}
      ),
      all_ids(id) AS (
        SELECT id FROM ctx_nodes
        UNION ALL SELECT ${nodeId}::uuid
      )
      SELECT
        COALESCE((SELECT json_agg(n.*) FROM ctx_nodes n), '[]'::json)              AS nodes_json,
        COALESCE((SELECT json_agg(e.*) FROM edges e
          WHERE e.tenant_id = ${tenantId}
            AND e.source_id = ANY(SELECT id FROM all_ids)
            AND e.target_id = ANY(SELECT id FROM all_ids)), '[]'::json)            AS edges_json,
        COALESCE((SELECT json_agg(v.*) FROM violations v
          WHERE v.tenant_id = ${tenantId}
            AND v.node_id = ANY(SELECT id FROM all_ids)
            AND v.resolved = FALSE), '[]'::json)                                   AS violations_json
    `;

    let nodes = sc2cc<ContextNodeRow>(ctx.nodesJson ?? []);
    const truncated = nodes.length > maxNodes;
    if (truncated) nodes = nodes.slice(0, maxNodes);

    const allIdSet = new Set([nodeId, ...nodes.map((n) => n.id)]);
    const edges = sc2cc<ContextEdgeRow>(ctx.edgesJson ?? [])
      .filter((e) => allIdSet.has(e.sourceId) && allIdSet.has(e.targetId));
    const violations = sc2cc<ContextViolationRow>(ctx.violationsJson ?? [])
      .filter((v) => v.nodeId != null && allIdSet.has(v.nodeId));

    const payload = { root, nodes, edges, violations, profile, truncated };
    cache.traversals.set(cacheKey, payload);
    return c.json({ ...payload, cached: false });
  });

  // ── Bulk node lookup ────────────────────────────────────────────────────────
  app.post("/nodes/batch", async (c) => {
    const tenantId = getTenantId(c);
    const { ids } = BatchIdsSchema.parse(await c.req.json());
    const nodes = await sql<NodeRow[]>`
      SELECT * FROM nodes WHERE id = ANY(${ids}) AND tenant_id = ${tenantId}
    `;
    return c.json({ data: nodes });
  });

  // ── Search nodes by attributes + text ──────────────────────────────────────
  app.post("/search", async (c) => {
    const tenantId = getTenantId(c);
    const body = AgentSearchSchema.parse(await c.req.json());
    const { limit } = body;

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

  // ── Semantic search: cosine similarity over node embeddings ────────────────
  app.post("/search/semantic", async (c) => {
    const tenantId = getTenantId(c);
    const body = SemanticSearchSchema.parse(await c.req.json());
    if (!embeddingService) {
      return c.json({ error: "semantic search is not enabled (EMBEDDING_PROVIDER not set)" }, 503);
    }

    const vectorLiteral = await embeddingService.embedQuery(body.query);

    const rows = await sql<
      Array<
        NodeRow & { score: number }
      >
    >`
      SELECT
        id, tenant_id, type, layer, name, version,
        lifecycle_status, attributes,
        created_at, updated_at,
        deprecated_at, archived_at, purge_after,
        (1 - (embedding <=> ${vectorLiteral}::vector))::float AS score
      FROM nodes
      WHERE tenant_id = ${tenantId}
        AND embedding IS NOT NULL
        AND lifecycle_status NOT IN ('ARCHIVED', 'PURGE')
        ${body.type ? sql`AND type = ${body.type}` : sql``}
        ${body.layer ? sql`AND layer = ${body.layer}` : sql``}
      ORDER BY embedding <=> ${vectorLiteral}::vector
      LIMIT ${body.limit}
    `;

    const filtered =
      body.minScore !== undefined
        ? rows.filter((r) => r.score >= body.minScore!)
        : rows;

    return c.json({
      data: filtered.map(({ score, ...node }) => ({ node, score })),
    });
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

  // ── Write guidance: guardrails-as-guidance for a node type (kap. 6.2) ──────
  // Returns the relevant guardrails (with rationale + remediation) so the agent
  // can self-assess before drafting a node. The framework still runs final
  // validation on write — the AI self-assessment is advisory.
  app.get("/write-guidance/:nodeType", async (c) => {
    const tenantId = getTenantId(c);
    const { nodeType } = c.req.param();
    const guardrailsForType = await guardrails.getForType(tenantId, nodeType);
    return c.json({
      data: {
        nodeType,
        guardrails: guardrailsForType,
        instruction:
          "For each rule above, verify your proposed object satisfies the condition. Return a self_assessment mapping ruleKey → {passes: boolean, notes: string}. The framework runs final validation on write — your self-assessment is advisory.",
      },
    });
  });

  // ── Naming convention check (pure logic, no DB) ────────────────────────────
  app.get("/naming-check", (c) => {
    const type = c.req.query("type") ?? "";
    const name = c.req.query("name") ?? "";
    if (!type || !name) {
      return c.json({ error: "type and name query params are required" }, 400);
    }
    const result = checkNaming(type, name);
    return c.json({ data: { type, name, ...result } });
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
