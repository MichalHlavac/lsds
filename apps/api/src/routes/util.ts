import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Sql } from "../db/client.js";

export function getTenantId(c: Context): string {
  const tenantId = c.req.header("x-tenant-id");
  if (!tenantId) throw new HTTPException(400, { message: "missing x-tenant-id header" });
  return tenantId;
}

// Typed wrapper for sql.json() — avoids scattered `as any` casts.
// Values come from Zod-validated JSON (z.record(z.unknown())), so serialization is safe.
export function jsonb(sql: Sql, value: Record<string, unknown>): ReturnType<Sql["json"]> {
  return sql.json(value as Parameters<Sql["json"]>[0]);
}
