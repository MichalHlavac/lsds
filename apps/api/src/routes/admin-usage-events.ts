// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import type { Sql } from "../db/client.js";
import type { UsageEventRow } from "../db/types.js";
import { parsePaginationLimit } from "./util.js";

interface CursorPayload {
  createdAt: string;
  id: string;
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString("base64url");
}

function decodeCursor(raw: string): CursorPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
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

function rowToEvent(row: UsageEventRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    eventType: row.eventType,
    entityId: row.entityId,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  };
}

export function adminUsageEventsRouter(sql: Sql): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const tenantIdParam = c.req.query("tenantId") ?? undefined;
    const eventTypeParam = c.req.query("eventType") ?? undefined;
    const fromParam = c.req.query("from") ?? undefined;
    const toParam = c.req.query("to") ?? undefined;
    const cursorParam = c.req.query("cursor") ?? undefined;
    const limit = parsePaginationLimit(c.req.query("limit"), 50, 500);

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

    const rows = await sql<UsageEventRow[]>`
      SELECT * FROM usage_events
      WHERE TRUE
        ${tenantIdParam ? sql`AND tenant_id = ${tenantIdParam}` : sql``}
        ${eventTypeParam ? sql`AND event_type = ${eventTypeParam}` : sql``}
        ${fromDate ? sql`AND created_at >= ${fromDate}` : sql``}
        ${toDate ? sql`AND created_at <= ${toDate}` : sql``}
        ${cursor
          ? sql`AND (created_at < ${cursor.createdAt} OR (created_at = ${cursor.createdAt} AND id < ${cursor.id}))`
          : sql``}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit + 1}
    `;

    const hasMore = rows.length > limit;
    const events = hasMore ? rows.slice(0, limit) : rows;
    const last = events[events.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

    return c.json({ events: events.map(rowToEvent), nextCursor });
  });

  return app;
}
