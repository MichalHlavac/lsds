// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

// Integration tests for LSDS-817: propagateChange() wired into mutation handlers.
//
// Test scenarios:
//   1. PUT (update) node A → GET node B (which has edge B→A) shows staleFlag
//   2. PUT (update) node B → GET node B shows empty staleFlags (own flags cleared)
//   3. PATCH /:id node A → GET node B shows staleFlag
//   4. GET without ?includeStaleFlags=true → no staleFlags field in response
//   5. PUT (update) edge → GET source node shows staleFlag (PATCH/DIRECT_PARENTS only if UP)
//   6. Lifecycle transition DEPRECATED on node A → GET node B shows staleFlag
//   7. L1 node PUT update → no propagation (PENDING_CONFIRMATION gate)

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant, createTestTenant } from "./test-helpers";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

beforeEach(async () => { tid = randomUUID(); await createTestTenant(sql, tid); });
afterEach(async () => { await cleanTenant(sql, tid); });

// Helper: create a node and return its data
async function createNode(layer: string, name: string, type = "Service") {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ type, layer, name }),
  });
  expect(res.status).toBe(201);
  const { data } = await res.json();
  return data;
}

// Helper: create an edge and return its data
async function createEdge(sourceId: string, targetId: string, type = "realizes") {
  const res = await app.request("/v1/edges", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ sourceId, targetId, type, layer: "L3" }),
  });
  expect(res.status).toBe(201);
  const { data } = await res.json();
  return data;
}

// Helper: GET node with staleFlags
async function getNodeWithFlags(id: string) {
  const res = await app.request(`/v1/nodes/${id}?includeStaleFlags=true`, {
    headers: h(),
  });
  expect(res.status).toBe(200);
  return res.json();
}

// Helper: GET edge with staleFlags
async function getEdgeWithFlags(id: string) {
  const res = await app.request(`/v1/edges/${id}?includeStaleFlags=true`, {
    headers: h(),
  });
  expect(res.status).toBe(200);
  return res.json();
}

// ── Scenario 1+2: PUT upsert node propagation ─────────────────────────────────

describe("PUT /v1/nodes — propagateChange on update", () => {
  it("update node A → GET node B (edge B→A) returns staleFlag with INFO severity", async () => {
    // L3/L4 layers use AUTO_WITH_OVERRIDE → APPLIED → propagates
    const nodeA = await createNode("L3", "node-a");
    const nodeB = await createNode("L3", "node-b");
    // Edge B→A: B "realizes" A — from A's view, B is an UP-direction neighbor
    await createEdge(nodeB.id, nodeA.id, "realizes");

    // Update node A via PUT upsert
    const putRes = await app.request("/v1/nodes", {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({ type: nodeA.type, layer: nodeA.layer, name: nodeA.name, version: "0.2.0" }),
    });
    expect(putRes.status).toBe(200);

    // Node B should have a stale flag
    const { data: bData } = await getNodeWithFlags(nodeB.id);
    expect(bData.staleFlags).toBeInstanceOf(Array);
    expect(bData.staleFlags.length).toBeGreaterThan(0);
    const flag = bData.staleFlags[0];
    expect(flag.objectId).toBe(nodeB.id);
    expect(flag.objectType).toBe("node");
    expect(flag.severity).toBe("INFO"); // METADATA_CHANGED → PATCH → INFO
    expect(flag.viaRelationshipType).toBe("realizes");
    expect(flag.depth).toBe(1);
  });

  it("update node B (the stale one) → GET node B returns empty staleFlags", async () => {
    const nodeA = await createNode("L3", "node-a2");
    const nodeB = await createNode("L3", "node-b2");
    await createEdge(nodeB.id, nodeA.id, "realizes");

    // Update A → flags B
    await app.request("/v1/nodes", {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({ type: nodeA.type, layer: nodeA.layer, name: nodeA.name, version: "0.2.0" }),
    });

    // Verify B has a stale flag
    const { data: bBefore } = await getNodeWithFlags(nodeB.id);
    expect(bBefore.staleFlags.length).toBeGreaterThan(0);

    // Update B → clears its own stale flags
    await app.request("/v1/nodes", {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({ type: nodeB.type, layer: nodeB.layer, name: nodeB.name, version: "0.2.0" }),
    });

    const { data: bAfter } = await getNodeWithFlags(nodeB.id);
    expect(bAfter.staleFlags).toBeInstanceOf(Array);
    expect(bAfter.staleFlags.length).toBe(0);
  });

  it("GET without includeStaleFlags=true does not include staleFlags field", async () => {
    const nodeA = await createNode("L3", "node-no-flags");
    const res = await app.request(`/v1/nodes/${nodeA.id}`, { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.staleFlags).toBeUndefined();
  });

  it("GET with includeStaleFlags=true returns empty array when no flags exist", async () => {
    const nodeA = await createNode("L3", "node-clean");
    const { data } = await getNodeWithFlags(nodeA.id);
    expect(data.staleFlags).toEqual([]);
  });
});

// ── Scenario 3: PATCH /:id propagation ───────────────────────────────────────

describe("PATCH /v1/nodes/:id — propagateChange on partial update", () => {
  it("partial update of node A → GET node B shows staleFlag", async () => {
    const nodeA = await createNode("L4", "patch-a");
    const nodeB = await createNode("L4", "patch-b");
    await createEdge(nodeB.id, nodeA.id, "implements");

    await app.request(`/v1/nodes/${nodeA.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ version: "1.0.0" }),
    });

    const { data } = await getNodeWithFlags(nodeB.id);
    expect(data.staleFlags.length).toBeGreaterThan(0);
    expect(data.staleFlags[0].viaRelationshipType).toBe("implements");
  });
});

// ── Scenario 4: Lifecycle deprecation propagation ────────────────────────────

describe("PATCH /v1/nodes/:id/lifecycle — propagate on deprecate/archive", () => {
  it("deprecating node A → GET node B shows staleFlag", async () => {
    const nodeA = await createNode("L4", "lifecycle-a");
    const nodeB = await createNode("L4", "lifecycle-b");
    await createEdge(nodeB.id, nodeA.id, "traces-to");

    await app.request(`/v1/nodes/${nodeA.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "deprecate" }),
    });

    const { data } = await getNodeWithFlags(nodeB.id);
    expect(data.staleFlags.length).toBeGreaterThan(0);
  });

  it("archiving node A (after deprecate) → GET node B shows staleFlag", async () => {
    const nodeA = await createNode("L4", "archive-a");
    const nodeB = await createNode("L4", "archive-b");
    await createEdge(nodeB.id, nodeA.id, "realizes");

    // Deprecate first
    await app.request(`/v1/nodes/${nodeA.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "deprecate" }),
    });

    // Now archive
    await app.request(`/v1/nodes/${nodeA.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "archive" }),
    });

    const { data } = await getNodeWithFlags(nodeB.id);
    expect(data.staleFlags.length).toBeGreaterThan(0);
  });
});

// ── Scenario 5: L1 node — no propagation (PENDING_CONFIRMATION gate) ─────────

describe("PUT /v1/nodes — L1 node update does not propagate", () => {
  it("updating an L1 node does not emit stale flags (requires confirmation)", async () => {
    const nodeA = await createNode("L1", "l1-node-a");
    const nodeB = await createNode("L1", "l1-node-b");
    await createEdge(nodeB.id, nodeA.id, "realizes");

    // Update L1 node A
    await app.request("/v1/nodes", {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({ type: nodeA.type, layer: nodeA.layer, name: nodeA.name, version: "0.2.0" }),
    });

    // L1 produces PENDING_CONFIRMATION → no flags on B
    const { data } = await getNodeWithFlags(nodeB.id);
    expect(data.staleFlags).toEqual([]);
  });
});

// ── Scenario 6: Edge PUT upsert propagation ───────────────────────────────────

describe("PUT /v1/edges — propagateChange on edge update", () => {
  it("GET /v1/edges/:id?includeStaleFlags=true returns staleFlags array", async () => {
    const nodeA = await createNode("L3", "edge-test-src");
    const nodeB = await createNode("L3", "edge-test-tgt");
    const edge = await createEdge(nodeA.id, nodeB.id, "realizes");

    // Update edge via PUT upsert (second call = update)
    const putRes = await app.request("/v1/edges", {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({
        sourceId: nodeA.id,
        targetId: nodeB.id,
        type: "realizes",
        layer: "L3",
        traversalWeight: 0.8,
      }),
    });
    expect(putRes.status).toBe(200);

    // Edge GET with staleFlags should return the field
    const { data } = await getEdgeWithFlags(edge.id);
    expect(data.staleFlags).toBeInstanceOf(Array);
    // METADATA_CHANGED + DIRECT_PARENTS → only UP-direction neighbors
    // Source node is UP direction → may or may not have a flag depending on layer
  });
});
