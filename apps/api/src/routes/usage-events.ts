// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import type { Sql } from "../db/client.js";
import type { UsageEventRow } from "../db/types.js";
import { CreateUsageEventSchema, GetUsageEventsQuerySchema } from "./schemas.js";
import { getTenantId, jsonb } from "./util.js";

function rowToEvent(row: UsageEventRow) {
  return {
    id: row.id,
    eventType: row.eventType,
    entityId: row.entityId,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  };
}

export function usageEventsRouter(sql: Sql): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const tenantId = getTenantId(c);
    const body = CreateUsageEventSchema.parse(await c.req.json());

    const [row] = await sql<UsageEventRow[]>`
      INSERT INTO usage_events (tenant_id, event_type, entity_id, metadata)
      VALUES (
        ${tenantId},
        ${body.eventType},
        ${body.entityId ?? null},
        ${body.metadata != null ? jsonb(sql, body.metadata) : null}
      )
      RETURNING *
    `;

    return c.json({ data: rowToEvent(row) }, 201);
  });

  app.get("/", async (c) => {
    const tenantId = getTenantId(c);
    const raw = {
      eventType: c.req.query("eventType"),
      after: c.req.query("after"),
      limit: c.req.query("limit"),
    };
    const parsed = GetUsageEventsQuerySchema.parse(
      Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined))
    );

    const afterDate = parsed.after ? new Date(parsed.after) : null;

    const rows = await sql<(UsageEventRow & { totalCount: number })[]>`
      SELECT *, COUNT(*) OVER()::int AS total_count
      FROM usage_events
      WHERE tenant_id = ${tenantId}
        ${parsed.eventType ? sql`AND event_type = ${parsed.eventType}` : sql``}
        ${afterDate ? sql`AND created_at > ${afterDate}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${parsed.limit}
    `;

    return c.json({ events: rows.map(rowToEvent), total: rows[0]?.totalCount ?? 0 });
  });

  return app;
}
