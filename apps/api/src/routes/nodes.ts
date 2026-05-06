// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import type { Sql } from "../db/client.js";
import type { LsdsCache } from "../cache/index.js";
import type { NodeHistoryRow, NodeRow } from "../db/types.js";
import { LifecycleTransitionError, type LifecycleService } from "../lifecycle/index.js";
import { recordNodeHistory } from "../db/history.js";
import {
  CreateNodeSchema,
  UpdateNodeSchema,
  LifecycleTransitionSchema,
  BatchLifecycleSchema,
  NODE_SORT_FIELDS,
  SORT_ORDER_VALUES,
  type NodeSortField,
} from "./schemas.js";
import { getTenantId, jsonb } from "./util.js";
import type { EmbeddingService } from "../embeddings/index.js";
import type { GuardrailsRegistry } from "../guardrails/index.js";
import { getViolationSuggestion, getNamingGuidance } from "../guardrails/naming.js";

export function nodesRouter(
  sql: Sql,
  cache: LsdsCache,
  lifecycle: LifecycleService,
  embeddingService: EmbeddingService | undefined,
  guardrails: GuardrailsRegistry
): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const tenantId = getTenantId(c);
    const q = c.req.query("q");
    const type = c.req.query("type");
    const layer = c.req.query("layer");
    const lifecycleStatus = c.req.query("lifecycleStatus");
    const includeArchived = c.req.query("includeArchived") === "true";
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 500);
    const offset = Number(c.req.query("offset") ?? 0);
    const sortByRaw = c.req.query("sortBy");
    const orderRaw = c.req.query("order");

    if (sortByRaw && !(NODE_SORT_FIELDS as readonly string[]).includes(sortByRaw)) {
      return c.json({ error: `invalid sortBy: must be one of ${NODE_SORT_FIELDS.join(", ")}` }, 400);
    }
    if (orderRaw && !(SORT_ORDER_VALUES as readonly string[]).includes(orderRaw)) {
      return c.json({ error: "invalid order: must be 'asc' or 'desc'" }, 400);
    }

    const sortColMap: Record<NodeSortField, ReturnType<typeof sql>> = {
      name: sql`name`,
      createdAt: sql`created_at`,
      updatedAt: sql`updated_at`,
      type: sql`type`,
      layer: sql`layer`,
      lifecycleStatus: sql`lifecycle_status`,
    };

    const sortCol = sortByRaw ? sortColMap[sortByRaw as NodeSortField] : sql`created_at`;
    const sortDir = (orderRaw ?? (sortByRaw ? "asc" : "desc")) === "desc" ? sql`DESC` : sql`ASC`;

    const whereClause = sql`
      WHERE tenant_id = ${tenantId}
        ${q ? sql`AND (name ILIKE ${"%" + q + "%"} OR type ILIKE ${"%" + q + "%"})` : sql``}
        ${type ? sql`AND type = ${type}` : sql``}
        ${layer ? sql`AND layer = ${layer}` : sql``}
        ${lifecycleStatus ? sql`AND lifecycle_status = ${lifecycleStatus}` : !includeArchived ? sql`AND lifecycle_status != 'ARCHIVED'` : sql``}
    `;

    const [rows, [{ count }]] = await Promise.all([
      sql<NodeRow[]>`SELECT * FROM nodes ${whereClause} ORDER BY ${sortCol} ${sortDir} LIMIT ${limit} OFFSET ${offset}`,
      sql<[{ count: string }]>`SELECT COUNT(*)::text AS count FROM nodes ${whereClause}`,
    ]);
    return c.json({ data: rows, total: Number(count) });
  });

  app.post("/", async (c) => {
    const tenantId = getTenantId(c);
    const body = CreateNodeSchema.parse(await c.req.json());
    try {
      const [row] = await sql<NodeRow[]>`
        INSERT INTO nodes (tenant_id, type, layer, name, version, lifecycle_status, attributes)
        VALUES (
          ${tenantId}, ${body.type}, ${body.layer}, ${body.name},
          ${body.version}, ${body.lifecycleStatus}, ${jsonb(sql, body.attributes)}
        )
        RETURNING *
      `;
      await recordNodeHistory(sql, tenantId, row.id, "CREATE", null, row);
      embeddingService?.embedNodeAsync(tenantId, row.id, embeddingService.nodeText(row));
      return c.json({ data: row }, 201);
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "23505") {
        return c.json({ error: "node already exists with this type, layer, and name; use PUT to upsert" }, 409);
      }
      throw err;
    }
  });

  app.put("/", async (c) => {
    const tenantId = getTenantId(c);
    const body = CreateNodeSchema.parse(await c.req.json());

    const [previous] = await sql<NodeRow[]>`
      SELECT * FROM nodes
      WHERE tenant_id = ${tenantId} AND type = ${body.type} AND layer = ${body.layer} AND name = ${body.name}
    `;

    const [row] = await sql<NodeRow[]>`
      INSERT INTO nodes (tenant_id, type, layer, name, version, lifecycle_status, attributes)
      VALUES (
        ${tenantId}, ${body.type}, ${body.layer}, ${body.name},
        ${body.version}, ${body.lifecycleStatus}, ${jsonb(sql, body.attributes)}
      )
      ON CONFLICT (tenant_id, type, layer, name)
      DO UPDATE SET
        version = EXCLUDED.version,
        attributes = EXCLUDED.attributes,
        updated_at = now()
      RETURNING *
    `;

    const op = previous ? "UPDATE" : "CREATE";
    await recordNodeHistory(sql, tenantId, row.id, op, previous ?? null, row);
    embeddingService?.embedNodeAsync(tenantId, row.id, embeddingService.nodeText(row));
    return c.json({ data: row }, previous ? 200 : 201);
  });

  app.post("/batch-lifecycle", async (c) => {
    const tenantId = getTenantId(c);
    const body = BatchLifecycleSchema.parse(await c.req.json());

    const results = await Promise.allSettled(
      body.ids.map((id) => lifecycle.transitionNode(tenantId, id, body.transition))
    );

    const succeeded: NodeRow[] = [];
    const failed: Array<{
      id: string;
      error: string;
      currentStatus?: string;
      requestedTransition?: string;
      allowed?: string[];
    }> = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const id = body.ids[i];
      if (result.status === "fulfilled") {
        succeeded.push(result.value);
      } else {
        const e = result.reason;
        if (e instanceof LifecycleTransitionError) {
          failed.push({
            id,
            error: e.message,
            currentStatus: e.currentStatus,
            requestedTransition: e.requestedTransition,
            allowed: e.allowed,
          });
        } else if (e instanceof Error && e.message === "node not found") {
          failed.push({ id, error: "not found" });
        } else {
          failed.push({ id, error: String(e instanceof Error ? e.message : e) });
        }
      }
    }

    const status = failed.length === 0 ? 200 : succeeded.length === 0 ? 422 : 207;
    return c.json({ data: { succeeded, failed } }, status as 200 | 207 | 422);
  });

  // Dry-run: evaluate guardrails against a draft node without persisting.
  // Returns violations that *would* occur plus fix suggestions and naming guidance.
  app.post("/preview-violations", async (c) => {
    const tenantId = getTenantId(c);
    const body = CreateNodeSchema.parse(await c.req.json());

    const draft = {
      id: "",
      tenantId,
      type: body.type,
      layer: body.layer,
      name: body.name,
      version: body.version,
      lifecycleStatus: body.lifecycleStatus,
      attributes: body.attributes,
      createdAt: new Date(),
      updatedAt: new Date(),
      deprecatedAt: null,
      archivedAt: null,
      purgeAfter: null,
    };

    const rawViolations = await guardrails.evaluate(tenantId, draft);
    // Strip node ID — draft has no persisted ID
    const violations = rawViolations.map(({ nodeId: _id, ...rest }) => rest);
    const suggestions = rawViolations.map(getViolationSuggestion);
    const namingGuidance = getNamingGuidance(body.type, body.name);

    return c.json({ data: { violations, suggestions, namingGuidance } });
  });

  app.get("/:id", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const cached = cache.nodes.get(cache.nodeKey(tenantId, id));
    if (cached) return c.json({ data: cached });

    const [row] = await sql<NodeRow[]>`
      SELECT * FROM nodes WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!row) return c.json({ error: "not found" }, 404);
    cache.nodes.set(cache.nodeKey(tenantId, id), row);
    return c.json({ data: row });
  });

  app.patch("/:id", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const body = UpdateNodeSchema.parse(await c.req.json());

    const [previous] = await sql<NodeRow[]>`
      SELECT * FROM nodes WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!previous) return c.json({ error: "not found" }, 404);

    if (previous.lifecycleStatus === "DEPRECATED" && body.attributes !== undefined) {
      return c.json({ error: "attributes are immutable on DEPRECATED nodes" }, 422);
    }

    const [row] = await sql<NodeRow[]>`
      UPDATE nodes SET
        ${body.name !== undefined ? sql`name = ${body.name},` : sql``}
        ${body.version !== undefined ? sql`version = ${body.version},` : sql``}
        ${body.lifecycleStatus !== undefined ? sql`lifecycle_status = ${body.lifecycleStatus},` : sql``}
        ${body.attributes !== undefined ? sql`attributes = ${jsonb(sql, body.attributes)},` : sql``}
        updated_at = now()
      WHERE id = ${id} AND tenant_id = ${tenantId}
      RETURNING *
    `;
    if (!row) return c.json({ error: "not found" }, 404);
    const neighborEdges = await sql<{ sourceId: string; targetId: string }[]>`
      SELECT DISTINCT source_id, target_id FROM edges
      WHERE tenant_id = ${tenantId} AND (source_id = ${id} OR target_id = ${id})
    `;
    const neighborIds = [...new Set(neighborEdges.flatMap(e => [e.sourceId, e.targetId]).filter(nid => nid !== id))];
    cache.invalidateNode(tenantId, id, neighborIds);
    await recordNodeHistory(sql, tenantId, id, "UPDATE", previous, row);
    // `type` and `layer` are not in UpdateNodeSchema (immutable after creation), so
    // only `name` and `attributes` can affect the embedded text.
    if (body.name !== undefined || body.attributes !== undefined) {
      embeddingService?.embedNodeAsync(tenantId, id, embeddingService.nodeText(row));
    }
    return c.json({ data: row });
  });

  app.patch("/:id/lifecycle", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const body = LifecycleTransitionSchema.parse(await c.req.json());

    const [previous] = await sql<NodeRow[]>`
      SELECT * FROM nodes WHERE id = ${id} AND tenant_id = ${tenantId}
    `;

    try {
      const row = await lifecycle.transitionNode(tenantId, id, body.transition);
      if (previous) {
        await recordNodeHistory(sql, tenantId, id, "LIFECYCLE_TRANSITION", previous, row);
      }
      return c.json({ data: row });
    } catch (e) {
      if (e instanceof LifecycleTransitionError) {
        return c.json(
          {
            error: "invalid lifecycle transition",
            currentStatus: e.currentStatus,
            requestedTransition: e.requestedTransition,
            allowed: e.allowed,
          },
          422
        );
      }
      if (e instanceof Error && e.message === "node not found") {
        return c.json({ error: "not found" }, 404);
      }
      return c.json({ error: String(e) }, 400);
    }
  });

  app.delete("/:id", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();

    const [existing] = await sql<NodeRow[]>`
      SELECT * FROM nodes WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!existing) return c.json({ error: "not found" }, 404);
    if (existing.lifecycleStatus !== "ARCHIVED") {
      return c.json({ error: "node must be ARCHIVED before it can be purged" }, 422);
    }

    const retentionDays = Number(process.env.LIFECYCLE_RETENTION_DAYS ?? 30);
    const archivedAt = existing.archivedAt ? new Date(existing.archivedAt).getTime() : 0;
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    if (Date.now() - archivedAt < retentionMs) {
      return c.json({ error: `retention period of ${retentionDays} days has not elapsed since archival` }, 422);
    }

    const neighborEdges = await sql<{ sourceId: string; targetId: string }[]>`
      SELECT DISTINCT source_id, target_id FROM edges
      WHERE tenant_id = ${tenantId} AND (source_id = ${id} OR target_id = ${id})
    `;
    const neighborIds = [...new Set(neighborEdges.flatMap(e => [e.sourceId, e.targetId]).filter(nid => nid !== id))];
    await sql`DELETE FROM nodes WHERE id = ${id} AND tenant_id = ${tenantId}`;
    cache.invalidateNode(tenantId, id, neighborIds);
    return c.json({ data: { id } });
  });

  app.get("/:id/neighbors", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const direction = (c.req.query("direction") ?? "both") as "outbound" | "inbound" | "both";
    const edgeTypesRaw = c.req.query("edgeTypes");
    const edgeTypes = edgeTypesRaw?.split(",").filter(Boolean);

    const cacheKey = cache.traversalKey(tenantId, id, 1, direction, edgeTypes);
    const hit = cache.traversals.get(cacheKey);
    if (hit) return c.json({ data: hit });

    let outboundNodes: NodeRow[] = [];
    let inboundNodes: NodeRow[] = [];

    if (direction === "outbound" || direction === "both") {
      outboundNodes = await sql<NodeRow[]>`
        SELECT n.* FROM nodes n
        JOIN edges e ON e.target_id = n.id
        WHERE e.source_id = ${id} AND n.tenant_id = ${tenantId}
          ${edgeTypes?.length ? sql`AND e.type = ANY(${edgeTypes})` : sql``}
      `;
    }
    if (direction === "inbound" || direction === "both") {
      inboundNodes = await sql<NodeRow[]>`
        SELECT n.* FROM nodes n
        JOIN edges e ON e.source_id = n.id
        WHERE e.target_id = ${id} AND n.tenant_id = ${tenantId}
          ${edgeTypes?.length ? sql`AND e.type = ANY(${edgeTypes})` : sql``}
      `;
    }

    const result = { outbound: outboundNodes, inbound: inboundNodes };
    cache.traversals.set(cacheKey, result);
    return c.json({ data: result });
  });

  app.get("/:id/history", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const limit = Math.min(Number(c.req.query("limit") ?? 20), 500);
    const offset = Number(c.req.query("offset") ?? 0);

    const [node] = await sql<{ id: string }[]>`
      SELECT id FROM nodes WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!node) return c.json({ error: "not found" }, 404);

    const [{ total }] = await sql<{ total: string }[]>`
      SELECT COUNT(*) AS total FROM node_history
      WHERE node_id = ${id} AND tenant_id = ${tenantId}
    `;

    const rows = await sql<NodeHistoryRow[]>`
      SELECT * FROM node_history
      WHERE node_id = ${id} AND tenant_id = ${tenantId}
      ORDER BY changed_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return c.json({ data: rows, total: Number(total) });
  });

  return app;
}
