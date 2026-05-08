// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import type { ApiKeyRow } from "../db/types.js";
import { getTenantId } from "./util.js";
import { generateApiKey, sha256hex } from "../auth/api-key.js";

const RotateApiKeySchema = z.object({
  name: z.string().min(1).max(200).optional(),
});

const PatchApiKeySchema = z.object({
  expiresAt: z.string().datetime().nullable(),
}).strict();

export function tenantApiKeysRouter(sql: Sql): Hono {
  const app = new Hono();

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
        RETURNING id, tenant_id, name, key_prefix, created_at, revoked_at, expires_at
      `;
    });

    // raw key returned once — caller must store it
    return c.json({ data: { ...row, key: rawKey } }, 201);
  });

  // PATCH /:keyId — set or clear expiresAt on an active key
  app.patch("/:keyId", async (c) => {
    const tenantId = getTenantId(c);
    const keyId = c.req.param("keyId");
    const body = PatchApiKeySchema.parse(await c.req.json());

    const expiresAt = body.expiresAt !== null ? new Date(body.expiresAt) : null;

    const [row] = await sql<Omit<ApiKeyRow, "keyHash">[]>`
      UPDATE api_keys
      SET expires_at = ${expiresAt}
      WHERE id = ${keyId} AND tenant_id = ${tenantId} AND revoked_at IS NULL
      RETURNING id, tenant_id, name, key_prefix, created_at, revoked_at, expires_at
    `;

    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({ data: row });
  });

  return app;
}
