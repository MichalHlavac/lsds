// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import type { Sql } from "../db/client.js";
import type { LsdsCache } from "../cache/index.js";
import type { TraversalEngine } from "../db/traversal-adapter.js";
import type { NodeRow } from "../db/types.js";
import { TraverseSchema } from "./schemas.js";
import { getTenantId, jsonb } from "./util.js";

export function traversalRouter(
  sql: Sql,
  cache: LsdsCache,
  adapter: TraversalEngine
): Hono {
  const app = new Hono();

  app.post("/:id/traverse", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const body = TraverseSchema.parse(await c.req.json());

    const cacheKey = cache.traversalKey(tenantId, id, body.depth, body.direction, body.edgeTypes);
    const hit = cache.traversals.get(cacheKey);
    if (hit) return c.json({ data: hit, cached: true });

    const results = await adapter.traverseWithDepth(id, body.depth, body.direction, body.edgeTypes);
    const nodeIds = results.map((r) => r.nodeId).filter((nid) => nid !== id);

    let nodes: NodeRow[] = [];
    if (nodeIds.length > 0) {
      nodes = await sql<NodeRow[]>`
        SELECT * FROM nodes
        WHERE id = ANY(${nodeIds}) AND tenant_id = ${tenantId}
      `;
    }

    const response = {
      root: id,
      depth: body.depth,
      direction: body.direction,
      nodes,
      traversal: results,
    };
    cache.traversals.set(cacheKey, response);
    return c.json({ data: response, cached: false });
  });

  return app;
}

export function queryRouter(sql: Sql): Hono {
  const app = new Hono();

  app.post("/nodes", async (c) => {
    const tenantId = getTenantId(c);
    const body = await c.req.json() as {
      attributes?: Record<string, unknown>;
      type?: string;
      layer?: string;
      lifecycleStatus?: string;
      text?: string;
      limit?: number;
      offset?: number;
    };

    const limit = Math.min(body.limit ?? 50, 500);
    const offset = body.offset ?? 0;

    const rows = await sql<NodeRow[]>`
      SELECT * FROM nodes
      WHERE tenant_id = ${tenantId}
        ${body.type ? sql`AND type = ${body.type}` : sql``}
        ${body.layer ? sql`AND layer = ${body.layer}` : sql``}
        ${body.lifecycleStatus ? sql`AND lifecycle_status = ${body.lifecycleStatus}` : sql``}
        ${body.attributes ? sql`AND attributes @> ${jsonb(sql, body.attributes)}` : sql``}
        ${body.text ? sql`AND (name ILIKE ${"%" + body.text + "%"} OR type ILIKE ${"%" + body.text + "%"})` : sql``}
      ORDER BY updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return c.json({ data: rows });
  });

  return app;
}
