// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { createMiddleware } from "hono/factory";
import type { Sql } from "../db/client.js";
import type { ApiKeyRow } from "../db/types.js";
import { config } from "../config.js";

declare module "hono" {
  interface ContextVariableMap {
    tenantId: string;
  }
}

// When true: requests without X-Api-Key are rejected with 401.
// Leave unset in development/test environments to keep existing X-Tenant-Id flows working.
export const apiKeyAuthEnabled = config.apiKeyAuthEnabled;

export async function sha256hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateApiKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `lsds_${hex}`;
}

export function apiKeyMiddleware(sql: Sql) {
  return createMiddleware(async (c, next) => {
    const key = c.req.header("X-Api-Key");

    if (!key) {
      if (apiKeyAuthEnabled) return c.json({ error: "unauthorized" }, 401);
      return next();
    }

    const hash = await sha256hex(key);
    const [row] = await sql<ApiKeyRow[]>`
      SELECT * FROM api_keys
      WHERE key_hash = ${hash}
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
    `;

    if (!row) {
      return c.json({ error: "forbidden" }, 403);
    }

    c.set("tenantId", row.tenantId);
    return next();
  });
}
