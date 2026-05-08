// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import type { TenantRow } from "../db/types.js";
import { getTenantId } from "./util.js";
import { tenantApiKeysRouter } from "./tenant-api-keys.js";

const PatchTenantSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  retentionDays: z.number().int().min(1).max(36500).optional(),
}).strict();

interface TenantStats {
  nodeCount: number;
  edgeCount: number;
  openViolationCount: number;
}

export function tenantRouter(sql: Sql): Hono {
  const app = new Hono();

  app.route("/api-keys", tenantApiKeysRouter(sql));

  app.get("/", async (c) => {
    const tenantId = getTenantId(c);

    // Auto-provision tenant row on first access so GET is always idempotent
    const [tenant] = await sql<TenantRow[]>`
      INSERT INTO tenants (id, name, plan, retention_days)
      VALUES (${tenantId}, 'Default Tenant', 'standard', 730)
      ON CONFLICT (id) DO UPDATE SET updated_at = tenants.updated_at
      RETURNING id, name, plan, retention_days, created_at, updated_at
    `;
    if (!tenant) return c.json({ error: "tenant not found" }, 404);

    const [stats] = await sql<[TenantStats]>`
      SELECT
        (SELECT count(*)::int FROM nodes    WHERE tenant_id = ${tenantId} AND lifecycle_status = 'ACTIVE') AS "nodeCount",
        (SELECT count(*)::int FROM edges    WHERE tenant_id = ${tenantId} AND lifecycle_status = 'ACTIVE') AS "edgeCount",
        (SELECT count(*)::int FROM violations WHERE tenant_id = ${tenantId} AND resolved = false)           AS "openViolationCount"
    `;

    return c.json({ data: { ...tenant, stats } });
  });

  app.patch("/", async (c) => {
    const tenantId = getTenantId(c);
    const body = PatchTenantSchema.parse(await c.req.json());

    if (Object.keys(body).length === 0) {
      return c.json({ error: "no fields to update" }, 400);
    }

    const updates: { name?: string; retention_days?: number } = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.retentionDays !== undefined) updates.retention_days = body.retentionDays;

    const [tenant] = await sql<TenantRow[]>`
      UPDATE tenants
      SET
        ${body.name !== undefined ? sql`name = ${body.name},` : sql``}
        ${body.retentionDays !== undefined ? sql`retention_days = ${body.retentionDays},` : sql``}
        updated_at = now()
      WHERE id = ${tenantId}
      RETURNING id, name, plan, retention_days, created_at, updated_at
    `;
    if (!tenant) return c.json({ error: "tenant not found" }, 404);

    return c.json({ data: tenant });
  });

  return app;
}
