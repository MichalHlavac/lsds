// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import postgres from "postgres";
import type { AnySql } from "../db/client.js";

export function getTenantId(c: Context): string {
  // API key middleware sets this when a valid key is present
  const fromContext = c.get("tenantId");
  if (fromContext) return fromContext;
  const tenantId = c.req.header("x-tenant-id");
  if (!tenantId) throw new HTTPException(400, { message: "missing x-tenant-id header" });
  return tenantId;
}

// Typed wrapper for sql.json() — avoids scattered `as any` casts.
// Values come from Zod-validated JSON (z.record(z.unknown())), so serialization is safe.
export function jsonb(sql: AnySql, value: Record<string, unknown>): postgres.Parameter {
  return sql.json(value as postgres.JSONValue);
}
