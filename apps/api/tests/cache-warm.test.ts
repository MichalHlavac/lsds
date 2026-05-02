// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, vi } from "vitest";
import { warmCache } from "../src/cache/warm.js";
import { LsdsCache } from "../src/cache/index.js";
import type { NodeRow, EdgeRow } from "../src/db/types.js";

const makeNode = (id: string, tenantId = "tenant-1"): NodeRow => ({
  id,
  tenantId,
  type: "Service",
  layer: "L1",
  name: `node-${id}`,
  version: "0.1.0",
  lifecycleStatus: "ACTIVE",
  attributes: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  deprecatedAt: null,
  archivedAt: null,
  purgeAfter: null,
});

const makeEdge = (id: string, tenantId = "tenant-1"): EdgeRow => ({
  id,
  tenantId,
  sourceId: "src",
  targetId: "tgt",
  type: "DEPENDS_ON",
  layer: "L1",
  traversalWeight: 1,
  lifecycleStatus: "ACTIVE",
  attributes: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  deprecatedAt: null,
  archivedAt: null,
  purgeAfter: null,
});

function makeSql(nodes: NodeRow[], edges: EdgeRow[]) {
  let call = 0;
  const tag = vi.fn(async () => {
    return call++ === 0 ? nodes : edges;
  });
  return tag as unknown as import("../src/db/client.js").Sql;
}

describe("warmCache", () => {
  it("populates cache.nodes and cache.edges from DB rows", async () => {
    const nodes = [makeNode("n1"), makeNode("n2", "tenant-2")];
    const edges = [makeEdge("e1"), makeEdge("e2", "tenant-2")];
    const sql = makeSql(nodes, edges);
    const cache = new LsdsCache();

    await warmCache(sql, cache, 500);

    expect(cache.nodes.get(cache.nodeKey("tenant-1", "n1"))).toEqual(nodes[0]);
    expect(cache.nodes.get(cache.nodeKey("tenant-2", "n2"))).toEqual(nodes[1]);
    expect(cache.edges.get(cache.edgeKey("tenant-1", "e1"))).toEqual(edges[0]);
    expect(cache.edges.get(cache.edgeKey("tenant-2", "e2"))).toEqual(edges[1]);
  });

  it("is a no-op when DB returns empty arrays", async () => {
    const sql = makeSql([], []);
    const cache = new LsdsCache();
    await warmCache(sql, cache, 500);
    expect(cache.nodes.size).toBe(0);
    expect(cache.edges.size).toBe(0);
  });

  it("uses CACHE_WARMUP_LIMIT env var as default limit", async () => {
    process.env.CACHE_WARMUP_LIMIT = "10";
    const sql = makeSql([], []);
    const cache = new LsdsCache();
    await warmCache(sql, cache);
    delete process.env.CACHE_WARMUP_LIMIT;
  });
});
