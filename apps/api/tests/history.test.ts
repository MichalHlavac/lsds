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
afterEach(async () => { await cleanTenant(sql, tid); });

// ── node_history helpers ──────────────────────────────────────────────────────

async function createNode(name = "svc") {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ type: "Service", layer: "L4", name }),
  });
  return (await res.json()).data;
}

// ── edge_history helpers ──────────────────────────────────────────────────────

async function createEdge(sourceId: string, targetId: string) {
  const res = await app.request("/v1/edges", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ sourceId, targetId, type: "contains", layer: "L4" }),
  });
  return (await res.json()).data;
}

// ── GET /v1/nodes/:id/history ─────────────────────────────────────────────────

describe("GET /v1/nodes/:id/history", () => {
  it("returns 404 for a nonexistent node", async () => {
    const res = await app.request(`/v1/nodes/${randomUUID()}/history`, { headers: h() });
    expect(res.status).toBe(404);
  });

  it("returns empty history for a freshly created node (no CREATE stretch yet excluded)", async () => {
    const node = await createNode("fresh");
    const res = await app.request(`/v1/nodes/${node.id}/history`, { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.total).toBe("number");
  });

  it("records CREATE op on POST /v1/nodes", async () => {
    const node = await createNode("new-node");
    const res = await app.request(`/v1/nodes/${node.id}/history`, { headers: h() });
    expect(res.status).toBe(200);
    const { data, total } = await res.json();
    expect(total).toBeGreaterThanOrEqual(1);
    const createEntry = data.find((e: any) => e.op === "CREATE");
    expect(createEntry).toBeDefined();
    expect(createEntry.previous).toBeNull();
    expect(createEntry.current).toBeDefined();
    expect(createEntry.changedBy).toBeNull();
  });

  it("records UPDATE op after PATCH /v1/nodes/:id", async () => {
    const node = await createNode("original");

    await app.request(`/v1/nodes/${node.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ name: "updated" }),
    });

    const res = await app.request(`/v1/nodes/${node.id}/history`, { headers: h() });
    expect(res.status).toBe(200);
    const { data, total } = await res.json();
    expect(total).toBeGreaterThanOrEqual(1);
    const updateEntry = data.find((e: any) => e.op === "UPDATE");
    expect(updateEntry).toBeDefined();
    expect(updateEntry.nodeId).toBe(node.id);
    expect(updateEntry.previous).toBeDefined();
    expect(updateEntry.current).toBeDefined();
  });

  it("history entries are returned in reverse chronological order", async () => {
    const node = await createNode("chrono");

    await app.request(`/v1/nodes/${node.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ name: "step-1" }),
    });
    await app.request(`/v1/nodes/${node.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ name: "step-2" }),
    });

    const res = await app.request(`/v1/nodes/${node.id}/history`, { headers: h() });
    const { data } = await res.json();
    const timestamps = data.map((e: any) => new Date(e.changedAt).getTime());
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });

  it("LIFECYCLE_TRANSITION op recorded after PATCH /:id/lifecycle", async () => {
    const node = await createNode("lifecycle-node");

    await app.request(`/v1/nodes/${node.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "deprecate" }),
    });

    const res = await app.request(`/v1/nodes/${node.id}/history`, { headers: h() });
    const { data } = await res.json();
    const lcEntry = data.find((e: any) => e.op === "LIFECYCLE_TRANSITION");
    expect(lcEntry).toBeDefined();
    expect(lcEntry.nodeId).toBe(node.id);
  });

  it("respects limit and offset pagination", async () => {
    const node = await createNode("paginated");
    for (let i = 0; i < 3; i++) {
      await app.request(`/v1/nodes/${node.id}`, {
        method: "PATCH",
        headers: h(),
        body: JSON.stringify({ name: `step-${i}` }),
      });
    }

    const res1 = await app.request(`/v1/nodes/${node.id}/history?limit=2&offset=0`, { headers: h() });
    const { data: page1, total } = await res1.json();
    expect(page1.length).toBe(2);
    expect(total).toBeGreaterThanOrEqual(3);

    const res2 = await app.request(`/v1/nodes/${node.id}/history?limit=2&offset=2`, { headers: h() });
    const { data: page2 } = await res2.json();
    expect(page2.length).toBeGreaterThanOrEqual(1);
    expect(page2[0].id).not.toBe(page1[0].id);
  });

  it("is tenant-isolated: other tenants cannot see history", async () => {
    const node = await createNode("isolated");
    await app.request(`/v1/nodes/${node.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ name: "changed" }),
    });

    const otherTid = randomUUID();
    const res = await app.request(`/v1/nodes/${node.id}/history`, {
      headers: { "content-type": "application/json", "x-tenant-id": otherTid },
    });
    expect(res.status).toBe(404);
  });
});

// ── GET /v1/edges/:id/history ─────────────────────────────────────────────────

describe("GET /v1/edges/:id/history", () => {
  it("returns 404 for a nonexistent edge", async () => {
    const res = await app.request(`/v1/edges/${randomUUID()}/history`, { headers: h() });
    expect(res.status).toBe(404);
  });

  it("records CREATE op on POST /v1/edges", async () => {
    const src = await createNode("src");
    const tgt = await createNode("tgt");
    const edge = await createEdge(src.id, tgt.id);

    const res = await app.request(`/v1/edges/${edge.id}/history`, { headers: h() });
    expect(res.status).toBe(200);
    const { data, total } = await res.json();
    expect(total).toBeGreaterThanOrEqual(1);
    const createEntry = data.find((e: any) => e.op === "CREATE");
    expect(createEntry).toBeDefined();
    expect(createEntry.previous).toBeNull();
    expect(createEntry.edgeId).toBe(edge.id);
  });

  it("records UPDATE op after PATCH /v1/edges/:id", async () => {
    const src = await createNode("src2");
    const tgt = await createNode("tgt2");
    const edge = await createEdge(src.id, tgt.id);

    await app.request(`/v1/edges/${edge.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ traversalWeight: 0.5 }),
    });

    const res = await app.request(`/v1/edges/${edge.id}/history`, { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const updateEntry = data.find((e: any) => e.op === "UPDATE");
    expect(updateEntry).toBeDefined();
    expect(updateEntry.edgeId).toBe(edge.id);
    expect(updateEntry.previous).toBeDefined();
    expect(updateEntry.current).toBeDefined();
  });

  it("records LIFECYCLE_TRANSITION op after PATCH /v1/edges/:id/lifecycle", async () => {
    const src = await createNode("src3");
    const tgt = await createNode("tgt3");
    const edge = await createEdge(src.id, tgt.id);

    await app.request(`/v1/edges/${edge.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "deprecate" }),
    });

    const res = await app.request(`/v1/edges/${edge.id}/history`, { headers: h() });
    const { data } = await res.json();
    const lcEntry = data.find((e: any) => e.op === "LIFECYCLE_TRANSITION");
    expect(lcEntry).toBeDefined();
  });
});
