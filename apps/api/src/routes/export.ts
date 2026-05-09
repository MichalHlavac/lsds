// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import { LayerSchema, LifecycleStatusSchema } from "@lsds/shared";
import type { Sql } from "../db/client.js";
import { getTenantId } from "./util.js";

const ExportQuerySchema = z.object({
  lifecycleStatus: LifecycleStatusSchema.optional(),
  layer: LayerSchema.optional(),
});

export function exportRouter(sql: Sql): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const tenantId = getTenantId(c);
    const query = ExportQuerySchema.safeParse({
      lifecycleStatus: c.req.query("lifecycleStatus"),
      layer: c.req.query("layer"),
    });
    if (!query.success) {
      return c.json({ error: "invalid query params", issues: query.error.issues }, 400);
    }
    const { lifecycleStatus, layer } = query.data;

    c.header("Content-Type", "application/x-ndjson");

    return stream(c, async (s) => {
      // Nodes first — cursor keeps memory flat regardless of graph size
      for await (const rows of sql<{
        id: string;
        layer: string;
        type: string;
        name: string;
        version: string;
        lifecycleStatus: string;
        attributes: Record<string, unknown>;
        createdAt: Date;
      }[]>`
        SELECT id, layer, type, name, version, lifecycle_status, attributes, created_at
        FROM nodes
        WHERE tenant_id = ${tenantId}
          ${lifecycleStatus ? sql`AND lifecycle_status = ${lifecycleStatus}` : sql``}
          ${layer ? sql`AND layer = ${layer}` : sql``}
        ORDER BY created_at ASC
      `.cursor(100)) {
        for (const row of rows) {
          await s.write(
            JSON.stringify({
              type: "node",
              id: row.id,
              layer: row.layer,
              nodeType: row.type,
              name: row.name,
              version: row.version,
              lifecycleStatus: row.lifecycleStatus,
              attributes: row.attributes,
              createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            }) + "\n"
          );
        }
      }

      // Edges after all nodes — guarantees sourceId/targetId appear earlier in stream
      for await (const rows of sql<{
        id: string;
        sourceId: string;
        targetId: string;
        type: string;
        layer: string;
        traversalWeight: number;
        lifecycleStatus: string;
        attributes: Record<string, unknown>;
        createdAt: Date;
      }[]>`
        SELECT id, source_id, target_id, type, layer, traversal_weight, lifecycle_status, attributes, created_at
        FROM edges
        WHERE tenant_id = ${tenantId}
          ${lifecycleStatus ? sql`AND lifecycle_status = ${lifecycleStatus}` : sql``}
          ${layer ? sql`AND layer = ${layer}` : sql``}
        ORDER BY created_at ASC
      `.cursor(100)) {
        for (const row of rows) {
          await s.write(
            JSON.stringify({
              type: "edge",
              id: row.id,
              sourceId: row.sourceId,
              targetId: row.targetId,
              edgeType: row.type,
              layer: row.layer,
              traversalWeight: row.traversalWeight,
              lifecycleStatus: row.lifecycleStatus,
              attributes: row.attributes,
              createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
            }) + "\n"
          );
        }
      }
    });
  });

  return app;
}
