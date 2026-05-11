// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import type { Sql } from "../db/client.js";
import type { ViolationRow } from "../db/types.js";
import { CreateViolationSchema, BatchIdsSchema } from "./schemas.js";
import { getTenantId, jsonb } from "./util.js";

async function lookupEdgeEndpoints(
  sql: Sql,
  tenantId: string,
  edgeId: string,
): Promise<{ sourceId: string; targetId: string } | null> {
  const [row] = await sql<{ sourceId: string; targetId: string }[]>`
    SELECT source_id AS "sourceId", target_id AS "targetId"
    FROM edges WHERE id = ${edgeId} AND tenant_id = ${tenantId}
  `;
  return row ?? null;
}

export function violationsRouter(sql: Sql): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const tenantId = getTenantId(c);
    const nodeId = c.req.query("nodeId");
    const ruleKey = c.req.query("ruleKey");
    const severity = c.req.query("severity");
    const resolved = c.req.query("resolved");
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 500);
    const offset = Number(c.req.query("offset") ?? 0);

    const [{ total }] = await sql<[{ total: number }]>`
      SELECT COUNT(*)::int AS total FROM violations
      WHERE tenant_id = ${tenantId}
        ${nodeId ? sql`AND node_id = ${nodeId}` : sql``}
        ${ruleKey ? sql`AND rule_key = ${ruleKey}` : sql``}
        ${severity ? sql`AND severity = ${severity}` : sql``}
        ${resolved !== undefined ? sql`AND resolved = ${resolved === "true"}` : sql``}
    `;

    const rows = await sql<ViolationRow[]>`
      SELECT * FROM violations
      WHERE tenant_id = ${tenantId}
        ${nodeId ? sql`AND node_id = ${nodeId}` : sql``}
        ${ruleKey ? sql`AND rule_key = ${ruleKey}` : sql``}
        ${severity ? sql`AND severity = ${severity}` : sql``}
        ${resolved !== undefined ? sql`AND resolved = ${resolved === "true"}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return c.json({ data: rows, total });
  });

  app.post("/", async (c) => {
    const tenantId = getTenantId(c);
    const body = CreateViolationSchema.parse(await c.req.json());

    // Edge violations need their endpoints captured so architects can navigate
    // from the violation back to the offending source→target pair.
    let sourceNodeId = body.sourceNodeId ?? null;
    let targetNodeId = body.targetNodeId ?? null;
    if (body.edgeId && (sourceNodeId === null || targetNodeId === null)) {
      const endpoints = await lookupEdgeEndpoints(sql, tenantId, body.edgeId);
      if (endpoints) {
        sourceNodeId ??= endpoints.sourceId;
        targetNodeId ??= endpoints.targetId;
      }
    }

    const [row] = await sql<ViolationRow[]>`
      INSERT INTO violations (
        tenant_id, node_id, edge_id, source_node_id, target_node_id,
        rule_key, severity, message, attributes
      )
      VALUES (
        ${tenantId},
        ${body.nodeId ?? null},
        ${body.edgeId ?? null},
        ${sourceNodeId},
        ${targetNodeId},
        ${body.ruleKey},
        ${body.severity},
        ${body.message},
        ${jsonb(sql, body.attributes)}
      )
      RETURNING *
    `;
    return c.json({ data: row }, 201);
  });

  app.post("/batch-resolve", async (c) => {
    const tenantId = getTenantId(c);
    const body = BatchIdsSchema.parse(await c.req.json());

    const resolved = await sql<ViolationRow[]>`
      UPDATE violations
      SET resolved = TRUE, resolved_at = now(), updated_at = now()
      WHERE id = ANY(${body.ids})
        AND tenant_id = ${tenantId}
        AND resolved = FALSE
      RETURNING *
    `;

    const resolvedIds = new Set(resolved.map((r) => r.id));
    const failed = body.ids
      .filter((id) => !resolvedIds.has(id))
      .map((id) => ({ id, error: "not found or already resolved" }));

    const status = failed.length === 0 ? 200 : resolved.length === 0 ? 404 : 207;
    return c.json({ data: { succeeded: resolved, failed } }, status as 200 | 207 | 404);
  });

  app.get("/:id", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const [row] = await sql<ViolationRow[]>`
      SELECT * FROM violations WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({ data: row });
  });

  app.post("/:id/resolve", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const [row] = await sql<ViolationRow[]>`
      UPDATE violations
      SET resolved = TRUE, resolved_at = now(), updated_at = now()
      WHERE id = ${id} AND tenant_id = ${tenantId} AND resolved = FALSE
      RETURNING *
    `;
    if (!row) return c.json({ error: "not found or already resolved" }, 404);
    return c.json({ data: row });
  });

  app.delete("/:id", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const [row] = await sql<{ id: string }[]>`
      DELETE FROM violations WHERE id = ${id} AND tenant_id = ${tenantId} RETURNING id
    `;
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({ data: { id } });
  });

  return app;
}
