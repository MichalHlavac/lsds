// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import { generateApiKey, sha256hex } from "../auth/api-key.js";

const CreateTenantSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with hyphens"),
  plan: z.enum(["trial", "partner"]),
});

export function adminTenantsRouter(sql: Sql): Hono {
  const app = new Hono();

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
        INSERT INTO tenants (id, name, slug, plan, retention_days)
        VALUES (gen_random_uuid(), ${body.name}, ${body.slug}, ${body.plan}, 730)
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

    const newKey = await sql.begin(async (tx) => {
      await tx`
        UPDATE api_keys SET revoked_at = now()
        WHERE tenant_id = ${tenantId} AND revoked_at IS NULL
      `;

      const [apiKey] = await tx<[{ id: string; keyPrefix: string; createdAt: Date }]>`
        INSERT INTO api_keys (tenant_id, name, key_hash, key_prefix)
        VALUES (${tenantId}, 'rotated', ${hash}, ${prefix})
        RETURNING id, key_prefix, created_at
      `;

      return apiKey;
    });

    return c.json({ data: { ...newKey, key: rawKey } });
  });

  return app;
}
