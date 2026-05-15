// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { parsePaginationLimit, encodeCursor, decodeCursor } from "./util.js";

const PARTNER_STATUSES = ["active", "churned", "paused"] as const;
type PartnerStatus = (typeof PARTNER_STATUSES)[number];

const GetPartnersQuerySchema = z.object({
  status: z.enum(PARTNER_STATUSES).optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

interface PartnerRow {
  id: string;
  name: string;
  partnerStatus: PartnerStatus | null;
  createdAt: Date;
  lastActiveAt: Date | null;
  nodeCount: number;
}

export function adminPartnersRouter(sql: Sql): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const query = GetPartnersQuerySchema.parse({
      status: c.req.query("status"),
      limit: c.req.query("limit"),
      cursor: c.req.query("cursor"),
    });

    const limit = parsePaginationLimit(query.limit, 20, 100);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const rows = await sql<PartnerRow[]>`
      SELECT
        t.id,
        t.name,
        t.partner_status,
        t.created_at,
        (
          SELECT MAX(ue.created_at) FROM usage_events ue WHERE ue.tenant_id = t.id
        ) AS last_active_at,
        (
          SELECT COUNT(*)::int FROM nodes n WHERE n.tenant_id = t.id
        ) AS node_count
      FROM tenants t
      WHERE t.plan = 'partner'
        ${query.status ? sql`AND t.partner_status = ${query.status}` : sql``}
        ${cursor
          ? sql`AND (t.created_at < ${cursor.v}::timestamptz OR (t.created_at = ${cursor.v}::timestamptz AND t.id < ${cursor.id}::uuid))`
          : sql``}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT ${limit + 1}
    `;

    const [{ total }] = await sql<[{ total: number }]>`
      SELECT COUNT(*)::int AS total FROM tenants
      WHERE plan = 'partner'
        ${query.status ? sql`AND partner_status = ${query.status}` : sql``}
    `;

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(last.createdAt.toISOString(), last.id)
        : null;

    return c.json({
      partners: items.map((r) => ({
        tenantId: r.id,
        name: r.name,
        status: r.partnerStatus,
        createdAt: r.createdAt,
        lastActiveAt: r.lastActiveAt,
        nodeCount: r.nodeCount,
      })),
      nextCursor,
      total,
    });
  });

  return app;
}
