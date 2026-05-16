// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant, createTestTenant } from "./test-helpers";
import { GetUsageSummaryQuerySchema } from "../src/routes/schemas";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

beforeEach(async () => { tid = randomUUID(); await createTestTenant(sql, tid); });
afterEach(async () => { await cleanTenant(sql, tid); });

// ── Zod schema unit tests ─────────────────────────────────────────────────────

describe("GetUsageSummaryQuerySchema", () => {
  it("accepts no params", () => {
    expect(() => GetUsageSummaryQuerySchema.parse({})).not.toThrow();
  });

  it("accepts a valid ISO datetime for since", () => {
    const result = GetUsageSummaryQuerySchema.parse({ since: "2026-01-01T00:00:00.000Z" });
    expect(result.since).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects an invalid since value", () => {
    expect(() => GetUsageSummaryQuerySchema.parse({ since: "not-a-date" })).toThrow();
  });
});

// ── GET /v1/usage/summary ─────────────────────────────────────────────────────

async function postEvent(tenantId: string, eventType: string) {
  const res = await app.request("/v1/usage/events", {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": tenantId },
    body: JSON.stringify({ eventType }),
  });
  expect(res.status).toBe(201);
}

describe("GET /v1/usage/summary", () => {
  it("returns zero counts for empty tenant — not 404", async () => {
    const res = await app.request("/v1/usage/summary", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.total).toBe(0);
    expect(data.byEventType).toEqual([]);
    expect(typeof data.period.from).toBe("string");
    expect(typeof data.period.to).toBe("string");
  });

  it("default window aggregates last-30-days events", async () => {
    await postEvent(tid, "NODE_CREATED");
    await postEvent(tid, "NODE_CREATED");
    await postEvent(tid, "EDGE_CREATED");

    const res = await app.request("/v1/usage/summary", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.total).toBe(3);

    const nodeEntry = data.byEventType.find((e: { eventType: string }) => e.eventType === "NODE_CREATED");
    const edgeEntry = data.byEventType.find((e: { eventType: string }) => e.eventType === "EDGE_CREATED");
    expect(nodeEntry?.count).toBe(2);
    expect(edgeEntry?.count).toBe(1);
  });

  it("since filter scopes the window correctly", async () => {
    await postEvent(tid, "NODE_CREATED");
    await new Promise((r) => setTimeout(r, 20)); // push boundary past NODE_CREATED's created_at
    const boundary = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    await postEvent(tid, "EDGE_CREATED");

    const url = `/v1/usage/summary?since=${encodeURIComponent(boundary)}`;
    const res = await app.request(url, { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    // Only EDGE_CREATED is after the boundary
    expect(data.total).toBe(1);
    expect(data.byEventType.length).toBe(1);
    expect(data.byEventType[0].eventType).toBe("EDGE_CREATED");
    expect(data.byEventType[0].count).toBe(1);
  });

  it("period.from reflects since param", async () => {
    const since = "2026-01-01T00:00:00.000Z";
    const res = await app.request(`/v1/usage/summary?since=${encodeURIComponent(since)}`, { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(new Date(data.period.from).toISOString()).toBe(since);
  });

  it("period.from defaults to ~30 days ago when since is omitted", async () => {
    const res = await app.request("/v1/usage/summary", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const fromMs = new Date(data.period.from).getTime();
    const toMs = new Date(data.period.to).getTime();
    const diffDays = (toMs - fromMs) / (1000 * 60 * 60 * 24);
    // Should be approximately 30 days (allow ±1s drift)
    expect(diffDays).toBeGreaterThan(29.99);
    expect(diffDays).toBeLessThan(30.01);
  });

  it("cross-tenant isolation: summary returns only caller's events", async () => {
    await postEvent(tid, "NODE_CREATED");

    const otherTid = randomUUID();
    try {
      await createTestTenant(sql, otherTid);
      await postEvent(otherTid, "EDGE_CREATED");
      await postEvent(otherTid, "GRAPH_TRAVERSED");

      const res = await app.request("/v1/usage/summary", {
        headers: { "content-type": "application/json", "x-tenant-id": tid },
      });
      expect(res.status).toBe(200);
      const { data } = await res.json();
      // tid has only 1 NODE_CREATED
      expect(data.total).toBe(1);
      expect(data.byEventType.length).toBe(1);
      expect(data.byEventType[0].eventType).toBe("NODE_CREATED");
    } finally {
      await cleanTenant(sql, otherTid);
    }
  });

  it("returns 400 for invalid since value", async () => {
    const res = await app.request("/v1/usage/summary?since=not-a-date", { headers: h() });
    expect(res.status).toBe(400);
  });

  it("returns 400 when x-tenant-id header is absent", async () => {
    const res = await app.request("/v1/usage/summary");
    expect(res.status).toBe(400);
  });

  it("byEventType is sorted alphabetically", async () => {
    await postEvent(tid, "MCP_QUERY");
    await postEvent(tid, "EDGE_CREATED");
    await postEvent(tid, "NODE_CREATED");

    const res = await app.request("/v1/usage/summary", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const types = data.byEventType.map((e: { eventType: string }) => e.eventType);
    expect(types).toEqual([...types].sort());
  });
});
