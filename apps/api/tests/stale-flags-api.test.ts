// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

// Integration tests for LSDS-836: GET /v1/stale-flags + summary + usage.staleFlagCount

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant, createTestTenant } from "./test-helpers";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

async function createNode(layer = "L3", name = randomUUID(), type = "Service") {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ type, layer, name }),
  });
  expect(res.status).toBe(201);
  return (await res.json() as { data: { id: string; type: string; layer: string; name: string } }).data;
}

async function createEdge(sourceId: string, targetId: string, type = "realizes") {
  const res = await app.request("/v1/edges", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ sourceId, targetId, type, layer: "L3" }),
  });
  expect(res.status).toBe(201);
  return (await res.json() as { data: { id: string } }).data;
}

// Seed a stale_flag row directly to test the read surface independently of propagation logic.
async function seedFlag(opts: {
  objectId: string;
  objectType: "node" | "edge";
  severity: "ERROR" | "WARNING" | "INFO";
  message?: string;
  depth?: number;
  raisedAt?: Date;
}) {
  const id = randomUUID();
  const sourceChangeId = randomUUID();
  await sql`
    INSERT INTO stale_flags
      (id, tenant_id, source_change_id, object_id, object_type, severity, raised_at, message, via_relationship_type, depth)
    VALUES
      (${id}, ${tid}, ${sourceChangeId}::uuid, ${opts.objectId}::uuid, ${opts.objectType},
       ${opts.severity}, ${opts.raisedAt ?? new Date()}, ${opts.message ?? "test flag"},
       'realizes', ${opts.depth ?? 1})
  `;
  return { id, sourceChangeId };
}

beforeEach(async () => {
  tid = randomUUID();
  await createTestTenant(sql, tid);
});
afterEach(async () => { await cleanTenant(sql, tid); });

// ── GET /v1/stale-flags ───────────────────────────────────────────────────────

describe("GET /v1/stale-flags", () => {
  it("returns empty list when no flags exist", async () => {
    const res = await app.request("/v1/stale-flags", { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json() as { items: unknown[]; nextCursor: null; totalCount: number };
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
    expect(body.totalCount).toBe(0);
  });

  it("returns flags sorted by raisedAt DESC", async () => {
    const node = await createNode("L3");
    const older = new Date("2026-01-01T00:00:00Z");
    const newer = new Date("2026-06-01T00:00:00Z");
    await seedFlag({ objectId: node.id, objectType: "node", severity: "INFO", raisedAt: older });
    await seedFlag({ objectId: node.id, objectType: "node", severity: "WARNING", raisedAt: newer });

    const res = await app.request("/v1/stale-flags", { headers: h() });
    expect(res.status).toBe(200);
    const { items } = await res.json() as { items: { severity: string }[] };
    expect(items[0].severity).toBe("WARNING");
    expect(items[1].severity).toBe("INFO");
  });

  it("returns correct StaleFlagEntry shape", async () => {
    const node = await createNode("L3");
    const { id, sourceChangeId } = await seedFlag({ objectId: node.id, objectType: "node", severity: "ERROR" });

    const res = await app.request("/v1/stale-flags", { headers: h() });
    expect(res.status).toBe(200);
    const { items } = await res.json() as { items: Record<string, unknown>[] };
    expect(items).toHaveLength(1);
    const entry = items[0];
    expect(entry.id).toBe(id);
    expect(entry.objectId).toBe(node.id);
    expect(entry.objectType).toBe("node");
    expect(entry.severity).toBe("ERROR");
    expect(entry.message).toBe("test flag");
    expect(entry.viaRelationshipType).toBe("realizes");
    expect(entry.depth).toBe(1);
    expect(typeof entry.raisedAt).toBe("string");
    expect(entry.sourceChangeId).toBe(sourceChangeId);
  });

  it("filters by object_type=node", async () => {
    const nodeA = await createNode("L3");
    const nodeB = await createNode("L3");
    const edge = await createEdge(nodeA.id, nodeB.id);
    await seedFlag({ objectId: nodeA.id, objectType: "node", severity: "INFO" });
    await seedFlag({ objectId: edge.id, objectType: "edge", severity: "INFO" });

    const res = await app.request("/v1/stale-flags?object_type=node", { headers: h() });
    expect(res.status).toBe(200);
    const { items, totalCount } = await res.json() as { items: { objectType: string }[]; totalCount: number };
    expect(items.every((f) => f.objectType === "node")).toBe(true);
    expect(totalCount).toBe(1);
  });

  it("filters by severity=ERROR", async () => {
    const node = await createNode("L3");
    await seedFlag({ objectId: node.id, objectType: "node", severity: "ERROR" });
    await seedFlag({ objectId: node.id, objectType: "node", severity: "INFO" });

    const res = await app.request("/v1/stale-flags?severity=ERROR", { headers: h() });
    expect(res.status).toBe(200);
    const { items, totalCount } = await res.json() as { items: { severity: string }[]; totalCount: number };
    expect(items.every((f) => f.severity === "ERROR")).toBe(true);
    expect(totalCount).toBe(1);
  });

  it("returns 400 for invalid object_type", async () => {
    const res = await app.request("/v1/stale-flags?object_type=invalid", { headers: h() });
    expect(res.status).toBe(400);
    const { error } = await res.json() as { error: string };
    expect(error).toMatch(/object_type/);
  });

  it("returns 400 for invalid severity", async () => {
    const res = await app.request("/v1/stale-flags?severity=CRITICAL", { headers: h() });
    expect(res.status).toBe(400);
    const { error } = await res.json() as { error: string };
    expect(error).toMatch(/severity/);
  });

  it("cursor pagination works", async () => {
    const node = await createNode("L3");
    for (let i = 0; i < 5; i++) {
      await seedFlag({ objectId: node.id, objectType: "node", severity: "INFO" });
    }

    const page1 = await app.request("/v1/stale-flags?limit=3", { headers: h() });
    expect(page1.status).toBe(200);
    const body1 = await page1.json() as { items: unknown[]; nextCursor: string | null; totalCount: number };
    expect(body1.items).toHaveLength(3);
    expect(body1.nextCursor).not.toBeNull();
    expect(body1.totalCount).toBe(5);

    const page2 = await app.request(`/v1/stale-flags?limit=3&cursor=${body1.nextCursor}`, { headers: h() });
    expect(page2.status).toBe(200);
    const body2 = await page2.json() as { items: unknown[]; nextCursor: string | null };
    expect(body2.items).toHaveLength(2);
    expect(body2.nextCursor).toBeNull();
  });

  it("returns 400 for invalid cursor", async () => {
    const res = await app.request("/v1/stale-flags?cursor=notbase64!!!", { headers: h() });
    expect(res.status).toBe(400);
  });

  it("is tenant-scoped — cross-tenant isolation", async () => {
    const node = await createNode("L3");
    await seedFlag({ objectId: node.id, objectType: "node", severity: "INFO" });

    const otherTid = randomUUID();
    try {
      await createTestTenant(sql, otherTid);
      const res = await app.request("/v1/stale-flags", {
        headers: { "content-type": "application/json", "x-tenant-id": otherTid },
      });
      expect(res.status).toBe(200);
      const { items, totalCount } = await res.json() as { items: unknown[]; totalCount: number };
      expect(items).toHaveLength(0);
      expect(totalCount).toBe(0);
    } finally {
      await cleanTenant(sql, otherTid);
    }
  });

  it("flags are cleared when flagged object is mutated (propagation path)", async () => {
    const nodeA = await createNode("L3", "node-clear-a");
    const nodeB = await createNode("L3", "node-clear-b");
    await createEdge(nodeB.id, nodeA.id, "realizes");

    // Update A — propagation writes flag on B
    await app.request("/v1/nodes", {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({ type: nodeA.type, layer: nodeA.layer, name: nodeA.name, version: "0.2.0" }),
    });

    const before = await app.request("/v1/stale-flags?object_type=node", { headers: h() });
    const { totalCount: countBefore } = await before.json() as { totalCount: number };
    expect(countBefore).toBeGreaterThan(0);

    // Mutate B — its own flags should be cleared
    await app.request("/v1/nodes", {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({ type: nodeB.type, layer: nodeB.layer, name: nodeB.name, version: "0.2.0" }),
    });

    const after = await app.request("/v1/stale-flags", { headers: h() });
    const { items } = await after.json() as { items: { objectId: string }[] };
    const bFlags = items.filter((f) => f.objectId === nodeB.id);
    expect(bFlags).toHaveLength(0);
  });
});

// ── GET /v1/stale-flags/summary ───────────────────────────────────────────────

describe("GET /v1/stale-flags/summary", () => {
  it("returns zero counts and null oldestFlagAt when no flags exist", async () => {
    const res = await app.request("/v1/stale-flags/summary", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: {
      byObjectType: { node: number; edge: number };
      bySeverity: { ERROR: number; WARNING: number; INFO: number };
      oldestFlagAt: string | null;
    }};
    expect(data.byObjectType).toEqual({ node: 0, edge: 0 });
    expect(data.bySeverity).toEqual({ ERROR: 0, WARNING: 0, INFO: 0 });
    expect(data.oldestFlagAt).toBeNull();
  });

  it("returns correct aggregates across object types and severities", async () => {
    const node = await createNode("L3");
    const nodeB = await createNode("L3");
    const edge = await createEdge(node.id, nodeB.id);

    await seedFlag({ objectId: node.id, objectType: "node", severity: "ERROR" });
    await seedFlag({ objectId: node.id, objectType: "node", severity: "WARNING" });
    await seedFlag({ objectId: edge.id, objectType: "edge", severity: "INFO" });

    const res = await app.request("/v1/stale-flags/summary", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: {
      byObjectType: { node: number; edge: number };
      bySeverity: { ERROR: number; WARNING: number; INFO: number };
      oldestFlagAt: string | null;
    }};
    expect(data.byObjectType.node).toBe(2);
    expect(data.byObjectType.edge).toBe(1);
    expect(data.bySeverity.ERROR).toBe(1);
    expect(data.bySeverity.WARNING).toBe(1);
    expect(data.bySeverity.INFO).toBe(1);
    expect(data.oldestFlagAt).not.toBeNull();
    expect(() => new Date(data.oldestFlagAt!).toISOString()).not.toThrow();
  });

  it("oldestFlagAt reflects the earliest raisedAt", async () => {
    const node = await createNode("L3");
    const old = new Date("2025-01-01T00:00:00Z");
    await seedFlag({ objectId: node.id, objectType: "node", severity: "INFO", raisedAt: old });
    await seedFlag({ objectId: node.id, objectType: "node", severity: "INFO", raisedAt: new Date() });

    const res = await app.request("/v1/stale-flags/summary", { headers: h() });
    const { data } = await res.json() as { data: { oldestFlagAt: string | null } };
    expect(new Date(data.oldestFlagAt!).getFullYear()).toBe(2025);
  });

  it("is tenant-scoped", async () => {
    const node = await createNode("L3");
    await seedFlag({ objectId: node.id, objectType: "node", severity: "ERROR" });

    const otherTid = randomUUID();
    try {
      await createTestTenant(sql, otherTid);
      const res = await app.request("/v1/stale-flags/summary", {
        headers: { "content-type": "application/json", "x-tenant-id": otherTid },
      });
      expect(res.status).toBe(200);
      const { data } = await res.json() as { data: {
        byObjectType: { node: number; edge: number };
        bySeverity: { ERROR: number; WARNING: number; INFO: number };
        oldestFlagAt: null;
      }};
      expect(data.byObjectType).toEqual({ node: 0, edge: 0 });
      expect(data.bySeverity).toEqual({ ERROR: 0, WARNING: 0, INFO: 0 });
      expect(data.oldestFlagAt).toBeNull();
    } finally {
      await cleanTenant(sql, otherTid);
    }
  });
});

// ── GET /v1/tenant/usage — staleFlagCount ─────────────────────────────────────

describe("GET /v1/tenant/usage — staleFlagCount", () => {
  it("includes staleFlagCount: 0 when no flags", async () => {
    const res = await app.request("/v1/tenant/usage", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: { staleFlagCount: number } };
    expect(typeof data.staleFlagCount).toBe("number");
    expect(data.staleFlagCount).toBe(0);
  });

  it("staleFlagCount reflects seeded flags for the tenant", async () => {
    const node = await createNode("L3");
    await seedFlag({ objectId: node.id, objectType: "node", severity: "INFO" });
    await seedFlag({ objectId: node.id, objectType: "node", severity: "ERROR" });

    // Bypass cache by using a fresh tenant ID approach — or just verify the field is present.
    // Usage has a 60s TTL cache; direct SQL insert bypasses the mutation path so the count
    // may be cached at 0 from a prior call. We check the field exists and is a number.
    const res = await app.request("/v1/tenant/usage", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: { staleFlagCount: number } };
    expect(typeof data.staleFlagCount).toBe("number");
    // Fresh tenant has no prior cache entry; should reflect the 2 seeded flags.
    expect(data.staleFlagCount).toBe(2);
  });
});
