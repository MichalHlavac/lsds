// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { parsePaginationLimit, encodeCursor, decodeCursor } from "./util.js";
import { generateApiKey, sha256hex } from "../auth/api-key.js";
import { logAdminOperation } from "../db/admin-audit.js";
import { logger } from "../logger.js";

const PARTNER_STATUSES = ["active", "churned", "paused"] as const;
type PartnerStatus = (typeof PARTNER_STATUSES)[number];

const GetPartnersQuerySchema = z.object({
  status: z.enum(PARTNER_STATUSES).optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

const CreatePartnerSchema = z.object({
  name: z.string().min(1).max(200),
  contactEmail: z.string().email(),
  tier: z.literal("design_partner"),
});

interface PartnerRow {
  id: string;
  name: string;
  partnerStatus: PartnerStatus | null;
  createdAt: Date;
  lastActiveAt: Date | null;
  nodeCount: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const USAGE_EVENT_TYPES = [
  "NODE_CREATED",
  "EDGE_CREATED",
  "REQUIREMENT_ADDED",
  "VIOLATION_CHECKED",
  "GRAPH_TRAVERSED",
  "MCP_QUERY",
] as const;

type UsageEventType = (typeof USAGE_EVENT_TYPES)[number];

const EVENT_KEY: Record<UsageEventType, string> = {
  NODE_CREATED: "nodeCreated",
  EDGE_CREATED: "edgeCreated",
  REQUIREMENT_ADDED: "requirementAdded",
  VIOLATION_CHECKED: "violationChecked",
  GRAPH_TRAVERSED: "graphTraversed",
  MCP_QUERY: "mcpQuery",
};

function zeroTotals(): Record<string, number> {
  const t: Record<string, number> = { events: 0 };
  for (const et of USAGE_EVENT_TYPES) t[EVENT_KEY[et]] = 0;
  return t;
}

function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
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

    // CTE computes COUNT(*) OVER() before cursor so total reflects the full filter.
    // Correlated subqueries (last_active_at, node_count) run only for the page rows.
    const rows = await sql<(PartnerRow & { total: number })[]>`
      WITH base AS (
        SELECT t.id, t.name, t.partner_status, t.created_at,
               COUNT(*) OVER()::int AS total
        FROM tenants t
        WHERE t.plan = 'partner'
          ${query.status ? sql`AND t.partner_status = ${query.status}` : sql``}
      ),
      paged AS (
        SELECT * FROM base
        ${cursor
          ? sql`WHERE (created_at < ${cursor.v}::timestamptz OR (created_at = ${cursor.v}::timestamptz AND id < ${cursor.id}::uuid))`
          : sql``}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit + 1}
      )
      SELECT
        p.*,
        (SELECT MAX(ue.created_at) FROM usage_events ue WHERE ue.tenant_id = p.id) AS last_active_at,
        (SELECT COUNT(*)::int FROM nodes n WHERE n.tenant_id = p.id) AS node_count
      FROM paged p
      ORDER BY p.created_at DESC, p.id DESC
    `;

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(last.createdAt.toISOString(), last.id)
        : null;

    return c.json({
      partners: items.map(({ total: _t, ...r }) => ({
        tenantId: r.id,
        name: r.name,
        status: r.partnerStatus,
        createdAt: r.createdAt,
        lastActiveAt: r.lastActiveAt,
        nodeCount: r.nodeCount,
      })),
      nextCursor,
      total: rows[0]?.total ?? 0,
    });
  });

  app.post("/", async (c) => {
    const body = CreatePartnerSchema.parse(await c.req.json());

    const rawKey = generateApiKey();
    const hash = await sha256hex(rawKey);
    const prefix = rawKey.slice(0, 8);

    const result = await sql.begin(async (tx) => {
      const [existing] = await tx<[{ id: string }?]>`
        SELECT id FROM tenants WHERE name = ${body.name} AND plan = 'partner'
      `;
      if (existing) return { conflict: true, tenantId: existing.id } as const;

      const [tenant] = await tx<[{ id: string; name: string; createdAt: Date }]>`
        INSERT INTO tenants (id, name, slug, plan, partner_status, retention_days)
        VALUES (gen_random_uuid(), ${body.name}, NULL, 'partner', 'active', 730)
        RETURNING id, name, created_at
      `;

      const [apiKey] = await tx<[{ id: string }]>`
        INSERT INTO api_keys (tenant_id, name, key_hash, key_prefix)
        VALUES (${tenant!.id}, 'initial', ${hash}, ${prefix})
        RETURNING id
      `;

      return { tenant: tenant!, apiKey: apiKey! };
    });

    if ("conflict" in result) {
      return c.json({ error: "partner with that name already exists", tenantId: result.tenantId }, 409);
    }

    const { tenant } = result;

    logger.info(
      { contactEmail: body.contactEmail, tenantId: tenant.id },
      "partner.provision: no email service configured — welcome email skipped"
    );

    await logAdminOperation(sql, "partner.create", tenant.id, {
      tenantId: tenant.id,
      name: tenant.name,
      contactEmail: body.contactEmail,
      tier: body.tier,
    });

    return c.json(
      {
        tenantId: tenant.id,
        name: tenant.name,
        apiKey: rawKey,
        createdAt: tenant.createdAt,
      },
      201
    );
  });

  app.get("/:tenantId/usage", async (c) => {
    const { tenantId } = c.req.param();

    if (!UUID_RE.test(tenantId)) {
      return c.json({ error: "invalid tenantId" }, 400);
    }

    const [tenant] = await sql<[{ id: string }?]>`
      SELECT id FROM tenants WHERE id = ${tenantId} AND plan = 'partner'
    `;
    if (!tenant) {
      return c.json({ error: "partner tenant not found" }, 404);
    }

    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setDate(defaultFrom.getDate() - 30);

    const fromParam = c.req.query("from");
    const toParam = c.req.query("to");

    let fromDate = defaultFrom;
    let toDate = now;

    if (fromParam) {
      const d = new Date(fromParam);
      if (isNaN(d.getTime())) return c.json({ error: "invalid 'from' date" }, 400);
      fromDate = d;
    }
    if (toParam) {
      const d = new Date(toParam);
      if (isNaN(d.getTime())) return c.json({ error: "invalid 'to' date" }, 400);
      toDate = d;
    }

    const [totalsRows, dailyRows] = await Promise.all([
      sql<Array<{ eventType: UsageEventType; count: number }>>`
        SELECT event_type, COUNT(*)::int AS count
        FROM usage_events
        WHERE tenant_id = ${tenantId}
          AND created_at >= ${fromDate}
          AND created_at <= ${toDate}
        GROUP BY event_type
      `,
      sql<Array<{ date: string; eventType: UsageEventType; count: number }>>`
        SELECT DATE(created_at)::text AS date, event_type, COUNT(*)::int AS count
        FROM usage_events
        WHERE tenant_id = ${tenantId}
          AND created_at >= ${fromDate}
          AND created_at <= ${toDate}
        GROUP BY DATE(created_at), event_type
        ORDER BY DATE(created_at) ASC
      `,
    ]);

    const totals = zeroTotals();
    for (const row of totalsRows) {
      const key = EVENT_KEY[row.eventType];
      if (key) {
        totals[key] = row.count;
        totals.events += row.count;
      }
    }

    // Build date map with zero-fill for every calendar day in [from, to]
    const dailyMap = new Map<string, Record<string, number>>();
    const cur = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate()));
    const endDay = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate()));
    while (cur <= endDay) {
      dailyMap.set(utcDateString(cur), zeroTotals());
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    for (const row of dailyRows) {
      const day = dailyMap.get(row.date);
      if (day) {
        const key = EVENT_KEY[row.eventType];
        if (key) {
          day[key] = row.count;
          day.events += row.count;
        }
      }
    }

    const dailyBreakdown = Array.from(dailyMap.entries()).map(([date, counts]) => ({
      date,
      ...counts,
    }));

    return c.json({
      tenantId,
      period: { from: fromDate.toISOString(), to: toDate.toISOString() },
      totals,
      dailyBreakdown,
    });
  });

  return app;
}
