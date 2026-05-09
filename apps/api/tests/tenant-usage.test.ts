// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant } from "./test-helpers";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

async function createNode(type: string, layer = "L4", name = randomUUID()) {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ type, layer, name }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).data;
}

async function createEdge(sourceId: string, targetId: string, type = "depends-on") {
  const res = await app.request("/v1/edges", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ sourceId, targetId, type, layer: "L4" }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).data;
}

beforeEach(() => { tid = randomUUID(); });
afterEach(async () => {
  await cleanTenant(sql, tid);
  await sql`DELETE FROM tenants WHERE id = ${tid}`;
});

// ── GET /v1/tenant/usage ───────────────────────────────────────────────────────

describe("GET /v1/tenant/usage", () => {
  it("returns 200 with correct response shape on empty tenant", async () => {
    const res = await app.request("/v1/tenant/usage", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(typeof data.nodes.total).toBe("number");
    expect(typeof data.nodes.byType).toBe("object");
    expect(typeof data.edges.total).toBe("number");
    expect(typeof data.edges.byType).toBe("object");
    expect(typeof data.violations.total).toBe("number");
    expect(typeof data.violations.open).toBe("number");
    expect(typeof data.apiKeys.active).toBe("number");
    expect(typeof data.apiKeys.expired).toBe("number");
    expect(typeof data.snapshots.count).toBe("number");
    expect(data.snapshots.oldestAt).toBeNull();
    expect(data.snapshots.newestAt).toBeNull();
    expect(typeof data.computedAt).toBe("string");
  });

  it("returns zero counts for an empty tenant", async () => {
    const res = await app.request("/v1/tenant/usage", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(data.nodes.total).toBe(0);
    expect(data.nodes.byType).toEqual({});
    expect(data.edges.total).toBe(0);
    expect(data.edges.byType).toEqual({});
    expect(data.violations.total).toBe(0);
    expect(data.violations.open).toBe(0);
    expect(data.apiKeys.active).toBe(0);
    expect(data.apiKeys.expired).toBe(0);
    expect(data.snapshots.count).toBe(0);
  });

  it("reflects actual node counts and byType breakdown", async () => {
    await createNode("Service", "L4");
    await createNode("Service", "L4");
    await createNode("Database", "L3");

    const res = await app.request("/v1/tenant/usage", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(data.nodes.total).toBe(3);
    expect(data.nodes.byType.Service).toBe(2);
    expect(data.nodes.byType.Database).toBe(1);
  });

  it("reflects actual edge counts and byType breakdown", async () => {
    // All nodes at L4 so SOURCE_LTE_TARGET is satisfied for all edge types
    const svc = await createNode("Service", "L4");
    const db = await createNode("Database", "L4");
    const cache = await createNode("Cache", "L4");

    await createEdge(svc.id, db.id, "contains");
    await createEdge(svc.id, cache.id, "contains");
    await createEdge(db.id, cache.id, "uses");

    const res = await app.request("/v1/tenant/usage", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(data.edges.total).toBe(3);
    expect(data.edges.byType["contains"]).toBe(2);
    expect(data.edges.byType["uses"]).toBe(1);
  });

  it("reflects violations total and open counts", async () => {
    const node = await createNode("Service", "L4");

    await sql`
      INSERT INTO violations (id, tenant_id, node_id, rule_key, severity, message, resolved)
      VALUES
        (${randomUUID()}, ${tid}, ${node.id}, 'rule.a', 'ERROR', 'open violation', false),
        (${randomUUID()}, ${tid}, ${node.id}, 'rule.b', 'WARN', 'resolved violation', true)
    `;

    const res = await app.request("/v1/tenant/usage", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(data.violations.total).toBe(2);
    expect(data.violations.open).toBe(1);
  });

  it("reflects api key active and expired counts", async () => {
    // active key
    await sql`
      INSERT INTO api_keys (id, tenant_id, name, key_hash, key_prefix, expires_at)
      VALUES (${randomUUID()}, ${tid}, 'active-key', 'hash1', 'lsds_', NULL)
    `;
    // expired key (past expires_at)
    await sql`
      INSERT INTO api_keys (id, tenant_id, name, key_hash, key_prefix, expires_at)
      VALUES (${randomUUID()}, ${tid}, 'expired-key', 'hash2', 'lsds_', now() - interval '1 day')
    `;
    // revoked key
    await sql`
      INSERT INTO api_keys (id, tenant_id, name, key_hash, key_prefix, revoked_at)
      VALUES (${randomUUID()}, ${tid}, 'revoked-key', 'hash3', 'lsds_', now())
    `;

    const res = await app.request("/v1/tenant/usage", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(data.apiKeys.active).toBe(1);
    expect(data.apiKeys.expired).toBe(2);
  });

  it("reflects snapshot count and oldestAt/newestAt", async () => {
    const node = await createNode("Service", "L4");

    // Create two snapshots via API
    const snap1 = await app.request("/v1/snapshots", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ label: "snap-1", nodeIds: [node.id], edgeIds: [] }),
    });
    expect(snap1.status).toBe(201);
    const snap2 = await app.request("/v1/snapshots", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ label: "snap-2", nodeIds: [node.id], edgeIds: [] }),
    });
    expect(snap2.status).toBe(201);

    const res = await app.request("/v1/tenant/usage", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(data.snapshots.count).toBe(2);
    expect(data.snapshots.oldestAt).not.toBeNull();
    expect(data.snapshots.newestAt).not.toBeNull();
    // newestAt >= oldestAt
    expect(new Date(data.snapshots.newestAt).getTime()).toBeGreaterThanOrEqual(
      new Date(data.snapshots.oldestAt).getTime()
    );
  });

  it("is tenant-scoped — cannot see another tenant's data", async () => {
    await createNode("Service", "L4");
    await createNode("Database", "L3");

    const otherTid = randomUUID();
    try {
      const res = await app.request("/v1/tenant/usage", {
        headers: { "content-type": "application/json", "x-tenant-id": otherTid },
      });
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data.nodes.total).toBe(0);
      expect(data.edges.total).toBe(0);
    } finally {
      await cleanTenant(sql, otherTid);
    }
  });

  it("returns 400 when x-tenant-id header is absent", async () => {
    const res = await app.request("/v1/tenant/usage");
    expect(res.status).toBe(400);
  });

  it("computedAt is a valid ISO 8601 timestamp", async () => {
    const res = await app.request("/v1/tenant/usage", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(() => new Date(data.computedAt).toISOString()).not.toThrow();
    expect(data.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
