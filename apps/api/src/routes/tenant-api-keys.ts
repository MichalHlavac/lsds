// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import type { ApiKeyRow } from "../db/types.js";
import { getTenantId } from "./util.js";
import { generateApiKey, sha256hex } from "../auth/api-key.js";
import { insertAuditLog } from "../db/audit.js";

const RotateApiKeySchema = z.object({
  name: z.string().min(1).max(200).optional(),
});

const PatchApiKeySchema = z
  .object({
    expiresAt: z.string().datetime().nullable().optional(),
    rateLimitRpm: z.number().int().positive().nullable().optional(),
    rateLimitBurst: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "at least one field must be provided",
  });

export function tenantApiKeysRouter(sql: Sql): Hono {
  const app = new Hono();

  // GET / — list all non-revoked API keys for the tenant
  app.get("/", async (c) => {
    const tenantId = getTenantId(c);
    const rows = await sql<Omit<ApiKeyRow, "keyHash">[]>`
      SELECT id, tenant_id, name, key_prefix, created_at, revoked_at, expires_at,
             rate_limit_rpm, rate_limit_burst
      FROM api_keys
      WHERE tenant_id = ${tenantId} AND revoked_at IS NULL
      ORDER BY created_at DESC
    `;
    return c.json({ data: rows });
  });

  // POST /rotate — revoke all active keys for tenant, issue one new key
  app.post("/rotate", async (c) => {
    const tenantId = getTenantId(c);
    const raw = await c.req.json().catch(() => ({}));
    const body = RotateApiKeySchema.parse(raw);

    const rawKey = generateApiKey();
    const hash = await sha256hex(rawKey);
    const prefix = rawKey.slice(0, 8);
    const name = body.name ?? "Rotated key";

    const [row] = await sql.begin(async (tx) => {
      await tx`
        UPDATE api_keys
        SET revoked_at = now()
        WHERE tenant_id = ${tenantId} AND revoked_at IS NULL
      `;
      return tx<Omit<ApiKeyRow, "keyHash">[]>`
        INSERT INTO api_keys (tenant_id, name, key_hash, key_prefix)
        VALUES (${tenantId}, ${name}, ${hash}, ${prefix})
        RETURNING id, tenant_id, name, key_prefix, created_at, revoked_at, expires_at,
                  rate_limit_rpm, rate_limit_burst
      `;
    });

    // raw key returned once — caller must store it
    return c.json({ data: { ...row, key: rawKey } }, 201);
  });

  // PATCH /:keyId — update expiresAt and/or per-key rate limits
  app.patch("/:keyId", async (c) => {
    const tenantId = getTenantId(c);
    const keyId = c.req.param("keyId");
    const body = PatchApiKeySchema.parse(await c.req.json());

    const expiresAt =
      body.expiresAt !== undefined
        ? body.expiresAt !== null
          ? new Date(body.expiresAt)
          : null
        : undefined;

    const [row] = await sql<Omit<ApiKeyRow, "keyHash">[]>`
      UPDATE api_keys
      SET
        ${expiresAt !== undefined ? sql`expires_at = ${expiresAt},` : sql``}
        ${body.rateLimitRpm !== undefined ? sql`rate_limit_rpm = ${body.rateLimitRpm},` : sql``}
        ${body.rateLimitBurst !== undefined ? sql`rate_limit_burst = ${body.rateLimitBurst},` : sql``}
        name = name
      WHERE id = ${keyId} AND tenant_id = ${tenantId} AND revoked_at IS NULL
      RETURNING id, tenant_id, name, key_prefix, created_at, revoked_at, expires_at,
                rate_limit_rpm, rate_limit_burst
    `;

    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({ data: row });
  });

  // DELETE /:keyId — revoke a single key belonging to the authenticated tenant
  app.delete("/:keyId", async (c) => {
    const tenantId = getTenantId(c);
    const keyId = c.req.param("keyId");
    const apiKeyId = c.get("apiKeyId") ?? null;

    const [row] = await sql<[{ id: string }?]>`
      UPDATE api_keys
      SET revoked_at = now()
      WHERE id = ${keyId} AND tenant_id = ${tenantId} AND revoked_at IS NULL
      RETURNING id
    `;

    if (!row) return c.json({ error: "not found" }, 404);

    await insertAuditLog(sql, tenantId, apiKeyId, "api_key.revoked", "api_key", keyId, null);

    return new Response(null, { status: 204 });
  });

  return app;
}
