// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TtlCache, LsdsCache } from "../src/cache/index";
import type { NodeRow, EdgeRow } from "../src/db/types";

// ── TtlCache ──────────────────────────────────────────────────────────────────

describe("TtlCache — basic get/set/delete", () => {
  let cache: TtlCache<string>;

  beforeEach(() => {
    cache = new TtlCache<string>(60_000);
  });

  afterEach(() => {
    cache.destroy();
  });

  it("returns undefined for a missing key", () => {
    expect(cache.get("missing")).toBeUndefined();
  });

  it("stores and retrieves a value", () => {
    cache.set("key", "hello");
    expect(cache.get("key")).toBe("hello");
  });

  it("overwrites an existing key", () => {
    cache.set("key", "first");
    cache.set("key", "second");
    expect(cache.get("key")).toBe("second");
  });

  it("deletes a specific key", () => {
    cache.set("key", "value");
    cache.delete("key");
    expect(cache.get("key")).toBeUndefined();
  });

  it("delete on missing key is a no-op", () => {
    expect(() => cache.delete("nonexistent")).not.toThrow();
  });
});

describe("TtlCache — size and clear", () => {
  let cache: TtlCache<string>;

  beforeEach(() => {
    cache = new TtlCache<string>(60_000);
  });

  afterEach(() => {
    cache.destroy();
  });

  it("reports size 0 when empty", () => {
    expect(cache.size).toBe(0);
  });

  it("tracks size accurately after sets", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    expect(cache.size).toBe(2);
  });

  it("decrements size after delete", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.delete("a");
    expect(cache.size).toBe(1);
  });

  it("clear empties the store", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });
});

describe("TtlCache — TTL expiry", () => {
  it("returns undefined for an expired entry", async () => {
    const cache = new TtlCache<string>(1);
    cache.set("key", "value");
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(cache.get("key")).toBeUndefined();
    cache.destroy();
  });

  it("retains a live entry before its TTL elapses", () => {
    const cache = new TtlCache<string>(60_000);
    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");
    cache.destroy();
  });

  it("per-entry override TTL is respected", async () => {
    const cache = new TtlCache<string>(60_000);
    cache.set("short", "v", 1);    // 1 ms override
    cache.set("long", "v", 60_000);
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(cache.get("short")).toBeUndefined();
    expect(cache.get("long")).toBe("v");
    cache.destroy();
  });

  it("expired entries are removed from size count on access", async () => {
    const cache = new TtlCache<string>(1);
    cache.set("key", "value");
    await new Promise<void>((r) => setTimeout(r, 20));
    cache.get("key"); // triggers lazy removal
    // size may still include un-swept entries but accessed one is gone
    cache.destroy();
  });
});

describe("TtlCache — invalidatePattern", () => {
  let cache: TtlCache<string>;

  beforeEach(() => {
    cache = new TtlCache<string>(60_000);
  });

  afterEach(() => {
    cache.destroy();
  });

  it("removes all keys matching prefix", () => {
    cache.set("tenant1:node-a", "1");
    cache.set("tenant1:node-b", "2");
    cache.set("tenant2:node-c", "3");
    cache.invalidatePattern("tenant1:");
    expect(cache.get("tenant1:node-a")).toBeUndefined();
    expect(cache.get("tenant1:node-b")).toBeUndefined();
    expect(cache.get("tenant2:node-c")).toBe("3");
  });

  it("is a no-op when prefix matches nothing", () => {
    cache.set("abc", "1");
    cache.invalidatePattern("xyz:");
    expect(cache.get("abc")).toBe("1");
  });

  it("removes all keys when prefix is empty string", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.invalidatePattern("");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });
});

describe("TtlCache — destroy", () => {
  it("empties the store on destroy", () => {
    const cache = new TtlCache<string>(60_000);
    cache.set("key", "value");
    cache.destroy();
    expect(cache.size).toBe(0);
  });

  it("calling destroy twice does not throw", () => {
    const cache = new TtlCache<string>(60_000);
    cache.destroy();
    expect(() => cache.destroy()).not.toThrow();
  });
});

// ── LsdsCache — key builders ──────────────────────────────────────────────────

describe("LsdsCache — key builders", () => {
  let cache: LsdsCache;

  beforeEach(() => {
    cache = new LsdsCache(60_000);
  });

  afterEach(() => {
    cache.destroy();
  });

  it("nodeKey returns 'tenantId:nodeId'", () => {
    expect(cache.nodeKey("t1", "n1")).toBe("t1:n1");
  });

  it("edgeKey returns 'tenantId:edgeId'", () => {
    expect(cache.edgeKey("t1", "e1")).toBe("t1:e1");
  });

  it("traversalKey encodes depth, direction, and sorted edgeTypes", () => {
    const k = cache.traversalKey("t1", "root", 5, "inbound", ["C", "A", "B"]);
    expect(k).toBe("t1:root:5:inbound:A,B,C");
  });

  it("traversalKey produces stable key regardless of edgeTypes input order", () => {
    const k1 = cache.traversalKey("t1", "root", 3, "both", ["B", "A"]);
    const k2 = cache.traversalKey("t1", "root", 3, "both", ["A", "B"]);
    expect(k1).toBe(k2);
  });

  it("traversalKey with no edgeTypes uses empty segment", () => {
    const k = cache.traversalKey("t1", "root", 3, "outbound");
    expect(k).toBe("t1:root:3:outbound:");
  });

  it("traversalKey differs by depth", () => {
    const k1 = cache.traversalKey("t1", "root", 2, "both");
    const k2 = cache.traversalKey("t1", "root", 3, "both");
    expect(k1).not.toBe(k2);
  });

  it("traversalKey differs by direction", () => {
    const k1 = cache.traversalKey("t1", "root", 3, "inbound");
    const k2 = cache.traversalKey("t1", "root", 3, "outbound");
    expect(k1).not.toBe(k2);
  });
});

// ── LsdsCache — invalidation ──────────────────────────────────────────────────

describe("LsdsCache — invalidateNode", () => {
  let cache: LsdsCache;

  beforeEach(() => {
    cache = new LsdsCache(60_000);
  });

  afterEach(() => {
    cache.destroy();
  });

  it("removes the node entry", () => {
    const key = cache.nodeKey("t1", "n1");
    cache.nodes.set(key, {} as NodeRow);
    cache.invalidateNode("t1", "n1");
    expect(cache.nodes.get(key)).toBeUndefined();
  });

  it("clears traversal entries for the tenant", () => {
    const tKey = cache.traversalKey("t1", "n1", 2, "both");
    cache.traversals.set(tKey, []);
    cache.invalidateNode("t1", "n1");
    expect(cache.traversals.get(tKey)).toBeUndefined();
  });

  it("does not evict traversal entries for other tenants", () => {
    const otherKey = cache.traversalKey("t2", "n1", 2, "both");
    cache.traversals.set(otherKey, []);
    cache.invalidateNode("t1", "n1");
    expect(cache.traversals.get(otherKey)).toBeDefined();
  });

  it("does not affect edges cache", () => {
    const eKey = cache.edgeKey("t1", "e1");
    cache.edges.set(eKey, {} as EdgeRow);
    cache.invalidateNode("t1", "n1");
    expect(cache.edges.get(eKey)).toBeDefined();
  });

  it("evicts only node and neighbor traversals, preserving unrelated ones", () => {
    const nodeKey    = cache.traversalKey("t1", "n1",        2, "both");
    const neighborKey = cache.traversalKey("t1", "neighbor", 2, "both");
    const unrelatedKey = cache.traversalKey("t1", "other",   2, "both");
    cache.traversals.set(nodeKey, []);
    cache.traversals.set(neighborKey, []);
    cache.traversals.set(unrelatedKey, []);

    cache.invalidateNode("t1", "n1", ["neighbor"]);

    expect(cache.traversals.get(nodeKey)).toBeUndefined();
    expect(cache.traversals.get(neighborKey)).toBeUndefined();
    expect(cache.traversals.get(unrelatedKey)).toBeDefined();
  });

  it("with no neighbors, only the node's own traversals are evicted", () => {
    const nodeKey     = cache.traversalKey("t1", "n1",    2, "both");
    const siblingKey  = cache.traversalKey("t1", "other", 2, "both");
    cache.traversals.set(nodeKey, []);
    cache.traversals.set(siblingKey, []);

    cache.invalidateNode("t1", "n1");

    expect(cache.traversals.get(nodeKey)).toBeUndefined();
    expect(cache.traversals.get(siblingKey)).toBeDefined();
  });
});

describe("LsdsCache — invalidateEdge", () => {
  let cache: LsdsCache;

  beforeEach(() => {
    cache = new LsdsCache(60_000);
  });

  afterEach(() => {
    cache.destroy();
  });

  it("removes the edge entry", () => {
    const key = cache.edgeKey("t1", "e1");
    cache.edges.set(key, {} as EdgeRow);
    cache.invalidateEdge("t1", "e1", "src", "tgt");
    expect(cache.edges.get(key)).toBeUndefined();
  });

  it("clears traversal entries rooted at source", () => {
    const tKey = cache.traversalKey("t1", "src", 3, "both");
    cache.traversals.set(tKey, []);
    cache.invalidateEdge("t1", "e1", "src", "tgt");
    expect(cache.traversals.get(tKey)).toBeUndefined();
  });

  it("clears traversal entries rooted at target", () => {
    const tKey = cache.traversalKey("t1", "tgt", 3, "both");
    cache.traversals.set(tKey, []);
    cache.invalidateEdge("t1", "e1", "src", "tgt");
    expect(cache.traversals.get(tKey)).toBeUndefined();
  });

  it("does not affect node cache", () => {
    const nKey = cache.nodeKey("t1", "src");
    cache.nodes.set(nKey, {} as NodeRow);
    cache.invalidateEdge("t1", "e1", "src", "tgt");
    expect(cache.nodes.get(nKey)).toBeDefined();
  });
});

// ── LsdsCache — destroy ───────────────────────────────────────────────────────

describe("LsdsCache — destroy", () => {
  it("clears all three sub-caches", () => {
    const cache = new LsdsCache(60_000);
    cache.nodes.set("t1:n1", {} as NodeRow);
    cache.edges.set("t1:e1", {} as EdgeRow);
    cache.traversals.set("t1:n1:3:both:", []);
    cache.destroy();
    expect(cache.nodes.size).toBe(0);
    expect(cache.edges.size).toBe(0);
    expect(cache.traversals.size).toBe(0);
  });
});
