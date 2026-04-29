import { Hono } from "hono";
import type { Sql } from "../db/client.js";
import type { ViolationRow } from "../db/types.js";
import { CreateViolationSchema } from "./schemas.js";
import { getTenantId, jsonb } from "./util.js";

export function violationsRouter(sql: Sql): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const tenantId = getTenantId(c);
    const nodeId = c.req.query("nodeId");
    const ruleKey = c.req.query("ruleKey");
    const resolved = c.req.query("resolved");
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 500);
    const offset = Number(c.req.query("offset") ?? 0);

    const rows = await sql<ViolationRow[]>`
      SELECT * FROM violations
      WHERE tenant_id = ${tenantId}
        ${nodeId ? sql`AND node_id = ${nodeId}` : sql``}
        ${ruleKey ? sql`AND rule_key = ${ruleKey}` : sql``}
        ${resolved !== undefined ? sql`AND resolved = ${resolved === "true"}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return c.json({ data: rows });
  });

  app.post("/", async (c) => {
    const tenantId = getTenantId(c);
    const body = CreateViolationSchema.parse(await c.req.json());
    const [row] = await sql<ViolationRow[]>`
      INSERT INTO violations (tenant_id, node_id, edge_id, rule_key, severity, message, attributes)
      VALUES (
        ${tenantId},
        ${body.nodeId ?? null},
        ${body.edgeId ?? null},
        ${body.ruleKey},
        ${body.severity},
        ${body.message},
        ${jsonb(sql, body.attributes)}
      )
      RETURNING *
    `;
    return c.json({ data: row }, 201);
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
