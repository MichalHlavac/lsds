// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant } from "./test-helpers";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

beforeEach(() => { tid = randomUUID(); });
afterEach(async () => {
  await cleanTenant(sql, tid);
  await sql`DELETE FROM tenants WHERE id = ${tid}`;
});

// ── GET /v1/tenant ────────────────────────────────────────────────────────────

describe("GET /v1/tenant", () => {
  it("returns 200 with tenant metadata and stats on first call (auto-provisions)", async () => {
    const res = await app.request("/v1/tenant", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(typeof data.id).toBe("string");
    expect(data.id).toBe(tid);
    expect(typeof data.name).toBe("string");
    expect(typeof data.plan).toBe("string");
    expect(typeof data.retentionDays).toBe("number");
    expect(data.createdAt).toBeDefined();
    expect(data.updatedAt).toBeDefined();
    expect(typeof data.stats).toBe("object");
    expect(typeof data.stats.nodeCount).toBe("number");
    expect(typeof data.stats.edgeCount).toBe("number");
    expect(typeof data.stats.openViolationCount).toBe("number");
  });

  it("is idempotent — second GET returns the same tenant row (no duplicate)", async () => {
    const first = await app.request("/v1/tenant", { headers: h() });
    const { data: d1 } = await first.json();

    const second = await app.request("/v1/tenant", { headers: h() });
    expect(second.status).toBe(200);
    const { data: d2 } = await second.json();

    expect(d1.id).toBe(d2.id);
    expect(d1.createdAt).toBe(d2.createdAt);

    // Only one row exists
    const rows = await sql<{ count: string }[]>`SELECT count(*)::int AS count FROM tenants WHERE id = ${tid}`;
    expect(rows[0]?.count).toBe(1);
  });

  it("stats reflect actual node and edge counts for the tenant", async () => {
    // Ensure tenant is provisioned first
    await app.request("/v1/tenant", { headers: h() });

    // Create two nodes
    await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "svc-a" }),
    });
    await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Database", layer: "L3", name: "db-a" }),
    });

    const res = await app.request("/v1/tenant", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.stats.nodeCount).toBe(2);
    expect(data.stats.edgeCount).toBe(0);
    expect(data.stats.openViolationCount).toBe(0);
  });

  it("stats openViolationCount reflects unresolved violations", async () => {
    // Provision tenant + node for violation reference
    await app.request("/v1/tenant", { headers: h() });
    const nodeRes = await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "svc-v" }),
    });
    const { data: node } = await nodeRes.json();

    // Insert a violation directly
    await sql`
      INSERT INTO violations (id, tenant_id, node_id, rule_key, severity, message, resolved)
      VALUES (${randomUUID()}, ${tid}, ${node.id}, 'test.rule', 'WARN', 'test violation', false)
    `;

    const res = await app.request("/v1/tenant", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.stats.openViolationCount).toBe(1);
  });
});

// ── PATCH /v1/tenant ──────────────────────────────────────────────────────────

describe("PATCH /v1/tenant", () => {
  beforeEach(async () => {
    // Provision tenant row before PATCH tests
    await app.request("/v1/tenant", { headers: h() });
  });

  it("updates name only — returns 200 with updated name", async () => {
    const res = await app.request("/v1/tenant", {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ name: "Acme Corp" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.name).toBe("Acme Corp");
    expect(data.id).toBe(tid);
    expect(typeof data.retentionDays).toBe("number");
  });

  it("updates retentionDays only — returns 200 with updated value", async () => {
    const res = await app.request("/v1/tenant", {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ retentionDays: 365 }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.retentionDays).toBe(365);
  });

  it("updates both name and retentionDays — returns 200", async () => {
    const res = await app.request("/v1/tenant", {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ name: "Updated Corp", retentionDays: 180 }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.name).toBe("Updated Corp");
    expect(data.retentionDays).toBe(180);
  });

  it("returns 400 with 'no fields to update' for empty body", async () => {
    const res = await app.request("/v1/tenant", {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("no fields to update");
  });

  it("returns 400 for retentionDays=0 (below min 1)", async () => {
    const res = await app.request("/v1/tenant", {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ retentionDays: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for retentionDays=-1 (negative)", async () => {
    const res = await app.request("/v1/tenant", {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ retentionDays: -1 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for retentionDays=36501 (above max 36500)", async () => {
    const res = await app.request("/v1/tenant", {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ retentionDays: 36501 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-integer retentionDays", async () => {
    const res = await app.request("/v1/tenant", {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ retentionDays: 1.5 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for unknown fields (strict schema)", async () => {
    const res = await app.request("/v1/tenant", {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ plan: "enterprise" }),
    });
    expect(res.status).toBe(400);
  });
});
