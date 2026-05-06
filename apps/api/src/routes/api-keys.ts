// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { z } from "zod";
import type { Sql } from "../db/client.js";
import type { ApiKeyRow } from "../db/types.js";
import { getTenantId } from "./util.js";
import { generateApiKey, sha256hex } from "../auth/api-key.js";

const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(200),
});

export function apiKeysRouter(sql: Sql): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const tenantId = getTenantId(c);
    const rows = await sql<Omit<ApiKeyRow, "keyHash">[]>`
      SELECT id, tenant_id, name, key_prefix, created_at, revoked_at
      FROM api_keys
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC
    `;
    return c.json({ data: rows });
  });

  app.post("/", async (c) => {
    const tenantId = getTenantId(c);
    const body = CreateApiKeySchema.parse(await c.req.json());

    const rawKey = generateApiKey();
    const hash = await sha256hex(rawKey);
    const prefix = rawKey.slice(0, 8);

    const [row] = await sql<Omit<ApiKeyRow, "keyHash">[]>`
      INSERT INTO api_keys (tenant_id, name, key_hash, key_prefix)
      VALUES (${tenantId}, ${body.name}, ${hash}, ${prefix})
      RETURNING id, tenant_id, name, key_prefix, created_at, revoked_at
    `;

    // raw key returned once — caller must store it; hash is never exposed
    return c.json({ data: { ...row, key: rawKey } }, 201);
  });

  app.delete("/:id", async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.param();

    const [row] = await sql<{ id: string }[]>`
      UPDATE api_keys
      SET revoked_at = now()
      WHERE id = ${id} AND tenant_id = ${tenantId} AND revoked_at IS NULL
      RETURNING id
    `;

    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({ data: { id } });
  });

  return app;
}
