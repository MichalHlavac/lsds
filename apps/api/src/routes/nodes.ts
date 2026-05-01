// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import type { Sql } from "../db/client.js";
import type { LsdsCache } from "../cache/index.js";
import type { NodeRow } from "../db/types.js";
import { LifecycleTransitionError, type LifecycleService } from "../lifecycle/index.js";
import {
  CreateNodeSchema,
  UpdateNodeSchema,
  LifecycleTransitionSchema,
  NODE_SORT_FIELDS,
  SORT_ORDER_VALUES,
  type NodeSortField,
} from "./schemas.js";
import { getTenantId, jsonb } from "./util.js";

export function nodesRouter(sql: Sql, cache: LsdsCache, lifecycle: LifecycleService): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const tenantId = getTenantId(c);
    const type = c.req.query("type");
    const layer = c.req.query("layer");
    const lifecycleStatus = c.req.query("lifecycleStatus");
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

    const rows = await sql<NodeRow[]>`
      SELECT * FROM nodes
      WHERE tenant_id = ${tenantId}
        ${type ? sql`AND type = ${type}` : sql``}
        ${layer ? sql`AND layer = ${layer}` : sql``}
        ${lifecycleStatus ? sql`AND lifecycle_status = ${lifecycleStatus}` : sql``}
      ORDER BY ${sortCol} ${sortDir}
      LIMIT ${limit} OFFSET ${offset}
    `;
    return c.json({ data: rows });
  });

  app.post("/", async (c) => {
    const tenantId = getTenantId(c);
    const body = CreateNodeSchema.parse(await c.req.json());
    const [row] = await sql<NodeRow[]>`
      INSERT INTO nodes (tenant_id, type, layer, name, version, lifecycle_status, attributes)
      VALUES (
        ${tenantId}, ${body.type}, ${body.layer}, ${body.name},
        ${body.version}, ${body.lifecycleStatus}, ${jsonb(sql, body.attributes)}
      )
      RETURNING *
    `;
    return c.json({ data: row }, 201);
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
    cache.invalidateNode(tenantId, id);
    return c.json({ data: row });
  });

  app.patch("/:id/lifecycle", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const body = LifecycleTransitionSchema.parse(await c.req.json());
    try {
      const row = await lifecycle.transitionNode(tenantId, id, body.transition);
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
    const [row] = await sql<{ id: string }[]>`
      DELETE FROM nodes WHERE id = ${id} AND tenant_id = ${tenantId} RETURNING id
    `;
    if (!row) return c.json({ error: "not found" }, 404);
    cache.invalidateNode(tenantId, id);
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

  return app;
}
