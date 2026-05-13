// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant } from "./test-helpers";
import type { NodeRow } from "../src/db/types";
import type { TraversalResult } from "../src/db/traversal-adapter";

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

async function createEdge(sourceId: string, targetId: string, traversalWeight?: number) {
  const res = await app.request("/v1/edges", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ sourceId, targetId, type: "contains", layer: "L4", ...(traversalWeight !== undefined && { traversalWeight }) }),
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
    const nodeIds = data.nodes.map((n: NodeRow) => n.id);
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

// ── traversalWeight / cost ordering ──────────────────────────────────────────

describe("traversalWeight cost ordering", () => {
  it("traversal result includes totalCost for each reachable node", async () => {
    const root = await createNode("L4", "root");
    const child = await createNode("L4", "child");
    await createEdge(root.id, child.id, 2.5);

    const res = await app.request(`/v1/nodes/${root.id}/traverse`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ depth: 1, direction: "outbound" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const childEntry = data.traversal.find((r: TraversalResult) => r.nodeId === child.id);
    expect(childEntry).toBeDefined();
    expect(childEntry.totalCost).toBeCloseTo(2.5);
  });

  it("root node has totalCost 0", async () => {
    const root = await createNode("L4", "root");
    const res = await app.request(`/v1/nodes/${root.id}/traverse`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ depth: 1, direction: "outbound" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const rootEntry = data.traversal.find((r: TraversalResult) => r.nodeId === root.id);
    expect(rootEntry).toBeDefined();
    expect(rootEntry.totalCost).toBe(0);
  });

  it("default weight (1.0) gives totalCost equal to depth", async () => {
    // root -> A -> B, all default weight
    const root = await createNode("L4", "root");
    const a = await createNode("L4", "a");
    const b = await createNode("L4", "b");
    await createEdge(root.id, a.id);
    await createEdge(a.id, b.id);

    const res = await app.request(`/v1/nodes/${root.id}/traverse`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ depth: 2, direction: "outbound" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const aEntry = data.traversal.find((r: TraversalResult) => r.nodeId === a.id);
    const bEntry = data.traversal.find((r: TraversalResult) => r.nodeId === b.id);
    expect(aEntry.totalCost).toBeCloseTo(1.0);
    expect(bEntry.totalCost).toBeCloseTo(2.0);
  });

  it("cheapest path wins when two routes reach the same node", async () => {
    // Topology: root -> cheap -> target (weight 0.1 + 0.1)
    //           root -> expensive -> target (weight 5.0 + 5.0)
    // Both paths reach `target` in 2 hops; cheapest-cost path should win.
    const root = await createNode("L4", "root");
    const cheap = await createNode("L4", "cheap");
    const expensive = await createNode("L4", "expensive");
    const target = await createNode("L4", "target");

    await createEdge(root.id, cheap.id, 0.1);
    await createEdge(cheap.id, target.id, 0.1);
    await createEdge(root.id, expensive.id, 5.0);
    await createEdge(expensive.id, target.id, 5.0);

    const res = await app.request(`/v1/nodes/${root.id}/traverse`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ depth: 2, direction: "outbound" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const targetEntry = data.traversal.find((r: TraversalResult) => r.nodeId === target.id);
    expect(targetEntry).toBeDefined();
    // Should have kept the cheap path (0.1 + 0.1 = 0.2), not the expensive one (10.0)
    expect(targetEntry.totalCost).toBeCloseTo(0.2);
  });
});

// ── Cross-tenant isolation (traversal CTE) ───────────────────────────────────

describe("cross-tenant isolation in traversal", () => {
  let tidB: string;

  beforeEach(() => { tidB = randomUUID(); });
  afterEach(async () => { await cleanTenant(sql, tidB); });

  it("traversal from tenant A does not expose nodes owned by tenant B", async () => {
    // Tenant A: root -> child
    const root = await createNode("L4", "root-a");
    const childA = await createNode("L4", "child-a");
    const res1 = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: root.id, targetId: childA.id, type: "contains", layer: "L4" }),
    });
    expect(res1.status).toBe(201);

    // Tenant B: insert a node and edge pointing FROM the same root.id (cross-tenant edge)
    // This simulates data corruption or deliberate injection across tenants.
    const nodeB = await app.request("/v1/nodes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": tidB },
      body: JSON.stringify({ type: "Service", layer: "L4", name: "secret-b" }),
    });
    const nodeBData = (await nodeB.json()).data;
    // Directly insert a cross-tenant edge (bypassing API validation) to prove the DB filter holds
    await sql`
      INSERT INTO edges (id, tenant_id, source_id, target_id, type, layer, traversal_weight, created_at, updated_at)
      VALUES (gen_random_uuid(), ${tidB}, ${root.id}::uuid, ${nodeBData.id}::uuid, 'contains', 'L4', 1.0, now(), now())
    `;

    const res = await app.request(`/v1/nodes/${root.id}/traverse`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ depth: 3, direction: "outbound" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const nodeIds = data.nodes.map((n: NodeRow) => n.id);
    expect(nodeIds).not.toContain(nodeBData.id);
    expect(nodeIds).toContain(childA.id);
  });

  it("traversal from tenant A with edgeTypes filter does not expose nodes owned by tenant B", async () => {
    const root = await createNode("L4", "root-a2");
    const nodeB = await app.request("/v1/nodes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": tidB },
      body: JSON.stringify({ type: "Service", layer: "L4", name: "secret-b2" }),
    });
    const nodeBData = (await nodeB.json()).data;
    await sql`
      INSERT INTO edges (id, tenant_id, source_id, target_id, type, layer, traversal_weight, created_at, updated_at)
      VALUES (gen_random_uuid(), ${tidB}, ${root.id}::uuid, ${nodeBData.id}::uuid, 'contains', 'L4', 1.0, now(), now())
    `;

    const res = await app.request(`/v1/nodes/${root.id}/traverse`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ depth: 3, direction: "outbound", edgeTypes: ["contains"] }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const nodeIds = data.nodes.map((n: NodeRow) => n.id);
    expect(nodeIds).not.toContain(nodeBData.id);
  });

  it("inbound traversal from tenant A does not expose nodes owned by tenant B", async () => {
    const root = await createNode("L4", "root-a3");
    const nodeB = await app.request("/v1/nodes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": tidB },
      body: JSON.stringify({ type: "Service", layer: "L4", name: "secret-b3" }),
    });
    const nodeBData = (await nodeB.json()).data;
    // Cross-tenant edge pointing INTO root from tenant B's node
    await sql`
      INSERT INTO edges (id, tenant_id, source_id, target_id, type, layer, traversal_weight, created_at, updated_at)
      VALUES (gen_random_uuid(), ${tidB}, ${nodeBData.id}::uuid, ${root.id}::uuid, 'contains', 'L4', 1.0, now(), now())
    `;

    const res = await app.request(`/v1/nodes/${root.id}/traverse`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ depth: 3, direction: "inbound" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const nodeIds = data.nodes.map((n: NodeRow) => n.id);
    expect(nodeIds).not.toContain(nodeBData.id);
  });

  it("inbound traversal from tenant A with edgeTypes filter does not expose nodes owned by tenant B", async () => {
    const root = await createNode("L4", "root-a4");
    const nodeB = await app.request("/v1/nodes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": tidB },
      body: JSON.stringify({ type: "Service", layer: "L4", name: "secret-b4" }),
    });
    const nodeBData = (await nodeB.json()).data;
    // Cross-tenant edge pointing INTO root from tenant B's node, type 'contains'
    await sql`
      INSERT INTO edges (id, tenant_id, source_id, target_id, type, layer, traversal_weight, created_at, updated_at)
      VALUES (gen_random_uuid(), ${tidB}, ${nodeBData.id}::uuid, ${root.id}::uuid, 'contains', 'L4', 1.0, now(), now())
    `;

    const res = await app.request(`/v1/nodes/${root.id}/traverse`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ depth: 3, direction: "inbound", edgeTypes: ["contains"] }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const nodeIds = data.nodes.map((n: NodeRow) => n.id);
    expect(nodeIds).not.toContain(nodeBData.id);
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
    expect(data.every((n: NodeRow) => n.type === "Service")).toBe(true);
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
    expect(data.some((n: NodeRow) => n.name === "payment-service")).toBe(true);
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
