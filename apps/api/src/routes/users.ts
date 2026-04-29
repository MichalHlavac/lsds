// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import type { Sql } from "../db/client.js";
import type { UserRow, TeamRow } from "../db/types.js";
import { CreateUserSchema, CreateTeamSchema } from "./schemas.js";
import { getTenantId, jsonb } from "./util.js";

export function usersRouter(sql: Sql): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const tenantId = getTenantId(c);
    const rows = await sql<UserRow[]>`
      SELECT * FROM users WHERE tenant_id = ${tenantId} ORDER BY display_name
    `;
    return c.json({ data: rows });
  });

  app.post("/", async (c) => {
    const tenantId = getTenantId(c);
    const body = CreateUserSchema.parse(await c.req.json());
    const [row] = await sql<UserRow[]>`
      INSERT INTO users (tenant_id, external_id, display_name, email, role, attributes)
      VALUES (
        ${tenantId}, ${body.externalId}, ${body.displayName},
        ${body.email ?? null}, ${body.role}, ${jsonb(sql, body.attributes)}
      )
      ON CONFLICT (tenant_id, external_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        email = EXCLUDED.email,
        role = EXCLUDED.role,
        attributes = EXCLUDED.attributes,
        updated_at = now()
      RETURNING *
    `;
    return c.json({ data: row }, 201);
  });

  app.get("/:id", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const [row] = await sql<UserRow[]>`
      SELECT * FROM users WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({ data: row });
  });

  app.delete("/:id", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const [row] = await sql<{ id: string }[]>`
      DELETE FROM users WHERE id = ${id} AND tenant_id = ${tenantId} RETURNING id
    `;
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({ data: { id } });
  });

  return app;
}

export function teamsRouter(sql: Sql): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const tenantId = getTenantId(c);
    const rows = await sql<TeamRow[]>`
      SELECT * FROM teams WHERE tenant_id = ${tenantId} ORDER BY name
    `;
    return c.json({ data: rows });
  });

  app.post("/", async (c) => {
    const tenantId = getTenantId(c);
    const body = CreateTeamSchema.parse(await c.req.json());
    const [row] = await sql<TeamRow[]>`
      INSERT INTO teams (tenant_id, name, attributes)
      VALUES (${tenantId}, ${body.name}, ${jsonb(sql, body.attributes)})
      ON CONFLICT (tenant_id, name) DO UPDATE SET
        attributes = EXCLUDED.attributes,
        updated_at = now()
      RETURNING *
    `;
    return c.json({ data: row }, 201);
  });

  app.get("/:id", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const [row] = await sql<TeamRow[]>`
      SELECT * FROM teams WHERE id = ${id} AND tenant_id = ${tenantId}
    `;
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({ data: row });
  });

  app.post("/:id/members", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const { userId } = await c.req.json() as { userId: string };
    // verify both belong to tenant
    const [team] = await sql`SELECT id FROM teams WHERE id = ${id} AND tenant_id = ${tenantId}`;
    if (!team) return c.json({ error: "team not found" }, 404);
    const [user] = await sql`SELECT id FROM users WHERE id = ${userId} AND tenant_id = ${tenantId}`;
    if (!user) return c.json({ error: "user not found" }, 404);
    await sql`
      INSERT INTO team_members (team_id, user_id) VALUES (${id}, ${userId})
      ON CONFLICT DO NOTHING
    `;
    return c.json({ data: { teamId: id, userId } });
  });

  app.delete("/:id/members/:userId", async (c) => {
    const tenantId = getTenantId(c);
    const { id, userId } = c.req.param();
    const [team] = await sql`SELECT id FROM teams WHERE id = ${id} AND tenant_id = ${tenantId}`;
    if (!team) return c.json({ error: "team not found" }, 404);
    await sql`DELETE FROM team_members WHERE team_id = ${id} AND user_id = ${userId}`;
    return c.json({ data: { teamId: id, userId } });
  });

  app.delete("/:id", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();
    const [row] = await sql<{ id: string }[]>`
      DELETE FROM teams WHERE id = ${id} AND tenant_id = ${tenantId} RETURNING id
    `;
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({ data: { id } });
  });

  return app;
}
