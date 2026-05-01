// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { validateRelationshipEdge } from "@lsds/framework";
import type { Sql } from "../db/client.js";
import type { LsdsCache } from "../cache/index.js";
import type { EdgeHistoryRow, EdgeRow, NodeRow } from "../db/types.js";
import { LifecycleTransitionError, type LifecycleService } from "../lifecycle/index.js";
import { recordEdgeHistory } from "../db/history.js";
import {
  CreateEdgeSchema,
  UpdateEdgeSchema,
  LifecycleTransitionSchema,
  EDGE_SORT_FIELDS,
  SORT_ORDER_VALUES,
  type EdgeSortField,
} from "./schemas.js";
import { getTenantId, jsonb } from "./util.js";

export function edgesRouter(sql: Sql, cache: LsdsCache, lifecycle: LifecycleService): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const tenantId = getTenantId(c);
    const q = c.req.query("q");
    const sourceId = c.req.query("sourceId");
    const targetId = c.req.query("targetId");
    const type = c.req.query("type");
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 500);
    const offset = Number(c.req.query("offset") ?? 0);
    const sortByRaw = c.req.query("sortBy");
    const orderRaw = c.req.query("order");

    if (sortByRaw && !(EDGE_SORT_FIELDS as readonly string[]).includes(sortByRaw)) {
      return c.json({ error: `invalid sortBy: must be one of ${EDGE_SORT_FIELDS.join(", ")}` }, 400);
    }
    if (orderRaw && !(SORT_ORDER_VALUES as readonly string[]).includes(orderRaw)) {
      return c.json({ error: "invalid order: must be 'asc' or 'desc'" }, 400);
    }

    const sortColMap: Record<EdgeSortField, ReturnType<typeof sql>> = {
      createdAt: sql`created_at`,
      updatedAt: sql`updated_at`,
      type: sql`type`,
      layer: sql`layer`,
      traversalWeight: sql`traversal_weight`,
    };

    const sortCol = sortByRaw ? sortColMap[sortByRaw as EdgeSortField] : sql`created_at`;
    const sortDir = (orderRaw ?? (sortByRaw ? "asc" : "desc")) === "desc" ? sql`DESC` : sql`ASC`;

    const rows = await sql<EdgeRow[]>`
      SELECT * FROM edges
      WHERE tenant_id = ${tenantId}
        ${q ? sql`AND type ILIKE ${"%" + q + "%"}` : sql``}
        ${sourceId ? sql`AND source_id = ${sourceId}` : sql``}
        ${targetId ? sql`AND target_id = ${targetId}` : sql``}
        ${type ? sql`AND type = ${type}` : sql``}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT ${limit} OFFSET ${offset}
    `;
    return c.json({ data: rows });
  });

  app.post("/", async (c) => {
    const tenantId = getTenantId(c);
    const body = CreateEdgeSchema.parse(await c.req.json());

    const [sourceNode] = await sql<NodeRow[]>`
      SELECT id, layer FROM nodes WHERE id = ${body.sourceId} AND tenant_id = ${tenantId}
    `;
    if (!sourceNode) return c.json({ error: "source node not found" }, 404);

    const [targetNode] = await sql<NodeRow[]>`
      SELECT id, layer FROM nodes WHERE id = ${body.targetId} AND tenant_id = ${tenantId}
    `;
    if (!targetNode) return c.json({ error: "target node not found" }, 404);

    const validationIssues = validateRelationshipEdge({
      type: body.type,
      sourceLayer: sourceNode.layer,
      targetLayer: targetNode.layer,
    });
    if (validationIssues.length > 0) {
      return c.json({
        error: "invalid edge",
        violations: validationIssues.map((i) => ({
          ruleKey: "GR-XL-003",
          severity: "ERROR",
          message: i.message,
        })),
      }, 422);
    }

    try {
      const [row] = await sql<EdgeRow[]>`
        INSERT INTO edges (tenant_id, source_id, target_id, type, layer, traversal_weight, attributes)
        VALUES (
          ${tenantId}, ${body.sourceId}, ${body.targetId}, ${body.type},
          ${body.layer}, ${body.traversalWeight}, ${jsonb(sql, body.attributes)}
        )
        RETURNING *
      `;
      cache.invalidateEdge(tenantId, row.id, row.sourceId, row.targetId);
      await recordEdgeHistory(sql, tenantId, row.id, "CREATE", null, row);
      return c.json({ data: row }, 201);
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "23505") {
        return c.json({ error: "edge already exists with this source, target, and type; use PUT to upsert" }, 409);
      }
      throw err;
    }
  });

  app.put("/", async (c) => {
    const tenantId = getTenantId(c);
    const body = CreateEdgeSchema.parse(await c.req.json());

    const [sourceNode] = await sql<NodeRow[]>`
      SELECT id, layer FROM nodes WHERE id = ${body.sourceId} AND tenant_id = ${tenantId}
    `;
    if (!sourceNode) return c.json({ error: "source node not found" }, 404);

    const [targetNode] = await sql<NodeRow[]>`
      SELECT id, layer FROM nodes WHERE id = ${body.targetId} AND tenant_id = ${tenantId}
    `;
    if (!targetNode) return c.json({ error: "target node not found" }, 404);

    const validationIssues = validateRelationshipEdge({
      type: body.type,
      sourceLayer: sourceNode.layer,
      targetLayer: targetNode.layer,
    });
    if (validationIssues.length > 0) {
      return c.json({
        error: "invalid edge",
        violations: validationIssues.map((i) => ({
          ruleKey: "GR-XL-003",
          severity: "ERROR",
          message: i.message,
        })),
      }, 422);
    }

    const [previous] = await sql<EdgeRow[]>`
      SELECT * FROM edges
      WHERE tenant_id = ${tenantId} AND source_id = ${body.sourceId} AND target_id = ${body.targetId} AND type = ${body.type}
    `;

    const [row] = await sql<EdgeRow[]>`
      INSERT INTO edges (tenant_id, source_id, target_id, type, layer, traversal_weight, attributes)
      VALUES (
        ${tenantId}, ${body.sourceId}, ${body.targetId}, ${body.type},
        ${body.layer}, ${body.traversalWeight}, ${jsonb(sql, body.attributes)}
      )
      ON CONFLICT (tenant_id, source_id, target_id, type)
      DO UPDATE SET
        layer = EXCLUDED.layer,
        traversal_weight = EXCLUDED.traversal_weight,
        attributes = EXCLUDED.attributes,
        updated_at = now()
      RETURNING *
    `;
    cache.invalidateEdge(tenantId, row.id, row.sourceId, row.targetId);
    const op = previous ? "UPDATE" : "CREATE";
    await recordEdgeHistory(sql, tenantId, row.id, op, previous ?? null, row);
    return c.json({ data: row }, previous ? 200 : 201);
  });

  app.get("/:id", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const cached = cache.edges.get(cache.edgeKey(tenantId, id));
    if (cached) return c.json({ data: cached });

    const [row] = await sql<EdgeRow[]>`
      SELECT * FROM edges WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!row) return c.json({ error: "not found" }, 404);
    cache.edges.set(cache.edgeKey(tenantId, id), row);
    return c.json({ data: row });
  });

  app.patch("/:id", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const body = UpdateEdgeSchema.parse(await c.req.json());

    const [previous] = await sql<EdgeRow[]>`
      SELECT * FROM edges WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!previous) return c.json({ error: "not found" }, 404);

    const [row] = await sql<EdgeRow[]>`
      UPDATE edges SET
        ${body.type !== undefined ? sql`type = ${body.type},` : sql``}
        ${body.traversalWeight !== undefined ? sql`traversal_weight = ${body.traversalWeight},` : sql``}
        ${body.attributes !== undefined ? sql`attributes = ${jsonb(sql, body.attributes)},` : sql``}
        updated_at = now()
      WHERE id = ${id} AND tenant_id = ${tenantId}
      RETURNING *
    `;
    if (!row) return c.json({ error: "not found" }, 404);
    cache.invalidateEdge(tenantId, id, row.sourceId, row.targetId);
    await recordEdgeHistory(sql, tenantId, id, "UPDATE", previous, row);
    return c.json({ data: row });
  });

  app.patch("/:id/lifecycle", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const body = LifecycleTransitionSchema.parse(await c.req.json());

    const [previous] = await sql<EdgeRow[]>`
      SELECT * FROM edges WHERE id = ${id} AND tenant_id = ${tenantId}
    `;

    try {
      const row = await lifecycle.transitionEdge(tenantId, id, body.transition);
      if (previous) {
        await recordEdgeHistory(sql, tenantId, id, "LIFECYCLE_TRANSITION", previous, row);
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
      if (e instanceof Error && e.message === "edge not found") {
        return c.json({ error: "not found" }, 404);
      }
      return c.json({ error: String(e) }, 400);
    }
  });

  app.delete("/:id", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const [row] = await sql<EdgeRow[]>`
      DELETE FROM edges WHERE id = ${id} AND tenant_id = ${tenantId} RETURNING *
    `;
    if (!row) return c.json({ error: "not found" }, 404);
    cache.invalidateEdge(tenantId, id, row.sourceId, row.targetId);
    return c.json({ data: { id } });
  });

  app.get("/:id/history", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const limit = Math.min(Number(c.req.query("limit") ?? 20), 500);
    const offset = Number(c.req.query("offset") ?? 0);

    const [edge] = await sql<{ id: string }[]>`
      SELECT id FROM edges WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!edge) return c.json({ error: "not found" }, 404);

    const [{ total }] = await sql<{ total: string }[]>`
      SELECT COUNT(*) AS total FROM edge_history
      WHERE edge_id = ${id} AND tenant_id = ${tenantId}
    `;

    const rows = await sql<EdgeHistoryRow[]>`
      SELECT * FROM edge_history
      WHERE edge_id = ${id} AND tenant_id = ${tenantId}
      ORDER BY changed_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return c.json({ data: rows, total: Number(total) });
  });

  return app;
}
