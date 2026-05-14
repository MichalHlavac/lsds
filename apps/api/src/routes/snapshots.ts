// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import type { Sql } from "../db/client.js";
import type { SnapshotRow } from "../db/types.js";
import { CreateSnapshotSchema } from "./schemas.js";
import { getTenantId, jsonb, parsePaginationLimit } from "./util.js";

export function snapshotsRouter(sql: Sql): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const tenantId = getTenantId(c);
    const limit = parsePaginationLimit(c.req.query("limit"), 50, 500);
    const offset = Number(c.req.query("offset") ?? 0);

    const rows = await sql<SnapshotRow[]>`
      SELECT * FROM snapshots
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return c.json({ data: rows });
  });

  app.post("/", async (c) => {
    const tenantId = getTenantId(c);
    const body = CreateSnapshotSchema.parse(await c.req.json());
    const [row] = await sql<SnapshotRow[]>`
      INSERT INTO snapshots (tenant_id, label, node_count, edge_count, snapshot_data)
      VALUES (
        ${tenantId}, ${body.label}, ${body.nodeCount}, ${body.edgeCount},
        ${jsonb(sql, body.snapshotData)}
      )
      RETURNING *
    `;
    return c.json({ data: row }, 201);
  });

  app.get("/:id", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const [row] = await sql<SnapshotRow[]>`
      SELECT * FROM snapshots WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({ data: row });
  });

  return app;
}
