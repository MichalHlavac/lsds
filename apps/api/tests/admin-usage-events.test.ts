// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Integration tests for GET /api/admin/usage-events (LSDS-1071).
// All DB assertions hit real Postgres — no database mocks (ADR A6).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app.js";
import { sql } from "../src/db/client.js";
import { createTestTenant, cleanTenant } from "./test-helpers.js";
import { rateLimitWindows } from "../src/middleware/admin-auth.js";

const TEST_SECRET = "test-admin-secret";

function adminHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${TEST_SECRET}`,
  };
}

async function insertEvent(
  tenantId: string,
  eventType: string,
  entityId?: string,
  metadata?: Record<string, unknown>,
): Promise<string> {
  const [row] = await sql<[{ id: string }]>`
    INSERT INTO usage_events (tenant_id, event_type, entity_id, metadata)
    VALUES (
      ${tenantId},
      ${eventType},
      ${entityId ?? null},
      ${metadata != null ? sql.json(metadata) : null}
    )
    RETURNING id
  `;
  return row.id;
}

let tid: string;

beforeEach(async () => {
  rateLimitWindows.clear();
  tid = randomUUID();
  await createTestTenant(sql, tid);
});

afterEach(async () => {
  await cleanTenant(sql, tid);
});

// ── GET /api/admin/usage-events ───────────────────────────────────────────────

describe("GET /api/admin/usage-events — happy path", () => {
  it("returns 200 with empty events when no data exists", async () => {
    const res = await app.request("/api/admin/usage-events", { headers: adminHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.nextCursor).toBeNull();
  });

  it("returns events ordered by createdAt DESC", async () => {
    await insertEvent(tid, "NODE_CREATED");
    await insertEvent(tid, "EDGE_CREATED");
    await insertEvent(tid, "MCP_QUERY");

    const res = await app.request("/api/admin/usage-events", { headers: adminHeaders() });
    expect(res.status).toBe(200);
    const { events } = await res.json();
    expect(events.length).toBe(3);

    // Verify descending order
    for (let i = 0; i < events.length - 1; i++) {
      expect(new Date(events[i].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(events[i + 1].createdAt).getTime(),
      );
    }
  });

  it("response shape includes all expected fields", async () => {
    const entityId = randomUUID();
    await insertEvent(tid, "NODE_CREATED", entityId, { source: "test" });

    const res = await app.request("/api/admin/usage-events", { headers: adminHeaders() });
    expect(res.status).toBe(200);
    const { events } = await res.json();
    expect(events.length).toBe(1);

    const evt = events[0];
    expect(typeof evt.id).toBe("string");
    expect(evt.tenantId).toBe(tid);
    expect(evt.eventType).toBe("NODE_CREATED");
    expect(evt.entityId).toBe(entityId);
    expect(evt.metadata).toEqual({ source: "test" });
    expect(typeof evt.createdAt).toBe("string");
    expect(() => new Date(evt.createdAt).toISOString()).not.toThrow();
  });
});

// ── Filters ───────────────────────────────────────────────────────────────────

describe("GET /api/admin/usage-events — filter by tenantId", () => {
  it("filters to a specific tenant", async () => {
    const otherTid = randomUUID();
    await createTestTenant(sql, otherTid);
    try {
      await insertEvent(tid, "NODE_CREATED");
      await insertEvent(otherTid, "EDGE_CREATED");

      const res = await app.request(
        `/api/admin/usage-events?tenantId=${tid}`,
        { headers: adminHeaders() },
      );
      expect(res.status).toBe(200);
      const { events } = await res.json();
      expect(events.length).toBe(1);
      expect(events[0].tenantId).toBe(tid);
      expect(events[0].eventType).toBe("NODE_CREATED");
    } finally {
      await cleanTenant(sql, otherTid);
    }
  });

  it("returns events from all tenants when tenantId is omitted", async () => {
    const otherTid = randomUUID();
    await createTestTenant(sql, otherTid);
    try {
      await insertEvent(tid, "NODE_CREATED");
      await insertEvent(otherTid, "EDGE_CREATED");

      const res = await app.request("/api/admin/usage-events", { headers: adminHeaders() });
      expect(res.status).toBe(200);
      const { events } = await res.json();
      const tenantIds = new Set(events.map((e: { tenantId: string }) => e.tenantId));
      expect(tenantIds.has(tid)).toBe(true);
      expect(tenantIds.has(otherTid)).toBe(true);
    } finally {
      await cleanTenant(sql, otherTid);
    }
  });
});

describe("GET /api/admin/usage-events — filter by eventType", () => {
  it("returns only events matching the given eventType", async () => {
    await insertEvent(tid, "NODE_CREATED");
    await insertEvent(tid, "EDGE_CREATED");
    await insertEvent(tid, "NODE_CREATED");

    const res = await app.request(
      "/api/admin/usage-events?eventType=NODE_CREATED",
      { headers: adminHeaders() },
    );
    expect(res.status).toBe(200);
    const { events } = await res.json();
    expect(events.length).toBe(2);
    for (const evt of events) {
      expect(evt.eventType).toBe("NODE_CREATED");
    }
  });

  it("returns empty list for an eventType with no matching events", async () => {
    await insertEvent(tid, "NODE_CREATED");

    const res = await app.request(
      "/api/admin/usage-events?eventType=MCP_QUERY",
      { headers: adminHeaders() },
    );
    expect(res.status).toBe(200);
    const { events } = await res.json();
    expect(events.length).toBe(0);
  });
});

describe("GET /api/admin/usage-events — filter by date range", () => {
  it("filters by 'from' (inclusive lower bound)", async () => {
    await insertEvent(tid, "NODE_CREATED");
    // Small delay so timestamps are strictly ordered
    await new Promise((r) => setTimeout(r, 5));
    const fromTs = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    await insertEvent(tid, "EDGE_CREATED");

    const res = await app.request(
      `/api/admin/usage-events?from=${encodeURIComponent(fromTs)}`,
      { headers: adminHeaders() },
    );
    expect(res.status).toBe(200);
    const { events } = await res.json();
    expect(events.length).toBe(1);
    expect(events[0].eventType).toBe("EDGE_CREATED");
  });

  it("filters by 'to' (inclusive upper bound)", async () => {
    await insertEvent(tid, "NODE_CREATED");
    await new Promise((r) => setTimeout(r, 5));
    const toTs = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    await insertEvent(tid, "EDGE_CREATED");

    const res = await app.request(
      `/api/admin/usage-events?to=${encodeURIComponent(toTs)}`,
      { headers: adminHeaders() },
    );
    expect(res.status).toBe(200);
    const { events } = await res.json();
    expect(events.length).toBe(1);
    expect(events[0].eventType).toBe("NODE_CREATED");
  });

  it("returns 400 for invalid 'from' date", async () => {
    const res = await app.request(
      "/api/admin/usage-events?from=not-a-date",
      { headers: adminHeaders() },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/from/i);
  });

  it("returns 400 for invalid 'to' date", async () => {
    const res = await app.request(
      "/api/admin/usage-events?to=not-a-date",
      { headers: adminHeaders() },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/to/i);
  });
});

// ── Pagination ────────────────────────────────────────────────────────────────

describe("GET /api/admin/usage-events — pagination", () => {
  it("respects limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      await insertEvent(tid, "NODE_CREATED");
    }

    const res = await app.request(
      `/api/admin/usage-events?tenantId=${tid}&limit=3`,
      { headers: adminHeaders() },
    );
    expect(res.status).toBe(200);
    const { events, nextCursor } = await res.json();
    expect(events.length).toBe(3);
    expect(nextCursor).not.toBeNull();
  });

  it("cursor-based pagination returns correct next page", async () => {
    for (let i = 0; i < 4; i++) {
      await insertEvent(tid, "NODE_CREATED");
      // Slight delay to ensure distinct timestamps
      await new Promise((r) => setTimeout(r, 2));
    }

    const page1 = await app.request(
      `/api/admin/usage-events?tenantId=${tid}&limit=2`,
      { headers: adminHeaders() },
    );
    expect(page1.status).toBe(200);
    const { events: p1Events, nextCursor: cursor1 } = await page1.json();
    expect(p1Events.length).toBe(2);
    expect(cursor1).not.toBeNull();

    const page2 = await app.request(
      `/api/admin/usage-events?tenantId=${tid}&limit=2&cursor=${cursor1}`,
      { headers: adminHeaders() },
    );
    expect(page2.status).toBe(200);
    const { events: p2Events, nextCursor: cursor2 } = await page2.json();
    expect(p2Events.length).toBe(2);
    expect(cursor2).toBeNull();

    // No overlap between pages
    const p1Ids = new Set(p1Events.map((e: { id: string }) => e.id));
    for (const evt of p2Events) {
      expect(p1Ids.has(evt.id)).toBe(false);
    }

    // Together they cover all 4 events
    const allIds = new Set([...p1Events, ...p2Events].map((e: { id: string }) => e.id));
    expect(allIds.size).toBe(4);
  });

  it("returns nextCursor=null when last page", async () => {
    await insertEvent(tid, "NODE_CREATED");

    const res = await app.request(
      `/api/admin/usage-events?tenantId=${tid}&limit=10`,
      { headers: adminHeaders() },
    );
    expect(res.status).toBe(200);
    const { events, nextCursor } = await res.json();
    expect(events.length).toBe(1);
    expect(nextCursor).toBeNull();
  });

  it("returns 400 for an invalid cursor", async () => {
    const res = await app.request(
      "/api/admin/usage-events?cursor=not-a-valid-cursor",
      { headers: adminHeaders() },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/cursor/i);
  });
});

// ── Auth guard ────────────────────────────────────────────────────────────────

describe("GET /api/admin/usage-events — auth guard", () => {
  it("returns 401 with no authorization header", async () => {
    const res = await app.request("/api/admin/usage-events", {
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong bearer token", async () => {
    const res = await app.request("/api/admin/usage-events", {
      headers: {
        "content-type": "application/json",
        authorization: "Bearer wrong-secret",
      },
    });
    expect(res.status).toBe(401);
  });
});
