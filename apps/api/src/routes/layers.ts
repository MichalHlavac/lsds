// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { LayerSchema } from "@lsds/shared";
import type { Sql } from "../db/client.js";
import type { NodeRow } from "../db/types.js";
import { getTenantId, parsePaginationLimit } from "./util.js";

export function layersRouter(sql: Sql): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const tenantId = getTenantId(c);
    const rows = await sql<{ layer: string; nodeCount: number }[]>`
      SELECT layer, COUNT(*)::int AS "nodeCount"
      FROM nodes
      WHERE tenant_id = ${tenantId}
      GROUP BY layer
      ORDER BY layer
    `;
    return c.json({ data: rows });
  });

  app.get("/:layer", async (c) => {
    const tenantId = getTenantId(c);
    const parsed = LayerSchema.safeParse(c.req.param("layer"));
    if (!parsed.success) return c.json({ error: "invalid layer" }, 400);
    const layer = parsed.data;

    const type = c.req.query("type");
    const lifecycleStatus = c.req.query("lifecycleStatus");
    const limit = parsePaginationLimit(c.req.query("limit"), 50, 500);
    const offset = Number(c.req.query("offset") ?? 0);

    const rows = await sql<NodeRow[]>`
      SELECT * FROM nodes
      WHERE tenant_id = ${tenantId}
        AND layer = ${layer}
        ${type ? sql`AND type = ${type}` : sql``}
        ${lifecycleStatus ? sql`AND lifecycle_status = ${lifecycleStatus}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return c.json({ data: rows });
  });

  return app;
}
