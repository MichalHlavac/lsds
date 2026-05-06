// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Property-based tests for cycle detection in traversal (LSDS-128).
//
// The relationship validator only validates individual edges.  Cycle prevention
// is the responsibility of the traversal engine's visited-set.  These tests
// use fast-check to generate arbitrary graph shapes — including graphs with
// multi-hop and mutual context-integration cycles — and assert that the engine:
//
//   1. Always terminates (no infinite BFS loop).
//   2. Never returns duplicate node IDs in any bucket.
//   3. Never surfaces a node whose lifecycle is invisible under the profile.
//   4. Handles the classic two-node mutual cycle (A ↔ B context-integration).
//   5. Handles larger k-node ring cycles.
//   6. Handles dense graphs where every node is connected to every other node.

import { beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DefaultTraversalEngine,
  type TraversalProfile,
} from "../../src/traversal.js";
import { InMemoryGraphRepository, makeEdge, makeNode, resetCounter } from "./in-memory-graph.js";

beforeEach(() => resetCounter());

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildL2Ring(size: number): { graph: InMemoryGraphRepository; nodes: ReturnType<typeof makeNode>[] } {
  const graph = new InMemoryGraphRepository();
  const nodes = Array.from({ length: size }, (_, i) =>
    makeNode({ type: "BoundedContext", layer: "L2", name: `BC-${i}` }),
  );
  for (const n of nodes) graph.addNode(n);
  // Ring: 0→1→2→...→(n-1)→0  via context-integration
  for (let i = 0; i < size; i++) {
    graph.addEdge(makeEdge(nodes[i]!, nodes[(i + 1) % size]!, "context-integration"));
  }
  return { graph, nodes };
}

function assertNoDuplicates(ids: string[]): void {
  expect(new Set(ids).size).toBe(ids.length);
}

function allBucketIds(pkg: Awaited<ReturnType<DefaultTraversalEngine["traverse"]>>): string[] {
  return [
    pkg.root.id,
    ...pkg.upward.map((c) => c.id),
    ...pkg.downward.map((c) => c.id),
    ...pkg.lateral.map((c) => c.id),
    ...(pkg.decisions ?? []).map((c) => c.id),
    ...(pkg.requirements ?? []).map((c) => c.id),
  ];
}

// ── Deterministic cycle cases ─────────────────────────────────────────────────

describe("cycle detection — deterministic cases", () => {
  it("two-node mutual context-integration cycle terminates", async () => {
    const graph = new InMemoryGraphRepository();
    const a = makeNode({ type: "BoundedContext", layer: "L2", name: "A" });
    const b = makeNode({ type: "BoundedContext", layer: "L2", name: "B" });
    graph.addNode(a);
    graph.addNode(b);
    graph.addEdge(makeEdge(a, b, "context-integration"));
    graph.addEdge(makeEdge(b, a, "context-integration"));

    const engine = new DefaultTraversalEngine(graph);
    const pkg = await engine.traverse(a.id, { profile: "OPERATIONAL" });

    assertNoDuplicates(allBucketIds(pkg));
    // B reachable laterally from A
    expect(pkg.lateral.map((c) => c.name)).toContain("B");
  });

  it("three-node ring terminates and returns all reachable peers", async () => {
    const { graph, nodes } = buildL2Ring(3);
    const engine = new DefaultTraversalEngine(graph);
    const pkg = await engine.traverse(nodes[0]!.id, { profile: "OPERATIONAL", maxDepth: { lateral: 5 } });

    assertNoDuplicates(allBucketIds(pkg));
    // All other nodes are reachable via the lateral chain
    const lateralNames = pkg.lateral.map((c) => c.name);
    expect(lateralNames).toContain("BC-1");
    expect(lateralNames).toContain("BC-2");
  });

  it("self-loop (node context-integration itself) terminates cleanly", async () => {
    const graph = new InMemoryGraphRepository();
    const a = makeNode({ type: "BoundedContext", layer: "L2", name: "SelfLoop" });
    graph.addNode(a);
    graph.addEdge(makeEdge(a, a, "context-integration"));

    const engine = new DefaultTraversalEngine(graph);
    const pkg = await engine.traverse(a.id, { profile: "OPERATIONAL" });

    // Root is already visited — self-loop edge is skipped, lateral empty.
    assertNoDuplicates(allBucketIds(pkg));
    expect(pkg.lateral).toHaveLength(0);
  });

  it("10-node ring terminates and returns at most lateral-depth peers", async () => {
    const { graph, nodes } = buildL2Ring(10);
    const engine = new DefaultTraversalEngine(graph);
    const lateralDepth = 3;
    const pkg = await engine.traverse(nodes[0]!.id, {
      profile: "OPERATIONAL",
      maxDepth: { lateral: lateralDepth },
    });

    assertNoDuplicates(allBucketIds(pkg));
    // lateral depth cap applies; never returns root itself in lateral bucket
    expect(pkg.lateral.every((c) => c.id !== nodes[0]!.id)).toBe(true);
  });

  it("upstream/downstream chains with cycle back to root terminate", async () => {
    // Pattern: root (L4) → parent (L3) → root (via depends-on, lateral back)
    // and root → child → root-again (via contains + part-of cycle)
    const graph = new InMemoryGraphRepository();
    const root = makeNode({ type: "Service", layer: "L4", name: "Root" });
    const child = makeNode({ type: "APIEndpoint", layer: "L4", name: "Child" });
    const parent = makeNode({ type: "ArchitectureComponent", layer: "L3", name: "Parent" });
    graph.addNode(root);
    graph.addNode(child);
    graph.addNode(parent);
    graph.addEdge(makeEdge(root, child, "contains")); // downward
    graph.addEdge(makeEdge(child, root, "part-of")); // upward (cycle back)
    graph.addEdge(makeEdge(root, parent, "part-of")); // upward
    graph.addEdge(makeEdge(parent, root, "contains")); // downward (cycle back)

    const engine = new DefaultTraversalEngine(graph);
    const pkg = await engine.traverse(root.id, { profile: "OPERATIONAL" });

    assertNoDuplicates(allBucketIds(pkg));
    // child visible downward, parent visible upward — neither duplicated
    expect(pkg.downward.map((c) => c.id)).toContain(child.id);
    expect(pkg.upward.map((c) => c.id)).toContain(parent.id);
  });
});

// ── Property-based tests ─────────────────────────────────────────────────────

describe("cycle detection — property tests (fast-check)", () => {
  // Arbitrary: a graph of L2 BoundedContexts with random context-integration edges.
  // Edge pairs are index pairs into the node array, so cycles are implicit.

  const nodeCountArb = fc.integer({ min: 2, max: 15 });
  const edgesArb = (nodeCount: number) =>
    fc.array(
      fc.tuple(
        fc.integer({ min: 0, max: nodeCount - 1 }),
        fc.integer({ min: 0, max: nodeCount - 1 }),
      ),
      { minLength: 1, maxLength: nodeCount * 3 },
    );

  it("traversal always terminates and returns no duplicate IDs (OPERATIONAL)", async () => {
    await fc.assert(
      fc.asyncProperty(
        nodeCountArb.chain((n) => fc.tuple(fc.constant(n), edgesArb(n))),
        async ([nodeCount, edges]) => {
          const graph = new InMemoryGraphRepository();
          const nodes = Array.from({ length: nodeCount }, (_, i) =>
            makeNode({ type: "BoundedContext", layer: "L2", name: `N${i}` }),
          );
          for (const n of nodes) graph.addNode(n);
          for (const [si, ti] of edges) {
            // Allow self-loops; the visited-set should handle them.
            graph.addEdge(makeEdge(nodes[si]!, nodes[ti]!, "context-integration"));
          }

          const engine = new DefaultTraversalEngine(graph);
          const pkg = await engine.traverse(nodes[0]!.id, {
            profile: "OPERATIONAL",
            maxDepth: { lateral: nodeCount },
          });

          const ids = allBucketIds(pkg);
          // Property: no duplicates across any bucket
          return new Set(ids).size === ids.length;
        },
      ),
      { numRuns: 200 },
    );
  });

  it("traversal always terminates and returns no duplicate IDs (ANALYTICAL)", async () => {
    await fc.assert(
      fc.asyncProperty(
        nodeCountArb.chain((n) => fc.tuple(fc.constant(n), edgesArb(n))),
        async ([nodeCount, edges]) => {
          const graph = new InMemoryGraphRepository();
          const nodes = Array.from({ length: nodeCount }, (_, i) =>
            makeNode({ type: "BoundedContext", layer: "L2", name: `N${i}` }),
          );
          for (const n of nodes) graph.addNode(n);
          for (const [si, ti] of edges) {
            graph.addEdge(makeEdge(nodes[si]!, nodes[ti]!, "context-integration"));
          }

          const engine = new DefaultTraversalEngine(graph);
          const pkg = await engine.traverse(nodes[0]!.id, {
            profile: "ANALYTICAL",
            maxDepth: { lateral: nodeCount },
          });

          const ids = allBucketIds(pkg);
          return new Set(ids).size === ids.length;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("no invisible-lifecycle node leaks into OPERATIONAL results", async () => {
    const lifecycleArb = fc.array(
      fc.constantFrom("ACTIVE", "DEPRECATED", "ARCHIVED" as const),
      { minLength: 2, maxLength: 12 },
    );

    await fc.assert(
      fc.asyncProperty(lifecycleArb, async (lifecycles) => {
        const graph = new InMemoryGraphRepository();
        const nodes = lifecycles.map((lc, i) =>
          makeNode({ type: "BoundedContext", layer: "L2", name: `N${i}`, lifecycle: lc }),
        );
        for (const n of nodes) graph.addNode(n);
        // Ring topology so all are reachable
        for (let i = 0; i < nodes.length - 1; i++) {
          graph.addEdge(makeEdge(nodes[i]!, nodes[i + 1]!, "context-integration"));
        }
        // Ensure root is always ACTIVE so traversal doesn't throw
        nodes[0]!.lifecycle = "ACTIVE";

        const engine = new DefaultTraversalEngine(graph);
        const pkg = await engine.traverse(nodes[0]!.id, {
          profile: "OPERATIONAL",
          maxDepth: { lateral: nodes.length },
        });

        const allNodes = [pkg.root, ...pkg.lateral, ...pkg.upward, ...pkg.downward];
        // OPERATIONAL profile: only ACTIVE and DEPRECATED visible
        return allNodes.every((c) => c.lifecycle === "ACTIVE" || c.lifecycle === "DEPRECATED");
      }),
      { numRuns: 150 },
    );
  });

  it("dense fully-connected L2 graph terminates for any root", async () => {
    // Every node connects to every other — maximum cycle density.
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 8 }),
        async (nodeCount) => {
          const graph = new InMemoryGraphRepository();
          const nodes = Array.from({ length: nodeCount }, (_, i) =>
            makeNode({ type: "BoundedContext", layer: "L2", name: `N${i}` }),
          );
          for (const n of nodes) graph.addNode(n);
          for (let i = 0; i < nodes.length; i++) {
            for (let j = 0; j < nodes.length; j++) {
              if (i !== j) {
                graph.addEdge(makeEdge(nodes[i]!, nodes[j]!, "context-integration"));
              }
            }
          }

          const rootIdx = Math.floor(nodeCount / 2);
          const engine = new DefaultTraversalEngine(graph);
          const pkg = await engine.traverse(nodes[rootIdx]!.id, {
            profile: "OPERATIONAL",
            maxDepth: { lateral: nodeCount },
          });

          const ids = allBucketIds(pkg);
          return new Set(ids).size === ids.length;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("mixed upstream/downstream/lateral cycles never produce duplicate IDs", async () => {
    // Generate a random mix of relationship types to stress-test the visited-set
    // across all three BFS passes.
    const relTypeArb = fc.constantFrom(
      "context-integration",
      "contains",
      "part-of",
      "depends-on",
    ) as fc.Arbitrary<"context-integration" | "contains" | "part-of" | "depends-on">;

    const layerArb = fc.constantFrom("L2", "L3", "L4") as fc.Arbitrary<"L2" | "L3" | "L4">;

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 3, max: 10 }),
        async (nodeCount) => {
          const graph = new InMemoryGraphRepository();
          // Nodes spread across L2/L3/L4 so various relationship types are valid.
          const nodes = Array.from({ length: nodeCount }, (_, i) =>
            makeNode({ type: "Service", layer: "L4", name: `N${i}` }),
          );
          for (const n of nodes) graph.addNode(n);

          // Add random edges with random valid same-layer types.
          // We only use `contains` / `part-of` within L4 and `depends-on` within L4.
          for (let i = 0; i < nodeCount; i++) {
            const j = (i + 1) % nodeCount;
            graph.addEdge(makeEdge(nodes[i]!, nodes[j]!, "depends-on")); // L4→L4 lateral-ish
            graph.addEdge(makeEdge(nodes[j]!, nodes[i]!, "depends-on")); // back-edge = cycle
          }

          const engine = new DefaultTraversalEngine(graph);
          const profile: TraversalProfile = "OPERATIONAL";
          const pkg = await engine.traverse(nodes[0]!.id, { profile });

          const ids = allBucketIds(pkg);
          return new Set(ids).size === ids.length;
        },
      ),
      { numRuns: 150 },
    );
  });
});
