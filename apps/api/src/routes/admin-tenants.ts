// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { generateApiKey, sha256hex } from "../auth/api-key.js";
import { logAdminOperation } from "../db/admin-audit.js";

const PatchTenantRateLimitsSchema = z.object({
  rateLimitRpm: z.number().int().positive(),
  rateLimitBurst: z.number().int().positive(),
}).partial().refine((data) => Object.keys(data).length > 0, {
  message: "at least one field must be provided",
});

const CreateTenantSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with hyphens"),
  plan: z.enum(["trial", "partner"]),
});

export function adminTenantsRouter(sql: Sql): Hono {
  const app = new Hono();

  // GET / — list all tenants with active (non-revoked) API key counts
  app.get("/", async (c) => {
    const rows = await sql<
      Array<{
        id: string;
        name: string;
        slug: string | null;
        plan: string;
        createdAt: Date;
        activeApiKeyCount: number;
      }>
    >`
      SELECT
        t.id,
        t.name,
        t.slug,
        t.plan,
        t.created_at,
        COUNT(ak.id) FILTER (WHERE ak.revoked_at IS NULL)::int AS active_api_key_count
      FROM tenants t
      LEFT JOIN api_keys ak ON ak.tenant_id = t.id
      GROUP BY t.id, t.name, t.slug, t.plan, t.created_at
      ORDER BY t.created_at DESC
    `;

    return c.json({ data: rows });
  });

  // POST / — create tenant + return initial API key (plaintext, never shown again)
  app.post("/", async (c) => {
    const body = CreateTenantSchema.parse(await c.req.json());

    const rawKey = generateApiKey();
    const hash = await sha256hex(rawKey);
    const prefix = rawKey.slice(0, 8);

    const result = await sql.begin(async (tx) => {
      // Check for duplicate slug first (gives a clear 409 before insert attempt)
      const [existing] = await tx<[{ id: string }?]>`
        SELECT id FROM tenants WHERE slug = ${body.slug}
      `;
      if (existing) return { conflict: true } as const;

      const [tenant] = await tx<[{ id: string; name: string; slug: string; plan: string; createdAt: Date }]>`
        INSERT INTO tenants (id, name, slug, plan, retention_days, partner_status)
        VALUES (gen_random_uuid(), ${body.name}, ${body.slug}, ${body.plan}, 730,
          ${body.plan === "partner" ? "active" : null})
        RETURNING id, name, slug, plan, created_at
      `;

      const [apiKey] = await tx<[{ id: string; keyPrefix: string; createdAt: Date }]>`
        INSERT INTO api_keys (tenant_id, name, key_hash, key_prefix)
        VALUES (${tenant!.id}, 'bootstrap', ${hash}, ${prefix})
        RETURNING id, key_prefix, created_at
      `;

      return { tenant, apiKey };
    });

    if ("conflict" in result) {
      return c.json({ error: "tenant with that slug already exists" }, 409);
    }

    const { tenant, apiKey } = result;

    await logAdminOperation(sql, "tenant.create", tenant!.id, {
      tenantId: tenant!.id,
      name: tenant!.name,
      slug: tenant!.slug,
      plan: tenant!.plan,
    });

    // apiKey is returned once in plaintext — caller must store it; hash never exposed
    return c.json(
      {
        data: {
          tenant,
          apiKey: { ...apiKey, key: rawKey },
        },
      },
      201
    );
  });

  // PATCH /:tenantId — update tenant-level rate limit defaults
  app.patch("/:tenantId", async (c) => {
    const { tenantId } = c.req.param();
    const body = PatchTenantRateLimitsSchema.parse(await c.req.json());

    const [before] = await sql<[{ rateLimitRpm: number; rateLimitBurst: number }?]>`
      SELECT rate_limit_rpm, rate_limit_burst FROM tenants WHERE id = ${tenantId}
    `;
    if (!before) return c.json({ error: "tenant not found" }, 404);

    const [row] = await sql<[{ id: string; rateLimitRpm: number; rateLimitBurst: number }?]>`
      UPDATE tenants
      SET
        ${body.rateLimitRpm !== undefined ? sql`rate_limit_rpm = ${body.rateLimitRpm},` : sql``}
        ${body.rateLimitBurst !== undefined ? sql`rate_limit_burst = ${body.rateLimitBurst},` : sql``}
        updated_at = now()
      WHERE id = ${tenantId}
      RETURNING id, rate_limit_rpm, rate_limit_burst
    `;

    if (!row) return c.json({ error: "tenant not found" }, 404);

    await logAdminOperation(sql, "tenant.update_rate_limits", tenantId, {
      before: { rateLimitRpm: before.rateLimitRpm, rateLimitBurst: before.rateLimitBurst },
      after: { rateLimitRpm: row.rateLimitRpm, rateLimitBurst: row.rateLimitBurst },
    });

    return c.json({ data: row });
  });

  // PATCH /:tenantId/api-keys — rotate: revoke all active keys, issue new one
  app.patch("/:tenantId/api-keys", async (c) => {
    const { tenantId } = c.req.param();

    const [tenantRow] = await sql<[{ id: string }?]>`
      SELECT id FROM tenants WHERE id = ${tenantId}
    `;
    if (!tenantRow) return c.json({ error: "tenant not found" }, 404);

    const rawKey = generateApiKey();
    const hash = await sha256hex(rawKey);
    const prefix = rawKey.slice(0, 8);

    const { newKey, revokedIds } = await sql.begin(async (tx) => {
      const revoked = await tx<{ id: string }[]>`
        UPDATE api_keys SET revoked_at = now()
        WHERE tenant_id = ${tenantId} AND revoked_at IS NULL
        RETURNING id
      `;

      const [apiKey] = await tx<[{ id: string; keyPrefix: string; createdAt: Date }]>`
        INSERT INTO api_keys (tenant_id, name, key_hash, key_prefix)
        VALUES (${tenantId}, 'rotated', ${hash}, ${prefix})
        RETURNING id, key_prefix, created_at
      `;

      return { newKey: apiKey, revokedIds: revoked.map((r) => r.id) };
    });

    await logAdminOperation(sql, "tenant.rotate_api_key", tenantId, {
      revokedKeyIds: revokedIds,
    });

    return c.json({ data: { ...newKey, key: rawKey } });
  });

  // DELETE /:tenantId/api-keys/:keyId — admin selective revocation of a single key
  app.delete("/:tenantId/api-keys/:keyId", async (c) => {
    const { tenantId, keyId } = c.req.param();

    const [row] = await sql<[{ id: string }?]>`
      UPDATE api_keys
      SET revoked_at = now()
      WHERE id = ${keyId} AND tenant_id = ${tenantId} AND revoked_at IS NULL
      RETURNING id
    `;

    if (!row) return c.json({ error: "not found" }, 404);

    await logAdminOperation(sql, "tenant.revoke_api_key", tenantId, { keyId });

    return new Response(null, { status: 204 });
  });

  return app;
}
