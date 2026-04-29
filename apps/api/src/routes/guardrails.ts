// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import type { Sql } from "../db/client.js";
import type { GuardrailRow } from "../db/types.js";
import { CreateGuardrailSchema, UpdateGuardrailSchema } from "./schemas.js";
import { getTenantId, jsonb } from "./util.js";

export function guardrailsRouter(sql: Sql): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const tenantId = getTenantId(c);
    const enabled = c.req.query("enabled");
    const rows = await sql<GuardrailRow[]>`
      SELECT * FROM guardrails
      WHERE tenant_id = ${tenantId}
        ${enabled !== undefined ? sql`AND enabled = ${enabled === "true"}` : sql``}
      ORDER BY rule_key
    `;
    return c.json({ data: rows });
  });

  app.post("/", async (c) => {
    const tenantId = getTenantId(c);
    const body = CreateGuardrailSchema.parse(await c.req.json());
    const [row] = await sql<GuardrailRow[]>`
      INSERT INTO guardrails (tenant_id, rule_key, description, severity, enabled, config)
      VALUES (
        ${tenantId}, ${body.ruleKey}, ${body.description},
        ${body.severity}, ${body.enabled}, ${jsonb(sql, body.config)}
      )
      ON CONFLICT (tenant_id, rule_key) DO UPDATE SET
        description = EXCLUDED.description,
        severity = EXCLUDED.severity,
        enabled = EXCLUDED.enabled,
        config = EXCLUDED.config,
        updated_at = now()
      RETURNING *
    `;
    return c.json({ data: row }, 201);
  });

  app.get("/:id", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const [row] = await sql<GuardrailRow[]>`
      SELECT * FROM guardrails WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({ data: row });
  });

  app.patch("/:id", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const body = UpdateGuardrailSchema.parse(await c.req.json());
    const [row] = await sql<GuardrailRow[]>`
      UPDATE guardrails SET
        ${body.description !== undefined ? sql`description = ${body.description},` : sql``}
        ${body.severity !== undefined ? sql`severity = ${body.severity},` : sql``}
        ${body.enabled !== undefined ? sql`enabled = ${body.enabled},` : sql``}
        ${body.config !== undefined ? sql`config = ${jsonb(sql, body.config)},` : sql``}
        updated_at = now()
      WHERE id = ${id} AND tenant_id = ${tenantId}
      RETURNING *
    `;
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({ data: row });
  });

  app.delete("/:id", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const [row] = await sql<{ id: string }[]>`
      DELETE FROM guardrails WHERE id = ${id} AND tenant_id = ${tenantId} RETURNING id
    `;
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({ data: { id } });
  });

  return app;
}
