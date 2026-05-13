// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AnySql } from "../db/client.js";

export function getTenantId(c: Context): string {
  // API key middleware sets this when a valid key is present
  const fromContext = c.get("tenantId");
  if (fromContext) return fromContext;
  const tenantId = c.req.header("x-tenant-id");
  if (!tenantId) throw new HTTPException(400, { message: "missing x-tenant-id header" });
  return tenantId;
}

// Typed wrapper for sql.json() — avoids scattered `as any` casts at call sites.
export function jsonb(sql: AnySql, value: object): ReturnType<AnySql["json"]> {
  return sql.json(value as Parameters<AnySql["json"]>[0]);
}

function looksLikeDb(msg: string): boolean {
  return /postgres|pg|sql|connection|timeout/i.test(msg);
}

/**
 * Converts an unknown catch value to an HTTP error tuple.
 * Domain errors with safe messages → 400 with the original message.
 * DB/infra errors and non-Error throws → 500 with a generic message.
 */
export function toHttpError(e: unknown): [{ error: string }, 400 | 500] {
  if (e instanceof Error && e.message && !looksLikeDb(e.message)) {
    return [{ error: e.message }, 400];
  }
  return [{ error: "internal server error" }, 500];
}

export function encodeCursor(v: string, id: string): string {
  return Buffer.from(JSON.stringify({ v, id }), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): { v: string; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "v" in parsed && typeof (parsed as Record<string, unknown>).v === "string" &&
      "id" in parsed && typeof (parsed as Record<string, unknown>).id === "string"
    ) {
      return parsed as { v: string; id: string };
    }
    return null;
  } catch {
    return null;
  }
}
