// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import type { AdminAuditLogRow } from "../db/types.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const QuerySchema = z.object({
  tenantId: z.string().regex(UUID_RE, "tenantId must be a valid UUID").optional(),
  operation: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().datetime({ offset: true }).optional(),
});

export function adminAuditLogRouter(sql: Sql): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const raw = {
      tenantId: c.req.query("tenantId"),
      operation: c.req.query("operation"),
      limit: c.req.query("limit"),
      before: c.req.query("before"),
    };

    const parsed = QuerySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "validation error", issues: parsed.error.issues }, 400);
    }

    const { tenantId, operation, limit, before } = parsed.data;

    const beforeDate = before ? new Date(before) : undefined;

    const rows = await sql<AdminAuditLogRow[]>`
      SELECT id, operation, target_tenant_id, payload, created_at
      FROM admin_audit_log
      WHERE TRUE
        ${tenantId ? sql`AND target_tenant_id = ${tenantId}` : sql``}
        ${operation ? sql`AND operation = ${operation}` : sql``}
        ${beforeDate ? sql`AND created_at < ${beforeDate}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    const hasMore = rows.length === limit;
    const last = rows[rows.length - 1];
    const nextBefore = hasMore && last ? last.createdAt.toISOString() : null;

    return c.json({
      data: rows.map((r) => ({
        id: r.id,
        operation: r.operation,
        targetTenantId: r.targetTenantId,
        payload: r.payload,
        createdAt: r.createdAt.toISOString(),
      })),
      meta: {
        count: rows.length,
        hasMore,
        nextBefore,
      },
    });
  });

  return app;
}
