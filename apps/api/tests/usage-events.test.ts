// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant, createTestTenant } from "./test-helpers";
import { CreateUsageEventSchema, GetUsageEventsQuerySchema } from "../src/routes/schemas";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

// usage_events.tenant_id FK requires an actual tenant row
beforeEach(async () => { tid = randomUUID(); await createTestTenant(sql, tid); });
afterEach(async () => { await cleanTenant(sql, tid); });

// ── Zod schema unit tests ─────────────────────────────────────────────────────

describe("CreateUsageEventSchema", () => {
  it("accepts all valid event types", () => {
    const types = ["NODE_CREATED", "EDGE_CREATED", "REQUIREMENT_ADDED", "VIOLATION_CHECKED", "GRAPH_TRAVERSED", "MCP_QUERY"] as const;
    for (const eventType of types) {
      expect(() => CreateUsageEventSchema.parse({ eventType })).not.toThrow();
    }
  });

  it("rejects unknown eventType", () => {
    expect(() => CreateUsageEventSchema.parse({ eventType: "UNKNOWN_EVENT" })).toThrow();
  });

  it("accepts optional entityId as UUID", () => {
    const result = CreateUsageEventSchema.parse({
      eventType: "NODE_CREATED",
      entityId: "00000000-0000-0000-0000-000000000001",
    });
    expect(result.entityId).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("rejects non-UUID entityId", () => {
    expect(() => CreateUsageEventSchema.parse({ eventType: "NODE_CREATED", entityId: "not-a-uuid" })).toThrow();
  });

  it("accepts optional metadata record", () => {
    const result = CreateUsageEventSchema.parse({
      eventType: "MCP_QUERY",
      metadata: { query: "find services", depth: 3 },
    });
    expect(result.metadata).toEqual({ query: "find services", depth: 3 });
  });

  it("omits entityId and metadata when not provided", () => {
    const result = CreateUsageEventSchema.parse({ eventType: "GRAPH_TRAVERSED" });
    expect(result.entityId).toBeUndefined();
    expect(result.metadata).toBeUndefined();
  });
});

describe("GetUsageEventsQuerySchema", () => {
  it("applies default limit of 50", () => {
    const result = GetUsageEventsQuerySchema.parse({});
    expect(result.limit).toBe(50);
  });

  it("coerces string limit to number", () => {
    const result = GetUsageEventsQuerySchema.parse({ limit: "100" });
    expect(result.limit).toBe(100);
  });

  it("rejects limit above 500", () => {
    expect(() => GetUsageEventsQuerySchema.parse({ limit: 501 })).toThrow();
  });

  it("accepts valid ISO datetime for after", () => {
    const result = GetUsageEventsQuerySchema.parse({ after: "2026-01-01T00:00:00.000Z" });
    expect(result.after).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects invalid after string", () => {
    expect(() => GetUsageEventsQuerySchema.parse({ after: "not-a-date" })).toThrow();
  });

  it("accepts valid eventType filter", () => {
    const result = GetUsageEventsQuerySchema.parse({ eventType: "NODE_CREATED" });
    expect(result.eventType).toBe("NODE_CREATED");
  });

  it("rejects unknown eventType in filter", () => {
    expect(() => GetUsageEventsQuerySchema.parse({ eventType: "BOGUS" })).toThrow();
  });
});

// ── POST /v1/usage/events ─────────────────────────────────────────────────────

describe("POST /v1/usage/events", () => {
  it("returns 201 with created event", async () => {
    const res = await app.request("/v1/usage/events", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ eventType: "NODE_CREATED" }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.eventType).toBe("NODE_CREATED");
    expect(typeof data.id).toBe("string");
    expect(typeof data.createdAt).toBe("string");
    expect(data.entityId).toBeNull();
    expect(data.metadata).toBeNull();
  });

  it("stores entityId and metadata when provided", async () => {
    const entityId = randomUUID();
    const metadata = { source: "api", version: 2 };
    const res = await app.request("/v1/usage/events", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ eventType: "EDGE_CREATED", entityId, metadata }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.entityId).toBe(entityId);
    expect(data.metadata).toEqual(metadata);
  });

  it("accepts all six event types", async () => {
    const types = ["NODE_CREATED", "EDGE_CREATED", "REQUIREMENT_ADDED", "VIOLATION_CHECKED", "GRAPH_TRAVERSED", "MCP_QUERY"];
    for (const eventType of types) {
      const res = await app.request("/v1/usage/events", {
        method: "POST",
        headers: h(),
        body: JSON.stringify({ eventType }),
      });
      expect(res.status).toBe(201);
    }
  });

  it("returns 400 for invalid eventType", async () => {
    const res = await app.request("/v1/usage/events", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ eventType: "TOTALLY_INVALID" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("validation error");
  });

  it("returns 400 when eventType is missing", async () => {
    const res = await app.request("/v1/usage/events", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ metadata: { key: "val" } }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-UUID entityId", async () => {
    const res = await app.request("/v1/usage/events", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ eventType: "NODE_CREATED", entityId: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
  });

  it("row is scoped to the correct tenant_id", async () => {
    await app.request("/v1/usage/events", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ eventType: "MCP_QUERY" }),
    });
    const rows = await sql`SELECT tenant_id FROM usage_events WHERE tenant_id = ${tid}`;
    expect(rows.length).toBe(1);
    expect(rows[0].tenantId).toBe(tid);
  });
});

// ── GET /v1/usage/events ──────────────────────────────────────────────────────

describe("GET /v1/usage/events", () => {
  async function post(eventType: string, entityId?: string) {
    const res = await app.request("/v1/usage/events", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ eventType, ...(entityId ? { entityId } : {}) }),
    });
    expect(res.status).toBe(201);
    return (await res.json()).data;
  }

  it("returns empty list for new tenant", async () => {
    const res = await app.request("/v1/usage/events", { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("returns all events with correct shape", async () => {
    await post("NODE_CREATED");
    await post("EDGE_CREATED");
    const res = await app.request("/v1/usage/events", { headers: h() });
    expect(res.status).toBe(200);
    const { events, total } = await res.json();
    expect(events.length).toBe(2);
    expect(total).toBe(2);
    for (const ev of events) {
      expect(typeof ev.id).toBe("string");
      expect(typeof ev.eventType).toBe("string");
      expect(typeof ev.createdAt).toBe("string");
    }
  });

  it("filters by eventType", async () => {
    await post("NODE_CREATED");
    await post("NODE_CREATED");
    await post("EDGE_CREATED");

    const res = await app.request("/v1/usage/events?eventType=NODE_CREATED", { headers: h() });
    expect(res.status).toBe(200);
    const { events, total } = await res.json();
    expect(total).toBe(2);
    expect(events.every((e: { eventType: string }) => e.eventType === "NODE_CREATED")).toBe(true);
  });

  it("filters by after (ISO timestamp)", async () => {
    const first = await post("NODE_CREATED");
    await new Promise((r) => setTimeout(r, 5));
    await post("EDGE_CREATED");

    // +1ms to account for sub-ms DB precision truncated in the ISO response
    const boundary = new Date(new Date(first.createdAt).getTime() + 1).toISOString();
    const url = `/v1/usage/events?after=${encodeURIComponent(boundary)}`;
    const res = await app.request(url, { headers: h() });
    expect(res.status).toBe(200);
    const { events } = await res.json();
    expect(events.length).toBe(1);
    expect(events[0].eventType).toBe("EDGE_CREATED");
  });

  it("respects limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      await post("GRAPH_TRAVERSED");
    }
    const res = await app.request("/v1/usage/events?limit=3", { headers: h() });
    expect(res.status).toBe(200);
    const { events, total } = await res.json();
    expect(events.length).toBe(3);
    expect(total).toBe(5);
  });

  it("returns 400 for invalid eventType filter", async () => {
    const res = await app.request("/v1/usage/events?eventType=BOGUS", { headers: h() });
    expect(res.status).toBe(400);
  });

  it("returns 400 for limit above 500", async () => {
    const res = await app.request("/v1/usage/events?limit=999", { headers: h() });
    expect(res.status).toBe(400);
  });

  it("cross-tenant isolation: GET returns only caller's events", async () => {
    await post("NODE_CREATED");
    await post("EDGE_CREATED");

    const otherTid = randomUUID();
    try {
      await createTestTenant(sql, otherTid);
      const res = await app.request("/v1/usage/events", {
        headers: { "content-type": "application/json", "x-tenant-id": otherTid },
      });
      expect(res.status).toBe(200);
      const { events, total } = await res.json();
      expect(events).toEqual([]);
      expect(total).toBe(0);
    } finally {
      await cleanTenant(sql, otherTid);
    }
  });

  it("returns 400 when x-tenant-id header is absent", async () => {
    const res = await app.request("/v1/usage/events");
    expect(res.status).toBe(400);
  });
});
