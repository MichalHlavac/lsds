// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Performance smoke tests for DefaultTraversalEngine on large in-memory graphs.
// Mandate: framework traversal must handle 10k-node graphs without timeout.
// (LSDS-804)
//
// Graph topology: 5-ary balanced spanning tree of N nodes, connected via
// `contains` (downward) edges. Each traversal case is timed independently
// of graph setup.
//
// Wall-clock thresholds (traversal only, setup excluded):
//   1k nodes:  < 500 ms
//   5k nodes:  < 1000 ms
//   10k nodes: < 2000 ms

import { describe, expect, it } from "vitest";
import { DefaultTraversalEngine } from "../../src/traversal.js";
import { InMemoryGraphRepository } from "../../src/persistence/in-memory-graph.js";
import { makeEdge, makeNode } from "./fixtures.js";

// ── Thresholds ────────────────────────────────────────────────────────────────

const TIMEOUT_1K_MS = 500;
const TIMEOUT_5K_MS = 1_000;
const TIMEOUT_10K_MS = 2_000;

// ── Fixture builder ───────────────────────────────────────────────────────────

type TreeFixture = {
  graph: InMemoryGraphRepository;
  nodes: ReturnType<typeof makeNode>[];
};

const LAYERS = ["L2", "L3", "L4"] as const;

/**
 * 5-ary balanced spanning tree with `contains` (downward) edges.
 * Node i's parent: Math.floor((i - 1) / 5).
 * Root is nodes[0]; the deepest leaf is nodes[nodeCount - 1].
 */
function buildSpanningTree(nodeCount: number): TreeFixture {
  const graph = new InMemoryGraphRepository();
  const nodes: ReturnType<typeof makeNode>[] = [];

  for (let i = 0; i < nodeCount; i++) {
    const node = makeNode({
      id: `n-${i}`,
      type: "Service",
      layer: LAYERS[i % 3]!,
      name: `node-${i}`,
    });
    graph.addNode(node);
    nodes.push(node);
  }

  for (let i = 1; i < nodeCount; i++) {
    graph.addEdge(makeEdge(nodes[Math.floor((i - 1) / 5)]!, nodes[i]!, "contains"));
  }

  return { graph, nodes };
}

/**
 * Minimum depth needed to reach all leaves of a 5-ary tree with nodeCount nodes.
 * ceil(log5(nodeCount * 4 + 1)) + 1 gives a safe upper bound.
 */
function requiredDepth(nodeCount: number): number {
  return Math.ceil(Math.log(nodeCount * 4 + 1) / Math.log(5)) + 1;
}

function allBucketIds(pkg: {
  root: { id: string };
  upward: { id: string }[];
  downward: { id: string }[];
  lateral: { id: string }[];
}): string[] {
  return [pkg.root.id, ...pkg.upward.map((c) => c.id), ...pkg.downward.map((c) => c.id), ...pkg.lateral.map((c) => c.id)];
}

// ── 1k-node smoke ─────────────────────────────────────────────────────────────

describe("traversal-perf: 1k-node graph", () => {
  const NODE_COUNT = 1_000;
  const depth = requiredDepth(NODE_COUNT); // 6

  it(
    `downward from root visits nodes without duplicates within ${TIMEOUT_1K_MS} ms`,
    async () => {
      const { graph, nodes } = buildSpanningTree(NODE_COUNT);
      const engine = new DefaultTraversalEngine(graph);
      const rootId = nodes[0]!.id;

      const t0 = performance.now();
      const pkg = await engine.traverse(rootId, {
        profile: "OPERATIONAL",
        maxDepth: { downward: depth, upward: 0, lateral: 0 },
        tokenBudget: Number.MAX_SAFE_INTEGER,
      });
      const elapsed = performance.now() - t0;

      expect(pkg.root.id).toBe(rootId);
      expect(pkg.downward.length).toBeGreaterThan(0);
      const ids = allBucketIds(pkg);
      expect(new Set(ids).size).toBe(ids.length);
      // Downward bucket must not include root
      expect(pkg.downward.map((c) => c.id)).not.toContain(rootId);

      console.log(`[perf:1k] downward: ${pkg.downward.length} nodes in ${elapsed.toFixed(1)} ms`);
      expect(elapsed).toBeLessThan(TIMEOUT_1K_MS);
    },
    TIMEOUT_1K_MS + 5_000,
  );

  it(
    `upward from deepest leaf traces to root without duplicates within ${TIMEOUT_1K_MS} ms`,
    async () => {
      const { graph, nodes } = buildSpanningTree(NODE_COUNT);
      const engine = new DefaultTraversalEngine(graph);
      const leafId = nodes[NODE_COUNT - 1]!.id;

      const t0 = performance.now();
      const pkg = await engine.traverse(leafId, {
        profile: "OPERATIONAL",
        maxDepth: { upward: depth, downward: 0, lateral: 0 },
        tokenBudget: Number.MAX_SAFE_INTEGER,
      });
      const elapsed = performance.now() - t0;

      expect(pkg.root.id).toBe(leafId);
      expect(pkg.upward.length).toBeGreaterThan(0);
      const ids = allBucketIds(pkg);
      expect(new Set(ids).size).toBe(ids.length);
      // Root node (index 0) must appear in the upward chain of the leaf
      expect(pkg.upward.map((c) => c.id)).toContain(nodes[0]!.id);

      console.log(`[perf:1k] upward: ${pkg.upward.length} nodes in ${elapsed.toFixed(1)} ms`);
      expect(elapsed).toBeLessThan(TIMEOUT_1K_MS);
    },
    TIMEOUT_1K_MS + 5_000,
  );
});

// ── 5k-node smoke ─────────────────────────────────────────────────────────────

describe("traversal-perf: 5k-node graph", () => {
  const NODE_COUNT = 5_000;
  const depth = requiredDepth(NODE_COUNT); // 7

  it(
    `downward from root visits nodes without duplicates within ${TIMEOUT_5K_MS} ms`,
    async () => {
      const { graph, nodes } = buildSpanningTree(NODE_COUNT);
      const engine = new DefaultTraversalEngine(graph);
      const rootId = nodes[0]!.id;

      const t0 = performance.now();
      const pkg = await engine.traverse(rootId, {
        profile: "OPERATIONAL",
        maxDepth: { downward: depth, upward: 0, lateral: 0 },
        tokenBudget: Number.MAX_SAFE_INTEGER,
      });
      const elapsed = performance.now() - t0;

      expect(pkg.root.id).toBe(rootId);
      expect(pkg.downward.length).toBeGreaterThan(0);
      const ids = allBucketIds(pkg);
      expect(new Set(ids).size).toBe(ids.length);
      expect(pkg.downward.map((c) => c.id)).not.toContain(rootId);

      console.log(`[perf:5k] downward: ${pkg.downward.length} nodes in ${elapsed.toFixed(1)} ms`);
      expect(elapsed).toBeLessThan(TIMEOUT_5K_MS);
    },
    TIMEOUT_5K_MS + 5_000,
  );

  it(
    `upward from deepest leaf traces to root without duplicates within ${TIMEOUT_5K_MS} ms`,
    async () => {
      const { graph, nodes } = buildSpanningTree(NODE_COUNT);
      const engine = new DefaultTraversalEngine(graph);
      const leafId = nodes[NODE_COUNT - 1]!.id;

      const t0 = performance.now();
      const pkg = await engine.traverse(leafId, {
        profile: "OPERATIONAL",
        maxDepth: { upward: depth, downward: 0, lateral: 0 },
        tokenBudget: Number.MAX_SAFE_INTEGER,
      });
      const elapsed = performance.now() - t0;

      expect(pkg.root.id).toBe(leafId);
      expect(pkg.upward.length).toBeGreaterThan(0);
      const ids = allBucketIds(pkg);
      expect(new Set(ids).size).toBe(ids.length);
      expect(pkg.upward.map((c) => c.id)).toContain(nodes[0]!.id);

      console.log(`[perf:5k] upward: ${pkg.upward.length} nodes in ${elapsed.toFixed(1)} ms`);
      expect(elapsed).toBeLessThan(TIMEOUT_5K_MS);
    },
    TIMEOUT_5K_MS + 5_000,
  );
});

// ── 10k-node smoke (mandate threshold) ───────────────────────────────────────

describe("traversal-perf: 10k-node graph (mandate threshold)", () => {
  const NODE_COUNT = 10_000;
  const depth = requiredDepth(NODE_COUNT); // 7

  it(
    `downward from root visits nodes without duplicates within ${TIMEOUT_10K_MS} ms`,
    async () => {
      const { graph, nodes } = buildSpanningTree(NODE_COUNT);
      const engine = new DefaultTraversalEngine(graph);
      const rootId = nodes[0]!.id;

      const t0 = performance.now();
      const pkg = await engine.traverse(rootId, {
        profile: "OPERATIONAL",
        maxDepth: { downward: depth, upward: 0, lateral: 0 },
        tokenBudget: Number.MAX_SAFE_INTEGER,
      });
      const elapsed = performance.now() - t0;

      expect(pkg.root.id).toBe(rootId);
      // All 9,999 non-root nodes must appear exactly once in downward bucket.
      expect(pkg.downward.length).toBe(NODE_COUNT - 1);
      const ids = allBucketIds(pkg);
      expect(new Set(ids).size).toBe(ids.length);
      expect(pkg.downward.map((c) => c.id)).not.toContain(rootId);
      // Every downward card must have a negative distance (kap. 6.1 sign convention).
      expect(pkg.downward.every((c) => c.distance < 0)).toBe(true);

      console.log(`[perf:10k] downward: ${pkg.downward.length} nodes in ${elapsed.toFixed(1)} ms`);
      expect(elapsed).toBeLessThan(TIMEOUT_10K_MS);
    },
    TIMEOUT_10K_MS + 5_000,
  );

  it(
    `upward from deepest leaf traces to root without duplicates within ${TIMEOUT_10K_MS} ms`,
    async () => {
      const { graph, nodes } = buildSpanningTree(NODE_COUNT);
      const engine = new DefaultTraversalEngine(graph);
      const leafId = nodes[NODE_COUNT - 1]!.id;

      const t0 = performance.now();
      const pkg = await engine.traverse(leafId, {
        profile: "OPERATIONAL",
        maxDepth: { upward: depth, downward: 0, lateral: 0 },
        tokenBudget: Number.MAX_SAFE_INTEGER,
      });
      const elapsed = performance.now() - t0;

      expect(pkg.root.id).toBe(leafId);
      expect(pkg.upward.length).toBeGreaterThan(0);
      const ids = allBucketIds(pkg);
      expect(new Set(ids).size).toBe(ids.length);
      // Ancestry chain from deepest leaf must reach the tree root.
      expect(pkg.upward.map((c) => c.id)).toContain(nodes[0]!.id);
      // All upward cards must have positive distance (kap. 6.1 sign convention).
      expect(pkg.upward.every((c) => c.distance > 0)).toBe(true);

      console.log(`[perf:10k] upward: ${pkg.upward.length} nodes in ${elapsed.toFixed(1)} ms`);
      expect(elapsed).toBeLessThan(TIMEOUT_10K_MS);
    },
    TIMEOUT_10K_MS + 5_000,
  );

  it(
    "ANALYTICAL profile on 10k-node graph completes within 2x the OPERATIONAL bound",
    async () => {
      const { graph, nodes } = buildSpanningTree(NODE_COUNT);
      const engine = new DefaultTraversalEngine(graph);
      const rootId = nodes[0]!.id;

      const t0 = performance.now();
      const pkg = await engine.traverse(rootId, {
        profile: "ANALYTICAL",
        maxDepth: { downward: depth, upward: 0, lateral: 0 },
        tokenBudget: Number.MAX_SAFE_INTEGER,
      });
      const elapsed = performance.now() - t0;

      expect(pkg.root.id).toBe(rootId);
      expect(pkg.downward.length).toBe(NODE_COUNT - 1);
      const ids = allBucketIds(pkg);
      expect(new Set(ids).size).toBe(ids.length);

      console.log(`[perf:10k] ANALYTICAL downward: ${pkg.downward.length} nodes in ${elapsed.toFixed(1)} ms`);
      expect(elapsed).toBeLessThan(TIMEOUT_10K_MS * 2);
    },
    TIMEOUT_10K_MS * 2 + 5_000,
  );
});
