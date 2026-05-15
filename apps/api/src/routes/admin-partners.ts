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
        INSERT INTO tenants (id, name, slug, plan, retention_days)
        VALUES (gen_random_uuid(), ${body.name}, NULL, 'partner', 730)
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

  return app;
}
