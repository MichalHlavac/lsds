// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { PostgresTraversalAdapter } from "../src/db/traversal-adapter";
import type { TraversalResult } from "../src/db/traversal-adapter";
import { cleanTenant } from "./test-helpers";

// ── raw SQL helpers (bypass HTTP validation for direct adapter tests) ─────────

async function insertNode(
  tid: string,
  id: string,
  layer = "L4",
  name = "test-node",
  lifecycleStatus = "ACTIVE",
) {
  await sql`
    INSERT INTO nodes (id, tenant_id, type, layer, name, lifecycle_status, attributes)
    VALUES (${id}, ${tid}::uuid, 'Service', ${layer}, ${name}, ${lifecycleStatus}, '{}')
  `;
}

async function insertEdge(
  tid: string,
  sourceId: string,
  targetId: string,
  type = "contains",
  weight = 1.0,
) {
  await sql`
    INSERT INTO edges (id, tenant_id, source_id, target_id, type, layer, traversal_weight)
    VALUES (gen_random_uuid(), ${tid}::uuid, ${sourceId}::uuid, ${targetId}::uuid, ${type}, 'L4', ${weight})
  `;
}

// HTTP helpers — mirror traversal.test.ts pattern for cache-layer tests
let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

async function httpCreateNode(layer: string, name: string) {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ type: "Service", layer, name }),
  });
  return (await res.json()).data;
}

async function httpCreateEdge(sourceId: string, targetId: string) {
  const res = await app.request("/v1/edges", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ sourceId, targetId, type: "contains", layer: "L4" }),
  });
  return (await res.json()).data;
}

// ── PostgresTraversalAdapter — traverseWithDepth ──────────────────────────────

describe("PostgresTraversalAdapter.traverseWithDepth — direct integration", () => {
  let tenantId: string;
  let adapter: PostgresTraversalAdapter;

  beforeEach(() => {
    tenantId = randomUUID();
    adapter = new PostgresTraversalAdapter(sql, tenantId);
  });
  afterEach(() => cleanTenant(sql, tenantId));

  it("isolated node returns only root with depth 0 and totalCost 0", async () => {
    const rootId = randomUUID();
    await insertNode(tenantId, rootId);

    const results = await adapter.traverseWithDepth(rootId, 3, "both");

    expect(results).toHaveLength(1);
    const root = results[0];
    expect(root.nodeId).toBe(rootId);
    expect(root.depth).toBe(0);
    expect(root.totalCost).toBe(0);
    expect(root.path).toEqual([rootId]);
  });

  it("outbound traversal discovers child at depth 1 with correct cost", async () => {
    const rootId = randomUUID();
    const childId = randomUUID();
    await insertNode(tenantId, rootId, "L4", "root");
    await insertNode(tenantId, childId, "L4", "child");
    await insertEdge(tenantId, rootId, childId, "contains", 2.5);

    const results = await adapter.traverseWithDepth(rootId, 2, "outbound");

    const child = results.find((r) => r.nodeId === childId);
    expect(child).toBeDefined();
    expect(child!.depth).toBe(1);
    expect(child!.totalCost).toBeCloseTo(2.5);
    expect(child!.path).toContain(rootId);
    expect(child!.path).toContain(childId);
  });

  it("inbound traversal discovers parent at depth 1", async () => {
    const parentId = randomUUID();
    const rootId = randomUUID();
    await insertNode(tenantId, parentId, "L3", "parent");
    await insertNode(tenantId, rootId, "L4", "root");
    await insertEdge(tenantId, parentId, rootId, "contains");

    const results = await adapter.traverseWithDepth(rootId, 2, "inbound");

    const parent = results.find((r) => r.nodeId === parentId);
    expect(parent).toBeDefined();
    expect(parent!.depth).toBe(1);
  });

  it("bidirectional traversal discovers both parent and child", async () => {
    const parentId = randomUUID();
    const rootId = randomUUID();
    const childId = randomUUID();
    await insertNode(tenantId, parentId, "L3", "parent");
    await insertNode(tenantId, rootId, "L4", "root");
    await insertNode(tenantId, childId, "L5", "child");
    await insertEdge(tenantId, parentId, rootId, "contains");
    await insertEdge(tenantId, rootId, childId, "contains");

    const results = await adapter.traverseWithDepth(rootId, 2, "both");
    const nodeIds = results.map((r) => r.nodeId);

    expect(nodeIds).toContain(parentId);
    expect(nodeIds).toContain(rootId);
    expect(nodeIds).toContain(childId);
  });

  it("edgeTypes filter restricts traversal to named edge types only", async () => {
    const rootId = randomUUID();
    const childContains = randomUUID();
    const childOwns = randomUUID();
    await insertNode(tenantId, rootId, "L4", "root");
    await insertNode(tenantId, childContains, "L4", "child-contains");
    await insertNode(tenantId, childOwns, "L4", "child-owns");
    await insertEdge(tenantId, rootId, childContains, "contains");
    await insertEdge(tenantId, rootId, childOwns, "owns");

    const results = await adapter.traverseWithDepth(rootId, 2, "outbound", ["contains"]);
    const nodeIds = results.map((r) => r.nodeId);

    expect(nodeIds).toContain(childContains);
    expect(nodeIds).not.toContain(childOwns);
  });

  it("cost-aware deduplication — cheapest path wins for the same target", async () => {
    // root -> cheap -> target (0.1 + 0.1 = 0.2)
    // root -> expensive -> target (5.0 + 5.0 = 10.0)
    const rootId = randomUUID();
    const cheapId = randomUUID();
    const expensiveId = randomUUID();
    const targetId = randomUUID();
    await insertNode(tenantId, rootId, "L4", "root");
    await insertNode(tenantId, cheapId, "L4", "cheap");
    await insertNode(tenantId, expensiveId, "L4", "expensive");
    await insertNode(tenantId, targetId, "L4", "target");
    await insertEdge(tenantId, rootId, cheapId, "contains", 0.1);
    await insertEdge(tenantId, cheapId, targetId, "contains", 0.1);
    await insertEdge(tenantId, rootId, expensiveId, "contains", 5.0);
    await insertEdge(tenantId, expensiveId, targetId, "contains", 5.0);

    const results = await adapter.traverseWithDepth(rootId, 3, "outbound");
    const target = results.find((r) => r.nodeId === targetId);

    expect(target).toBeDefined();
    expect(target!.totalCost).toBeCloseTo(0.2);
  });

  it("cycle detection — circular graph terminates and does not duplicate nodes", async () => {
    const aId = randomUUID();
    const bId = randomUUID();
    const cId = randomUUID();
    await insertNode(tenantId, aId, "L4", "a");
    await insertNode(tenantId, bId, "L4", "b");
    await insertNode(tenantId, cId, "L4", "c");
    await insertEdge(tenantId, aId, bId, "contains");
    await insertEdge(tenantId, bId, cId, "contains");
    await insertEdge(tenantId, cId, aId, "contains"); // back-edge — creates cycle

    const results = await adapter.traverseWithDepth(aId, 10, "outbound");
    const nodeIds = results.map((r) => r.nodeId);

    // Each node appears exactly once despite the cycle
    expect(nodeIds.filter((id) => id === aId)).toHaveLength(1);
    expect(nodeIds.filter((id) => id === bId)).toHaveLength(1);
    expect(nodeIds.filter((id) => id === cId)).toHaveLength(1);
  });

  it("depth=0 still returns the root node", async () => {
    const rootId = randomUUID();
    await insertNode(tenantId, rootId);

    const results = await adapter.traverseWithDepth(rootId, 0, "outbound");

    // depth=0 means no recursion, but the CTE seed row includes the root
    expect(results.find((r) => r.nodeId === rootId)).toBeDefined();
  });

  it("non-existent root returns empty array", async () => {
    const missingId = randomUUID();

    const results = await adapter.traverseWithDepth(missingId, 3, "both");

    expect(results).toHaveLength(0);
  });

  it("does not cross tenant boundary via edges owned by another tenant", async () => {
    const tidB = randomUUID();
    const rootId = randomUUID();
    const alienNodeId = randomUUID();
    await insertNode(tenantId, rootId, "L4", "root-a");
    await insertNode(tidB, alienNodeId, "L4", "alien");
    // Edge is scoped to tidB but points FROM rootId (cross-tenant injection)
    await sql`
      INSERT INTO edges (id, tenant_id, source_id, target_id, type, layer, traversal_weight)
      VALUES (gen_random_uuid(), ${tidB}::uuid, ${rootId}::uuid, ${alienNodeId}::uuid, 'contains', 'L4', 1.0)
    `;

    const results = await adapter.traverseWithDepth(rootId, 3, "outbound");
    const nodeIds = results.map((r) => r.nodeId);

    expect(nodeIds).not.toContain(alienNodeId);
    await cleanTenant(sql, tidB);
  });
});

// ── PostgresTraversalAdapter.traverse — DefaultTraversalEngine path ───────────

describe("PostgresTraversalAdapter.traverse — DefaultTraversalEngine", () => {
  let tenantId: string;
  let adapter: PostgresTraversalAdapter;

  beforeEach(() => {
    tenantId = randomUUID();
    adapter = new PostgresTraversalAdapter(sql, tenantId);
  });
  afterEach(() => cleanTenant(sql, tenantId));

  it("returns a ContextPackage with the root node for an ACTIVE node", async () => {
    const rootId = randomUUID();
    await insertNode(tenantId, rootId, "L4", "active-root", "ACTIVE");

    const pkg = await adapter.traverse(rootId);

    expect(pkg.root.id).toBe(rootId);
    expect(pkg.profile).toBe("OPERATIONAL");
  });

  it("includes downward nodes reachable via outgoing edges", async () => {
    const rootId = randomUUID();
    const childId = randomUUID();
    await insertNode(tenantId, rootId, "L4", "root");
    await insertNode(tenantId, childId, "L4", "child");
    // The framework BFS follows outgoing edges with EAGER weight for downward direction
    // 'contains' is classified as downward in the edge catalog
    await insertEdge(tenantId, rootId, childId, "contains");

    const pkg = await adapter.traverse(rootId);

    const allNodeIds = [
      ...pkg.downward.map((n) => n.id),
      ...pkg.upward.map((n) => n.id),
      ...pkg.lateral.map((n) => n.id),
    ];
    expect(allNodeIds).toContain(childId);
  });

  it("throws TraversalError for a non-existent root node", async () => {
    const missingId = randomUUID();

    await expect(adapter.traverse(missingId)).rejects.toThrow(/root node not found/i);
  });

  it("throws TraversalError for an ARCHIVED root under OPERATIONAL profile", async () => {
    const rootId = randomUUID();
    await insertNode(tenantId, rootId, "L4", "archived-root", "ARCHIVED");

    // OPERATIONAL profile excludes ARCHIVED lifecycle (PROFILE_SPEC)
    await expect(adapter.traverse(rootId, { profile: "OPERATIONAL" })).rejects.toThrow(
      /lifecycle.*ARCHIVED.*not visible/i,
    );
  });

  it("returns ContextPackage for an ARCHIVED root under ANALYTICAL profile", async () => {
    const rootId = randomUUID();
    await insertNode(tenantId, rootId, "L4", "archived-root", "ARCHIVED");

    const pkg = await adapter.traverse(rootId, { profile: "ANALYTICAL" });

    expect(pkg.root.id).toBe(rootId);
    expect(pkg.profile).toBe("ANALYTICAL");
  });

  it("includes DEPRECATED root in OPERATIONAL profile", async () => {
    const rootId = randomUUID();
    await insertNode(tenantId, rootId, "L4", "deprecated-root", "DEPRECATED");

    const pkg = await adapter.traverse(rootId, { profile: "OPERATIONAL" });

    expect(pkg.root.id).toBe(rootId);
  });
});

// ── Cache lifecycle — tested through HTTP layer ───────────────────────────────
// The LsdsCache sits inside the route layer, so these tests exercise the full
// request → cache → DB path via the app handler.

describe("traversal cache — population, hit, and invalidation", () => {
  beforeEach(() => {
    tid = randomUUID();
  });
  afterEach(() => cleanTenant(sql, tid));

  it("first traversal is not cached", async () => {
    const node = await httpCreateNode("L4", "cache-miss-node");
    const res = await app.request(`/v1/nodes/${node.id}/traverse`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ depth: 2, direction: "outbound" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).cached).toBe(false);
  });

  it("identical second traversal is served from cache", async () => {
    const node = await httpCreateNode("L4", "cache-hit-node");
    const body = JSON.stringify({ depth: 2, direction: "outbound" });
    await app.request(`/v1/nodes/${node.id}/traverse`, { method: "POST", headers: h(), body });
    const res = await app.request(`/v1/nodes/${node.id}/traverse`, { method: "POST", headers: h(), body });
    expect((await res.json()).cached).toBe(true);
  });

  it("different depth produces a separate cache entry", async () => {
    const node = await httpCreateNode("L4", "cache-depth-key");
    await app.request(`/v1/nodes/${node.id}/traverse`, {
      method: "POST", headers: h(), body: JSON.stringify({ depth: 2, direction: "outbound" }),
    });
    const res = await app.request(`/v1/nodes/${node.id}/traverse`, {
      method: "POST", headers: h(), body: JSON.stringify({ depth: 3, direction: "outbound" }),
    });
    expect((await res.json()).cached).toBe(false);
  });

  it("different direction produces a separate cache entry", async () => {
    const node = await httpCreateNode("L4", "cache-dir-key");
    await app.request(`/v1/nodes/${node.id}/traverse`, {
      method: "POST", headers: h(), body: JSON.stringify({ depth: 2, direction: "outbound" }),
    });
    const res = await app.request(`/v1/nodes/${node.id}/traverse`, {
      method: "POST", headers: h(), body: JSON.stringify({ depth: 2, direction: "inbound" }),
    });
    expect((await res.json()).cached).toBe(false);
  });

  it("PATCH on traversed node invalidates its traversal cache", async () => {
    const node = await httpCreateNode("L4", "invalidate-node");
    const body = JSON.stringify({ depth: 1, direction: "outbound" });

    // Warm cache
    const warm = await app.request(`/v1/nodes/${node.id}/traverse`, {
      method: "POST", headers: h(), body,
    });
    expect((await warm.json()).cached).toBe(false);

    // Confirm cache hit
    const hit = await app.request(`/v1/nodes/${node.id}/traverse`, {
      method: "POST", headers: h(), body,
    });
    expect((await hit.json()).cached).toBe(true);

    // Mutate the node — should evict traversal cache entries for this node
    await app.request(`/v1/nodes/${node.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ name: "invalidate-node-updated" }),
    });

    // Post-mutation traversal must hit DB again
    const afterPatch = await app.request(`/v1/nodes/${node.id}/traverse`, {
      method: "POST", headers: h(), body,
    });
    expect((await afterPatch.json()).cached).toBe(false);
  });

  it("adding an edge invalidates traversal cache for source and target nodes", async () => {
    const root = await httpCreateNode("L4", "inval-edge-root");
    const child = await httpCreateNode("L4", "inval-edge-child");
    const body = JSON.stringify({ depth: 2, direction: "outbound" });

    // Warm both caches
    await app.request(`/v1/nodes/${root.id}/traverse`, { method: "POST", headers: h(), body });
    await app.request(`/v1/nodes/${child.id}/traverse`, { method: "POST", headers: h(), body });

    // Confirm hits
    const hit1 = await app.request(`/v1/nodes/${root.id}/traverse`, { method: "POST", headers: h(), body });
    const hit2 = await app.request(`/v1/nodes/${child.id}/traverse`, { method: "POST", headers: h(), body });
    expect((await hit1.json()).cached).toBe(true);
    expect((await hit2.json()).cached).toBe(true);

    // Add an edge — triggers cache.invalidateEdge(source=root, target=child)
    await httpCreateEdge(root.id, child.id);

    // Both nodes' traversal caches should now be cold
    const afterEdge1 = await app.request(`/v1/nodes/${root.id}/traverse`, { method: "POST", headers: h(), body });
    const afterEdge2 = await app.request(`/v1/nodes/${child.id}/traverse`, { method: "POST", headers: h(), body });
    expect((await afterEdge1.json()).cached).toBe(false);
    expect((await afterEdge2.json()).cached).toBe(false);
  });

  it("edgeTypes filter is part of the cache key — different filter = cache miss", async () => {
    const node = await httpCreateNode("L4", "cache-et-key");
    await app.request(`/v1/nodes/${node.id}/traverse`, {
      method: "POST", headers: h(),
      body: JSON.stringify({ depth: 2, direction: "outbound", edgeTypes: ["contains"] }),
    });
    const res = await app.request(`/v1/nodes/${node.id}/traverse`, {
      method: "POST", headers: h(),
      body: JSON.stringify({ depth: 2, direction: "outbound", edgeTypes: ["owns"] }),
    });
    expect((await res.json()).cached).toBe(false);
  });
});

// ── Error paths ───────────────────────────────────────────────────────────────

describe("PostgresTraversalAdapter — error paths", () => {
  let tenantId: string;

  beforeEach(() => { tenantId = randomUUID(); });
  afterEach(() => cleanTenant(sql, tenantId));

  it("traverseWithDepth returns empty array for missing root", async () => {
    const adapter = new PostgresTraversalAdapter(sql, tenantId);
    const results = await adapter.traverseWithDepth(randomUUID(), 3, "both");
    expect(results).toHaveLength(0);
  });

  it("traverse throws for missing root", async () => {
    const adapter = new PostgresTraversalAdapter(sql, tenantId);
    await expect(adapter.traverse(randomUUID())).rejects.toThrow();
  });

  it("adapter instantiated with unreachable DB rejects on first query", async () => {
    // Create a throwaway postgres instance pointing at a non-listening port.
    const badSql = postgres("postgres://lsds:lsds@localhost:9999/lsds", {
      max: 1,
      connect_timeout: 2,
    });
    const adapter = new PostgresTraversalAdapter(badSql as typeof sql, tenantId);
    await expect(adapter.traverseWithDepth(randomUUID(), 1, "outbound")).rejects.toThrow();
    await badSql.end({ timeout: 0 }).catch(() => {});
  });

  it("traverse produces correct result after prior failed query with recovered connection", async () => {
    const adapter = new PostgresTraversalAdapter(sql, tenantId);
    const rootId = randomUUID();
    await insertNode(tenantId, rootId);

    // First attempt: non-existent node → rejects
    await expect(adapter.traverse(randomUUID())).rejects.toThrow();

    // Second attempt with valid node must still work (pool not poisoned)
    const pkg = await adapter.traverse(rootId);
    expect(pkg.root.id).toBe(rootId);
  });
});

// ── TtlCache / LsdsCache unit tests ──────────────────────────────────────────
// Cache is tested here in isolation to verify expiry and pattern invalidation
// without touching the DB.

import { TtlCache, LsdsCache } from "../src/cache/index";

describe("TtlCache", () => {
  it("returns undefined for a missing key", () => {
    const cache = new TtlCache<string>(1000);
    expect(cache.get("missing")).toBeUndefined();
    cache.destroy();
  });

  it("returns the stored value before TTL expires", () => {
    const cache = new TtlCache<string>(60_000);
    cache.set("k", "hello");
    expect(cache.get("k")).toBe("hello");
    cache.destroy();
  });

  it("returns undefined after TTL expires", async () => {
    const cache = new TtlCache<string>(50); // 50 ms TTL
    cache.set("k", "hi");
    await new Promise((r) => setTimeout(r, 80));
    expect(cache.get("k")).toBeUndefined();
    cache.destroy();
  });

  it("delete removes the entry immediately", () => {
    const cache = new TtlCache<number>(60_000);
    cache.set("x", 42);
    cache.delete("x");
    expect(cache.get("x")).toBeUndefined();
    cache.destroy();
  });

  it("invalidatePattern removes all keys matching prefix", () => {
    const cache = new TtlCache<number>(60_000);
    cache.set("tenant1:node1:3:outbound:", 1);
    cache.set("tenant1:node2:3:outbound:", 2);
    cache.set("tenant2:node1:3:outbound:", 3);
    cache.invalidatePattern("tenant1:node1:");
    expect(cache.get("tenant1:node1:3:outbound:")).toBeUndefined();
    expect(cache.get("tenant1:node2:3:outbound:")).toBe(2);
    expect(cache.get("tenant2:node1:3:outbound:")).toBe(3);
    cache.destroy();
  });

  it("size reflects live (non-expired) entries", async () => {
    const cache = new TtlCache<string>(50);
    cache.set("a", "v");
    cache.set("b", "v");
    // After expiry, get() prunes individually — size may still count stale entries
    // until sweep runs; test the active-entry count before TTL.
    expect(cache.size).toBe(2);
    cache.destroy();
  });
});

describe("LsdsCache — invalidateNode clears traversal entries for that node", () => {
  it("evicts traversal entries keyed to the invalidated node", () => {
    const c = new LsdsCache(60_000);
    const tid = "t1";
    const nid = "n1";
    const key = c.traversalKey(tid, nid, 3, "outbound");
    // Simulated traversal response (shape matches TraversalResponse)
    c.traversals.set(key, {
      root: nid,
      depth: 3,
      direction: "outbound",
      nodes: [],
      traversal: [],
    });
    expect(c.traversals.get(key)).toBeDefined();

    c.invalidateNode(tid, nid);

    expect(c.traversals.get(key)).toBeUndefined();
    c.destroy();
  });

  it("invalidateEdge clears traversal entries for both source and target", () => {
    const c = new LsdsCache(60_000);
    const tid = "t1";
    const srcId = "src";
    const tgtId = "tgt";
    const edgeId = "edge1";

    const srcKey = c.traversalKey(tid, srcId, 2, "both");
    const tgtKey = c.traversalKey(tid, tgtId, 2, "both");
    const empty = { root: "", depth: 2, direction: "both", nodes: [], traversal: [] };
    c.traversals.set(srcKey, { ...empty, root: srcId });
    c.traversals.set(tgtKey, { ...empty, root: tgtId });

    c.invalidateEdge(tid, edgeId, srcId, tgtId);

    expect(c.traversals.get(srcKey)).toBeUndefined();
    expect(c.traversals.get(tgtKey)).toBeUndefined();
    c.destroy();
  });

  it("invalidateNode does not evict traversal entries for other nodes in same tenant", () => {
    const c = new LsdsCache(60_000);
    const tid = "t1";
    const n1 = "n1";
    const n2 = "n2";
    const key2 = c.traversalKey(tid, n2, 3, "outbound");
    c.traversals.set(key2, { root: n2, depth: 3, direction: "outbound", nodes: [], traversal: [] });

    c.invalidateNode(tid, n1); // invalidating n1 should not touch n2's entry

    expect(c.traversals.get(key2)).toBeDefined();
    c.destroy();
  });
});
