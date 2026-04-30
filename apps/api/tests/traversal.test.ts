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

async function createNode(layer: string, name: string) {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ type: "Service", layer, name }),
  });
  return (await res.json()).data;
}

async function createEdge(sourceId: string, targetId: string) {
  const res = await app.request("/v1/edges", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ sourceId, targetId, type: "contains", layer: "L4" }),
  });
  return (await res.json()).data;
}

// ── POST /v1/nodes/:id/traverse ───────────────────────────────────────────────

describe("POST /v1/nodes/:id/traverse", () => {
  it("returns 200 with correct structure for an isolated node", async () => {
    const node = await createNode("L4", "root");
    const res = await app.request(`/v1/nodes/${node.id}/traverse`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ depth: 2, direction: "outbound" }),
    });
    expect(res.status).toBe(200);
    const { data, cached } = await res.json();
    expect(data.root).toBe(node.id);
    expect(data.depth).toBe(2);
    expect(data.direction).toBe("outbound");
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(Array.isArray(data.traversal)).toBe(true);
    expect(cached).toBe(false);
  });

  it("discovers connected nodes at depth 1", async () => {
    const root = await createNode("L4", "root");
    const child = await createNode("L4", "child");
    await createEdge(root.id, child.id);

    const res = await app.request(`/v1/nodes/${root.id}/traverse`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ depth: 1, direction: "outbound" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const nodeIds = data.nodes.map((n: any) => n.id);
    expect(nodeIds).toContain(child.id);
  });

  it("applies TraverseSchema defaults (depth 3, direction both)", async () => {
    const node = await createNode("L4", "defaults-test");
    const res = await app.request(`/v1/nodes/${node.id}/traverse`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.depth).toBe(3);
    expect(data.direction).toBe("both");
  });

  it("returns cached result on repeated identical request", async () => {
    const node = await createNode("L4", "cache-test");
    const body = JSON.stringify({ depth: 1, direction: "outbound" });
    await app.request(`/v1/nodes/${node.id}/traverse`, { method: "POST", headers: h(), body });
    const res2 = await app.request(`/v1/nodes/${node.id}/traverse`, { method: "POST", headers: h(), body });
    expect(res2.status).toBe(200);
    expect((await res2.json()).cached).toBe(true);
  });

  it("returns 400 for depth above 20", async () => {
    const node = await createNode("L4", "x");
    const res = await app.request(`/v1/nodes/${node.id}/traverse`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ depth: 99 }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("validation error");
  });

  it("returns 400 for invalid direction", async () => {
    const node = await createNode("L4", "x");
    const res = await app.request(`/v1/nodes/${node.id}/traverse`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ direction: "sideways" }),
    });
    expect(res.status).toBe(400);
  });
});

// ── POST /v1/query/nodes ──────────────────────────────────────────────────────

describe("POST /v1/query/nodes", () => {
  it("returns 200 with matching nodes for type filter", async () => {
    await createNode("L4", "db-1");
    const res = await app.request("/v1/query/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.every((n: any) => n.type === "Service")).toBe(true);
  });

  it("returns 200 with empty array when no nodes match the filter", async () => {
    const res = await app.request("/v1/query/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "NonExistentType" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);
  });

  it("full-text filter (text param) matches by name substring", async () => {
    await createNode("L4", "payment-service");
    const res = await app.request("/v1/query/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ text: "payment" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.some((n: any) => n.name === "payment-service")).toBe(true);
  });

  it("returns 400 for invalid layer value", async () => {
    const res = await app.request("/v1/query/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ layer: "L99" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("validation error");
  });

  it("returns 400 for limit above 500", async () => {
    const res = await app.request("/v1/query/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ limit: 501 }),
    });
    expect(res.status).toBe(400);
  });
});
