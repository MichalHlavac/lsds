import { Hono } from "hono";
import { validateRelationshipEdge } from "@lsds/framework";
import type { Sql } from "../db/client.js";
import type { LsdsCache } from "../cache/index.js";
import type { EdgeRow, NodeRow } from "../db/types.js";
import { CreateEdgeSchema, UpdateEdgeSchema } from "./schemas.js";
import { getTenantId, jsonb } from "./util.js";

export function edgesRouter(sql: Sql, cache: LsdsCache): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const tenantId = getTenantId(c);
    const sourceId = c.req.query("sourceId");
    const targetId = c.req.query("targetId");
    const type = c.req.query("type");
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 500);
    const offset = Number(c.req.query("offset") ?? 0);

    const rows = await sql<EdgeRow[]>`
      SELECT * FROM edges
      WHERE tenant_id = ${tenantId}
        ${sourceId ? sql`AND source_id = ${sourceId}` : sql``}
        ${targetId ? sql`AND target_id = ${targetId}` : sql``}
        ${type ? sql`AND type = ${type}` : sql``}
      ORDER BY created_at DESC
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
      return c.json({ error: "invalid edge", issues: validationIssues }, 422);
    }

    const [row] = await sql<EdgeRow[]>`
      INSERT INTO edges (tenant_id, source_id, target_id, type, layer, traversal_weight, attributes)
      VALUES (
        ${tenantId}, ${body.sourceId}, ${body.targetId}, ${body.type},
        ${body.layer}, ${body.traversalWeight}, ${jsonb(sql, body.attributes)}
      )
      RETURNING *
    `;
    cache.invalidateEdge(tenantId, row.id, row.sourceId, row.targetId);
    return c.json({ data: row }, 201);
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
    return c.json({ data: row });
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

  return app;
}
