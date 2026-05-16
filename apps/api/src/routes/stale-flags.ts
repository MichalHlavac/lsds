// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import type { Sql } from "../db/client.js";
import type { StaleFlagRow } from "../db/types.js";
import { getTenantId, parsePaginationLimit, encodeCursor, decodeCursor } from "./util.js";

const VALID_OBJECT_TYPES = new Set(["node", "edge"]);
const VALID_SEVERITIES = new Set(["ERROR", "WARNING", "INFO"]);

interface StaleFlagEntry {
  id: string;
  objectId: string;
  objectType: string;
  severity: string;
  message: string;
  viaRelationshipType: string;
  depth: number;
  raisedAt: string;
  sourceChangeId: string;
}

function toEntry(row: StaleFlagRow): StaleFlagEntry {
  return {
    id: row.id,
    objectId: row.objectId,
    objectType: row.objectType,
    severity: row.severity,
    message: row.message,
    viaRelationshipType: row.viaRelationshipType,
    depth: row.depth,
    raisedAt: row.raisedAt.toISOString(),
    sourceChangeId: row.sourceChangeId,
  };
}

export function staleFlagsRouter(sql: Sql): Hono {
  const app = new Hono();

  app.get("/summary", async (c) => {
    const tenantId = getTenantId(c);

    interface SummaryRow {
      objectType: "node" | "edge";
      severity: "ERROR" | "WARNING" | "INFO";
      cnt: number;
    }
    interface OldestRow {
      oldestFlagAt: Date | null;
    }

    const [aggRows, [oldestRow]] = await Promise.all([
      sql<SummaryRow[]>`
        SELECT object_type AS "objectType", severity, count(*)::int AS cnt
        FROM stale_flags
        WHERE tenant_id = ${tenantId}
        GROUP BY object_type, severity
      `,
      sql<[OldestRow]>`
        SELECT min(raised_at) AS "oldestFlagAt"
        FROM stale_flags
        WHERE tenant_id = ${tenantId}
      `,
    ]);

    const byObjectType = { node: 0, edge: 0 };
    const bySeverity = { ERROR: 0, WARNING: 0, INFO: 0 };

    for (const r of aggRows) {
      byObjectType[r.objectType] += r.cnt;
      bySeverity[r.severity] += r.cnt;
    }

    return c.json({
      data: {
        byObjectType,
        bySeverity,
        oldestFlagAt: oldestRow?.oldestFlagAt ? oldestRow.oldestFlagAt.toISOString() : null,
      },
    });
  });

  app.get("/", async (c) => {
    const tenantId = getTenantId(c);

    const objectTypeParam = c.req.query("object_type");
    const severityParam = c.req.query("severity");
    const cursorParam = c.req.query("cursor");
    const limit = parsePaginationLimit(c.req.query("limit"), 50, 200);

    if (objectTypeParam && !VALID_OBJECT_TYPES.has(objectTypeParam)) {
      return c.json({ error: "invalid object_type: must be 'node' or 'edge'" }, 400);
    }
    if (severityParam && !VALID_SEVERITIES.has(severityParam)) {
      return c.json({ error: "invalid severity: must be 'ERROR', 'WARNING', or 'INFO'" }, 400);
    }

    let cursor: { v: string; id: string } | null = null;
    if (cursorParam) {
      cursor = decodeCursor(cursorParam);
      if (!cursor) return c.json({ error: "invalid cursor" }, 400);
    }

    // CTE computes COUNT(*) OVER() before cursor is applied so totalCount reflects
    // the full filter result, not just the remaining pages.
    const rows = await sql<(StaleFlagRow & { totalCount: number })[]>`
      WITH base AS (
        SELECT id, tenant_id, source_change_id, object_id, object_type, severity,
               raised_at, message, via_relationship_type, depth, created_at,
               COUNT(*) OVER()::int AS total_count
        FROM stale_flags
        WHERE tenant_id = ${tenantId}
          ${objectTypeParam ? sql`AND object_type = ${objectTypeParam}` : sql``}
          ${severityParam ? sql`AND severity = ${severityParam}` : sql``}
      )
      SELECT * FROM base
      ${cursor
        ? sql`WHERE (raised_at < ${cursor.v} OR (raised_at = ${cursor.v} AND id < ${cursor.id}))`
        : sql``}
      ORDER BY raised_at DESC, id DESC
      LIMIT ${limit + 1}
    `;

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.raisedAt.toISOString(), last.id) : null;

    return c.json({
      items: items.map(({ totalCount: _tc, ...r }) => toEntry(r as StaleFlagRow)),
      nextCursor,
      totalCount: rows[0]?.totalCount ?? 0,
    });
  });

  return app;
}
