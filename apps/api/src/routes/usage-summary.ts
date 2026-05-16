// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import type { Sql } from "../db/client.js";
import { GetUsageSummaryQuerySchema } from "./schemas.js";
import { getTenantId } from "./util.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function usageSummaryRouter(sql: Sql): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const tenantId = getTenantId(c);
    const raw = { since: c.req.query("since") };
    const parsed = GetUsageSummaryQuerySchema.parse(
      Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined))
    );

    const to = new Date();
    const from = parsed.since ? new Date(parsed.since) : new Date(to.getTime() - THIRTY_DAYS_MS);

    const rows = await sql<{ eventType: string; count: number }[]>`
      SELECT event_type AS "eventType", COUNT(*)::int AS count
      FROM usage_events
      WHERE tenant_id = ${tenantId}
        AND created_at >= ${from}
        AND created_at <= ${to}
      GROUP BY event_type
      ORDER BY event_type
    `;

    const byEventType = rows
      .map((r) => ({ eventType: r.eventType, count: r.count }))
      .sort((a, b) => a.eventType.localeCompare(b.eventType));
    const total = byEventType.reduce((sum, r) => sum + r.count, 0);

    return c.json({
      data: {
        period: { from: from.toISOString(), to: to.toISOString() },
        byEventType,
        total,
      },
    });
  });

  return app;
}
