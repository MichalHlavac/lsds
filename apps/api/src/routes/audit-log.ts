// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import type { Sql } from "../db/client.js";
import type { AuditLogRow, AuditOperation } from "../db/types.js";
import { getTenantId, parsePaginationLimit } from "./util.js";

const VALID_OPERATIONS = new Set<string>([
  "node.create", "node.update", "node.delete",
  "node.deprecate", "node.archive", "node.purge",
  "edge.create", "edge.update", "edge.delete",
  "edge.deprecate", "edge.archive", "edge.purge",
  "rate_limit_hit",
]);

interface CursorPayload {
  createdAt: string;
  id: string;
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString("base64url");
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      typeof parsed === "object" && parsed !== null &&
      "createdAt" in parsed && typeof (parsed as Record<string, unknown>).createdAt === "string" &&
      "id" in parsed && typeof (parsed as Record<string, unknown>).id === "string"
    ) {
      return parsed as CursorPayload;
    }
  } catch { /* invalid cursor */ }
  return null;
}

export function auditLogRouter(sql: Sql): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const tenantId = getTenantId(c);

    const entityId = c.req.query("entity_id") ?? undefined;
    const entityType = c.req.query("entity_type") ?? undefined;
    const operationParam = c.req.query("operation") ?? undefined;
    const fromParam = c.req.query("from") ?? undefined;
    const toParam = c.req.query("to") ?? undefined;
    const cursorParam = c.req.query("cursor") ?? undefined;
    const limit = parsePaginationLimit(c.req.query("limit"), 50, 200);

    if (operationParam && !VALID_OPERATIONS.has(operationParam)) {
      return c.json({ error: `invalid operation; must be one of: ${[...VALID_OPERATIONS].join(", ")}` }, 400);
    }

    let fromDate: Date | undefined;
    let toDate: Date | undefined;
    if (fromParam) {
      fromDate = new Date(fromParam);
      if (isNaN(fromDate.getTime())) return c.json({ error: "invalid 'from' date" }, 400);
    }
    if (toParam) {
      toDate = new Date(toParam);
      if (isNaN(toDate.getTime())) return c.json({ error: "invalid 'to' date" }, 400);
    }

    let cursor: CursorPayload | null = null;
    if (cursorParam) {
      cursor = decodeCursor(cursorParam);
      if (!cursor) return c.json({ error: "invalid cursor" }, 400);
    }

    const rows = await sql<AuditLogRow[]>`
      SELECT * FROM audit_log
      WHERE tenant_id = ${tenantId}
        ${entityId ? sql`AND entity_id = ${entityId}` : sql``}
        ${entityType ? sql`AND entity_type = ${entityType}` : sql``}
        ${operationParam ? sql`AND operation = ${operationParam as AuditOperation}` : sql``}
        ${fromDate ? sql`AND created_at >= ${fromDate}` : sql``}
        ${toDate ? sql`AND created_at <= ${toDate}` : sql``}
        ${cursor
          ? sql`AND (created_at < ${cursor.createdAt} OR (created_at = ${cursor.createdAt} AND id < ${cursor.id}))`
          : sql``}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit + 1}
    `;

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

    return c.json({ items, nextCursor });
  });

  // Audit log is append-only — reject all destructive methods
  app.delete("/", (c) => c.json({ error: "audit log entries cannot be deleted" }, 405));
  app.delete("/:id", (c) => c.json({ error: "audit log entries cannot be deleted" }, 405));
  app.put("/", (c) => c.json({ error: "audit log entries are immutable" }, 405));
  app.patch("/:id", (c) => c.json({ error: "audit log entries are immutable" }, 405));

  return app;
}
