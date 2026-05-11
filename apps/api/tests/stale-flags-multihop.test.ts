// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

// Integration tests for LSDS-848: multi-hop stale-flag propagation chain coverage.
//
// Gap analysis: propagateNodeChange() in apps/api/src/stale-flags.ts is single-hop.
// It calls propagateChange() once with the direct neighbors of the mutated node.
// Multi-hop BFS traversal is caller-responsibility per the propagateChange() contract
// (see packages/framework/src/change/propagation.ts) but is not yet implemented in
// the API layer — scenario 2 documents this gap with a negative assertion.
//
// Test scenarios:
//   1. Direct (depth 1): mutate A → B (edge B→A realizes) is marked stale
//   2. Transitive (depth 2+): chain C→B→A; mutate A → B flagged, C NOT flagged (gap)
//   3. Clean graph: no mutations → GET /v1/stale-flags returns empty list
//   4. Stale flag clearing: mutate flagged node B → B's flags removed

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant, createTestTenant } from "./test-helpers";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

beforeEach(async () => { tid = randomUUID(); await createTestTenant(sql, tid); });
afterEach(async () => { await cleanTenant(sql, tid); });

type NodeData = { id: string; type: string; layer: string; name: string };

async function createNode(layer = "L3", name = randomUUID()): Promise<NodeData> {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ type: "Service", layer, name }),
  });
  expect(res.status).toBe(201);
  return (await res.json() as { data: NodeData }).data;
}

async function createEdge(sourceId: string, targetId: string, type = "realizes"): Promise<{ id: string }> {
  const res = await app.request("/v1/edges", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ sourceId, targetId, type, layer: "L3" }),
  });
  expect(res.status).toBe(201);
  return (await res.json() as { data: { id: string } }).data;
}

// PUT-upsert on an existing node triggers propagateNodeChange() in the API handler.
async function mutateNode(node: NodeData, version = "0.2.0"): Promise<void> {
  const res = await app.request("/v1/nodes", {
    method: "PUT",
    headers: h(),
    body: JSON.stringify({ type: node.type, layer: node.layer, name: node.name, version }),
  });
  expect(res.status).toBe(200);
}

type StaleEntry = { objectId: string; objectType: string; severity: string; depth: number };

async function listStaleFlags(): Promise<{ items: StaleEntry[]; totalCount: number }> {
  const res = await app.request("/v1/stale-flags", { headers: h() });
  expect(res.status).toBe(200);
  return res.json() as Promise<{ items: StaleEntry[]; totalCount: number; nextCursor: string | null }>;
}

// ── Scenario 1: Direct (depth 1) ─────────────────────────────────────────────

describe("stale propagation — direct (depth 1)", () => {
  it("mutating node A flags its direct upstream neighbor B at depth=1 with INFO severity", async () => {
    const nodeA = await createNode("L3", "direct-a");
    const nodeB = await createNode("L3", "direct-b");
    // Edge B→A: source=B, target=A. From A's perspective B is direction=UP → flagged by DIRECT_PARENTS.
    await createEdge(nodeB.id, nodeA.id, "realizes");

    await mutateNode(nodeA); // METADATA_CHANGED → PATCH → INFO / DIRECT_PARENTS

    const { items, totalCount } = await listStaleFlags();
    expect(totalCount).toBeGreaterThan(0);

    const bFlag = items.find((f) => f.objectId === nodeB.id);
    expect(bFlag).toBeDefined();
    expect(bFlag!.depth).toBe(1);
    expect(bFlag!.severity).toBe("INFO");
    expect(bFlag!.objectType).toBe("node");
  });

  it("mutating node A does NOT create a stale flag on A itself", async () => {
    const nodeA = await createNode("L3", "direct-a2");
    const nodeB = await createNode("L3", "direct-b2");
    await createEdge(nodeB.id, nodeA.id, "realizes");

    await mutateNode(nodeA);

    const { items } = await listStaleFlags();
    // clearOwnStaleFlags() removes A's own flags before inserting neighbor flags
    const aFlag = items.find((f) => f.objectId === nodeA.id);
    expect(aFlag).toBeUndefined();
  });
});

// ── Scenario 2: Transitive (depth 2+) — gap documented ───────────────────────

describe("stale propagation — transitive chain (depth 2)", () => {
  it("3-node chain C→B→A: B is flagged at depth=1 when A is mutated", async () => {
    const nodeA = await createNode("L3", "chain-a");
    const nodeB = await createNode("L3", "chain-b");
    const nodeC = await createNode("L3", "chain-c");
    await createEdge(nodeB.id, nodeA.id, "realizes"); // B→A
    await createEdge(nodeC.id, nodeB.id, "realizes"); // C→B

    await mutateNode(nodeA);

    const { items } = await listStaleFlags();
    const bFlag = items.find((f) => f.objectId === nodeB.id);
    expect(bFlag).toBeDefined();
    expect(bFlag!.depth).toBe(1);
  });

  // Gap: propagateNodeChange() calls propagateChange() once with A's direct edges.
  // It does not recurse into B's neighbors, so C at depth=2 is unreachable.
  // Multi-hop BFS is declared caller-responsibility in propagation.ts but the API
  // layer does not yet implement it. C remaining un-flagged is the current behavior.
  it("3-node chain C→B→A: C is NOT flagged at depth=2 — single-hop propagation gap", async () => {
    const nodeA = await createNode("L3", "gap-a");
    const nodeB = await createNode("L3", "gap-b");
    const nodeC = await createNode("L3", "gap-c");
    await createEdge(nodeB.id, nodeA.id, "realizes"); // B→A
    await createEdge(nodeC.id, nodeB.id, "realizes"); // C→B

    await mutateNode(nodeA);

    const { items } = await listStaleFlags();
    const cFlag = items.find((f) => f.objectId === nodeC.id);
    expect(cFlag).toBeUndefined();
  });
});

// ── Scenario 3: Clean graph (no mutations) ────────────────────────────────────

describe("stale flags — clean graph (no mutations)", () => {
  it("GET /v1/stale-flags returns empty list when no mutations have occurred", async () => {
    const nodeA = await createNode("L3", "clean-a");
    const nodeB = await createNode("L3", "clean-b");
    await createEdge(nodeB.id, nodeA.id, "realizes");
    // No PUT/PATCH mutations — just creates

    const { items, totalCount } = await listStaleFlags();
    expect(items).toEqual([]);
    expect(totalCount).toBe(0);
  });

  it("POST node creation does not generate stale flags on connected nodes", async () => {
    // B is created after A; the edge exists but no mutation of A has occurred.
    const nodeA = await createNode("L3", "post-a");
    const nodeB = await createNode("L3", "post-b");
    await createEdge(nodeB.id, nodeA.id, "realizes");

    const { items } = await listStaleFlags();
    expect(items.find((f) => f.objectId === nodeB.id)).toBeUndefined();
  });
});

// ── Scenario 4: Stale flag clearing ──────────────────────────────────────────

describe("stale flags — clearing on re-validation", () => {
  it("mutating the stale node clears its own flags from GET /v1/stale-flags", async () => {
    const nodeA = await createNode("L3", "clear-a");
    const nodeB = await createNode("L3", "clear-b");
    await createEdge(nodeB.id, nodeA.id, "realizes");

    await mutateNode(nodeA);

    // Verify B is stale before re-validation
    const before = await listStaleFlags();
    expect(before.items.find((f) => f.objectId === nodeB.id)).toBeDefined();

    // Re-validate B by mutating it — propagateNodeChange clears B's own stale flags
    await mutateNode(nodeB, "0.3.0");

    // B's stale flags should be gone
    const after = await listStaleFlags();
    expect(after.items.find((f) => f.objectId === nodeB.id)).toBeUndefined();
  });

  it("clearing B's flags does not affect stale flags on unrelated sibling node C", async () => {
    const nodeA = await createNode("L3", "sibling-a");
    const nodeB = await createNode("L3", "sibling-b");
    const nodeC = await createNode("L3", "sibling-c");
    // Both B and C are direct upstream neighbors of A via separate edges
    await createEdge(nodeB.id, nodeA.id, "realizes");
    await createEdge(nodeC.id, nodeA.id, "realizes");

    await mutateNode(nodeA); // flags both B and C

    const before = await listStaleFlags();
    expect(before.items.find((f) => f.objectId === nodeB.id)).toBeDefined();
    expect(before.items.find((f) => f.objectId === nodeC.id)).toBeDefined();

    await mutateNode(nodeB, "0.3.0"); // clears B's flags only

    const after = await listStaleFlags();
    expect(after.items.find((f) => f.objectId === nodeB.id)).toBeUndefined(); // B cleared
    expect(after.items.find((f) => f.objectId === nodeC.id)).toBeDefined();   // C still stale
  });
});
