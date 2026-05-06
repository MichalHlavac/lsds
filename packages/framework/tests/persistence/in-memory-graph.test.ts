// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

// Contract tests for InMemoryGraphRepository — the published in-memory
// implementation of GraphRepository. Two layers:
//   1. Deterministic unit tests for the API surface (read shape, ordering,
//      defensive copies, snapshot semantics, empty-result behavior).
//   2. Property tests for the invariants every GraphRepository implementation
//      MUST satisfy, regardless of backing store. The Postgres adapter is
//      expected to satisfy the same invariants — this suite is the contract
//      both must honor.

import { beforeEach, describe, expect, it } from "vitest";
import fc from "fast-check";

import { InMemoryGraphRepository } from "../../src/persistence/in-memory-graph.js";
import type { ViolationRecord } from "../../src/traversal.js";
import { makeEdge, makeNode, resetCounter } from "../traversal/fixtures.js";

beforeEach(() => resetCounter());

describe("InMemoryGraphRepository — getNode", () => {
  it("returns null for a missing id (no throw)", async () => {
    const repo = new InMemoryGraphRepository();
    expect(await repo.getNode("missing")).toBeNull();
  });

  it("returns the stored node by id", async () => {
    const repo = new InMemoryGraphRepository();
    const a = makeNode({ id: "a", type: "Service", layer: "L4", name: "A" });
    repo.addNode(a);
    expect(await repo.getNode("a")).toBe(a);
  });

  it("addNode replaces an existing entry by id", async () => {
    const repo = new InMemoryGraphRepository();
    const a1 = makeNode({ id: "a", type: "Service", layer: "L4", name: "A1" });
    const a2 = makeNode({ id: "a", type: "Service", layer: "L4", name: "A2" });
    repo.addNode(a1).addNode(a2);
    expect((await repo.getNode("a"))?.name).toBe("A2");
    expect(repo.nodeCount).toBe(1);
  });
});

describe("InMemoryGraphRepository — getNodes", () => {
  it("returns [] for empty input", async () => {
    const repo = new InMemoryGraphRepository();
    repo.addNode(makeNode({ id: "a", type: "Service", layer: "L4", name: "A" }));
    expect(await repo.getNodes([])).toEqual([]);
  });

  it("preserves caller id ordering", async () => {
    const repo = new InMemoryGraphRepository();
    const a = makeNode({ id: "a", type: "Service", layer: "L4", name: "A" });
    const b = makeNode({ id: "b", type: "Service", layer: "L4", name: "B" });
    const c = makeNode({ id: "c", type: "Service", layer: "L4", name: "C" });
    repo.addNode(a).addNode(b).addNode(c);

    const result = await repo.getNodes(["c", "a", "b"]);
    expect(result.map((n) => n.id)).toEqual(["c", "a", "b"]);
  });

  it("silently drops unknown ids (parity with left-anti join)", async () => {
    const repo = new InMemoryGraphRepository();
    const a = makeNode({ id: "a", type: "Service", layer: "L4", name: "A" });
    repo.addNode(a);
    const result = await repo.getNodes(["a", "missing"]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("a");
  });
});

describe("InMemoryGraphRepository — edge accessors", () => {
  function buildSmallGraph(): InMemoryGraphRepository {
    const repo = new InMemoryGraphRepository();
    const a = makeNode({ id: "a", type: "Service", layer: "L4", name: "A" });
    const b = makeNode({ id: "b", type: "Service", layer: "L4", name: "B" });
    const c = makeNode({ id: "c", type: "Service", layer: "L4", name: "C" });
    const d = makeNode({ id: "d", type: "Service", layer: "L4", name: "D" });
    repo.addNode(a).addNode(b).addNode(c).addNode(d);
    repo.addEdge(makeEdge(a, c, "depends-on"));
    repo.addEdge(makeEdge(a, b, "depends-on"));
    repo.addEdge(makeEdge(a, b, "calls"));
    repo.addEdge(makeEdge(d, b, "depends-on"));
    return repo;
  }

  it("returns [] for nodes with no outgoing or incoming edges", async () => {
    const repo = new InMemoryGraphRepository();
    const a = makeNode({ id: "a", type: "Service", layer: "L4", name: "A" });
    repo.addNode(a);
    expect(await repo.getOutgoingEdges("a")).toEqual([]);
    expect(await repo.getIncomingEdges("a")).toEqual([]);
  });

  it("returns [] for unknown node id rather than throwing", async () => {
    const repo = new InMemoryGraphRepository();
    expect(await repo.getOutgoingEdges("missing")).toEqual([]);
    expect(await repo.getIncomingEdges("missing")).toEqual([]);
  });

  it("getOutgoingEdges returns deterministic order (target_tkn_id, type)", async () => {
    const repo = buildSmallGraph();
    const out = await repo.getOutgoingEdges("a");
    // Three outgoing from a: (a→c depends-on), (a→b depends-on), (a→b calls)
    // Stable order by target id then type: b/calls, b/depends-on, c/depends-on
    expect(out.map((e) => `${e.targetTknId}:${e.type}`)).toEqual([
      "b:calls",
      "b:depends-on",
      "c:depends-on",
    ]);
  });

  it("getIncomingEdges returns deterministic order (source_tkn_id, type)", async () => {
    const repo = buildSmallGraph();
    const inc = await repo.getIncomingEdges("b");
    expect(inc.map((e) => `${e.sourceTknId}:${e.type}`)).toEqual([
      "a:calls",
      "a:depends-on",
      "d:depends-on",
    ]);
  });

  it("returns defensive copies — mutating the result does not affect storage", async () => {
    const repo = buildSmallGraph();
    const out = await repo.getOutgoingEdges("a");
    const lengthBefore = out.length;
    out.length = 0;
    out.push({} as never);
    const outAgain = await repo.getOutgoingEdges("a");
    expect(outAgain).toHaveLength(lengthBefore);
    expect(outAgain.every((e) => e.sourceTknId === "a")).toBe(true);
  });

  it("read order is stable when storage mutates between traversal hops", async () => {
    // Simulates: engine calls getOutgoingEdges, awaits, caller adds an edge,
    // engine calls getOutgoingEdges again. The first result must be unaffected
    // by the later mutation.
    const repo = buildSmallGraph();
    const a = (await repo.getNode("a"))!;
    const e = makeNode({ id: "e", type: "Service", layer: "L4", name: "E" });
    repo.addNode(e);

    const firstRead = await repo.getOutgoingEdges("a");
    repo.addEdge(makeEdge(a, e, "depends-on"));
    const secondRead = await repo.getOutgoingEdges("a");

    // Defensive: firstRead is its own array; the new edge appears only in
    // the second read.
    expect(firstRead).toHaveLength(3);
    expect(secondRead).toHaveLength(4);
    expect(firstRead.map((x) => x.targetTknId)).not.toContain("e");
    expect(secondRead.map((x) => x.targetTknId)).toContain("e");
  });
});

describe("InMemoryGraphRepository — getViolations", () => {
  function withViolations(): {
    repo: InMemoryGraphRepository;
    v1: ViolationRecord;
    v2: ViolationRecord;
  } {
    const repo = new InMemoryGraphRepository();
    const v1: ViolationRecord = {
      id: "v1",
      rule_id: "GR-L4-001",
      object_id: "ep-1",
      object_type: "APIEndpoint",
      severity: "WARNING",
      status: "OPEN",
      detectedAt: "2026-04-01T00:00:00.000Z",
      message: "missing error_response",
    };
    const v2: ViolationRecord = {
      id: "v2",
      rule_id: "GR-L4-006",
      object_id: "ep-2",
      object_type: "APIEndpoint",
      severity: "ERROR",
      status: "OPEN",
      detectedAt: "2026-04-02T00:00:00.000Z",
      message: "DEPRECATED without sunset_date",
    };
    repo.addViolation(v1).addViolation(v2);
    return { repo, v1, v2 };
  }

  it("returns [] for empty input ids", async () => {
    const { repo } = withViolations();
    expect(await repo.getViolations([])).toEqual([]);
  });

  it("filters by object_id", async () => {
    const { repo } = withViolations();
    const result = await repo.getViolations(["ep-1"]);
    expect(result.map((v) => v.id)).toEqual(["v1"]);
  });

  it("returns multiple records when multiple ids match", async () => {
    const { repo } = withViolations();
    const result = await repo.getViolations(["ep-1", "ep-2"]);
    expect(result.map((v) => v.id).sort()).toEqual(["v1", "v2"]);
  });

  it("returns [] when no violation matches", async () => {
    const { repo } = withViolations();
    expect(await repo.getViolations(["unknown"])).toEqual([]);
  });
});

describe("InMemoryGraphRepository — snapshot", () => {
  it("decouples snapshot from source — adding to snapshot does not affect source", async () => {
    const src = new InMemoryGraphRepository();
    const a = makeNode({ id: "a", type: "Service", layer: "L4", name: "A" });
    const b = makeNode({ id: "b", type: "Service", layer: "L4", name: "B" });
    src.addNode(a).addNode(b).addEdge(makeEdge(a, b, "depends-on"));

    const snap = src.snapshot();
    expect(snap.nodeCount).toBe(2);
    expect(snap.edgeCount).toBe(1);

    const c = makeNode({ id: "c", type: "Service", layer: "L4", name: "C" });
    snap.addNode(c).addEdge(makeEdge(a, c, "depends-on"));

    expect(src.nodeCount).toBe(2);
    expect(src.edgeCount).toBe(1);
    expect(snap.nodeCount).toBe(3);
    expect(snap.edgeCount).toBe(2);
  });

  it("decouples snapshot from source — adding to source does not affect snapshot", async () => {
    const src = new InMemoryGraphRepository();
    const a = makeNode({ id: "a", type: "Service", layer: "L4", name: "A" });
    src.addNode(a);
    const snap = src.snapshot();

    const b = makeNode({ id: "b", type: "Service", layer: "L4", name: "B" });
    src.addNode(b).addEdge(makeEdge(a, b, "depends-on"));

    expect(snap.nodeCount).toBe(1);
    expect(snap.edgeCount).toBe(0);
  });

  it("clones violations including suppression metadata", async () => {
    const src = new InMemoryGraphRepository();
    const v: ViolationRecord = {
      id: "v",
      rule_id: "GR-L4-006",
      object_id: "ep",
      object_type: "APIEndpoint",
      severity: "WARNING",
      status: "SUPPRESSED",
      detectedAt: "2026-04-01T00:00:00.000Z",
      message: "DEPRECATED without sunset_date",
      suppression: {
        rationale: "tracked via SVC-911 — confirmed in next sprint",
        suppressedAt: "2026-04-01T00:00:00.000Z",
        expiresAt: "2026-06-01T00:00:00.000Z",
        suppressedBy: "user:michal",
      },
    };
    src.addViolation(v);

    const snap = src.snapshot();
    const [snapV] = await snap.getViolations(["ep"]);
    expect(snapV).toBeDefined();
    expect(snapV).not.toBe(v);
    expect(snapV!.suppression).not.toBe(v.suppression);
    expect(snapV!.suppression?.rationale).toBe(v.suppression!.rationale);
  });
});

describe("InMemoryGraphRepository — clear", () => {
  it("removes all nodes, edges, violations", async () => {
    const repo = new InMemoryGraphRepository();
    const a = makeNode({ id: "a", type: "Service", layer: "L4", name: "A" });
    const b = makeNode({ id: "b", type: "Service", layer: "L4", name: "B" });
    repo.addNode(a).addNode(b).addEdge(makeEdge(a, b, "depends-on"));
    repo.addViolation({
      id: "v",
      rule_id: "GR-L4-001",
      object_id: "a",
      object_type: "Service",
      severity: "INFO",
      status: "OPEN",
      detectedAt: "2026-04-01T00:00:00.000Z",
      message: "test",
    });

    repo.clear();
    expect(repo.nodeCount).toBe(0);
    expect(repo.edgeCount).toBe(0);
    expect(repo.violationCount).toBe(0);
    expect(await repo.getNode("a")).toBeNull();
    expect(await repo.getOutgoingEdges("a")).toEqual([]);
    expect(await repo.getViolations(["a"])).toEqual([]);
  });
});

// ── Contract invariants (property-based) ─────────────────────────────────────
//
// These properties pin down the GraphRepository contract. Any future adapter
// (Postgres CTE, Neo4j Cypher, ...) MUST satisfy them. The smoke test against
// the real Postgres adapter lives next to that adapter and reuses the same
// invariants.

describe("GraphRepository contract — property invariants", () => {
  const idArb = fc.integer({ min: 0, max: 7 }).map((i) => `n${i}`);
  const typeArb = fc.constantFrom("depends-on", "calls", "contains") as fc.Arbitrary<
    "depends-on" | "calls" | "contains"
  >;
  const edgeArb = fc.tuple(idArb, idArb, typeArb);
  const opsArb = fc.array(edgeArb, { minLength: 0, maxLength: 30 });

  function repoFromOps(
    ops: ReadonlyArray<readonly [string, string, "depends-on" | "calls" | "contains"]>,
  ): {
    repo: InMemoryGraphRepository;
    nodeIds: string[];
  } {
    const repo = new InMemoryGraphRepository();
    const nodeIds = new Set<string>();
    for (const [s, t] of ops) {
      nodeIds.add(s);
      nodeIds.add(t);
    }
    const order = [...nodeIds].sort();
    for (const id of order) {
      repo.addNode(
        makeNode({ id, type: "Service", layer: "L4", name: id.toUpperCase() }),
      );
    }
    const byId = new Map(
      order.map((id) => [
        id,
        makeNode({ id, type: "Service", layer: "L4", name: id.toUpperCase() }),
      ]),
    );
    for (const [s, t, type] of ops) {
      repo.addEdge(makeEdge(byId.get(s)!, byId.get(t)!, type));
    }
    return { repo, nodeIds: order };
  }

  it("∀ node n: every edge in getOutgoingEdges(n) has sourceTknId = n", async () => {
    await fc.assert(
      fc.asyncProperty(opsArb, async (ops) => {
        const { repo, nodeIds } = repoFromOps(ops);
        for (const id of nodeIds) {
          const out = await repo.getOutgoingEdges(id);
          if (!out.every((e) => e.sourceTknId === id)) return false;
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it("∀ node n: every edge in getIncomingEdges(n) has targetTknId = n", async () => {
    await fc.assert(
      fc.asyncProperty(opsArb, async (ops) => {
        const { repo, nodeIds } = repoFromOps(ops);
        for (const id of nodeIds) {
          const inc = await repo.getIncomingEdges(id);
          if (!inc.every((e) => e.targetTknId === id)) return false;
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it("getOutgoingEdges + getIncomingEdges together cover every stored edge exactly once per direction", async () => {
    await fc.assert(
      fc.asyncProperty(opsArb, async (ops) => {
        const { repo, nodeIds } = repoFromOps(ops);
        let outCount = 0;
        let inCount = 0;
        for (const id of nodeIds) {
          outCount += (await repo.getOutgoingEdges(id)).length;
          inCount += (await repo.getIncomingEdges(id)).length;
        }
        // Total inserted edges across all nodes — both indexes must agree.
        return outCount === ops.length && inCount === ops.length;
      }),
      { numRuns: 200 },
    );
  });

  it("getOutgoingEdges is idempotent — same ordered result on repeated reads", async () => {
    await fc.assert(
      fc.asyncProperty(opsArb, idArb, async (ops, id) => {
        const { repo } = repoFromOps(ops);
        const first = await repo.getOutgoingEdges(id);
        const second = await repo.getOutgoingEdges(id);
        if (first.length !== second.length) return false;
        for (let i = 0; i < first.length; i++) {
          const a = first[i]!;
          const b = second[i]!;
          if (
            a.sourceTknId !== b.sourceTknId ||
            a.targetTknId !== b.targetTknId ||
            a.type !== b.type
          ) {
            return false;
          }
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it("snapshot preserves all edges as a multiset (per source node)", async () => {
    await fc.assert(
      fc.asyncProperty(opsArb, async (ops) => {
        const { repo, nodeIds } = repoFromOps(ops);
        const snap = repo.snapshot();
        for (const id of nodeIds) {
          const a = await repo.getOutgoingEdges(id);
          const b = await snap.getOutgoingEdges(id);
          if (a.length !== b.length) return false;
          for (let i = 0; i < a.length; i++) {
            const x = a[i]!;
            const y = b[i]!;
            if (
              x.sourceTknId !== y.sourceTknId ||
              x.targetTknId !== y.targetTknId ||
              x.type !== y.type
            ) {
              return false;
            }
          }
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });

  it("getNodes preserves caller id ordering and length matches present subset", async () => {
    await fc.assert(
      fc.asyncProperty(
        opsArb,
        fc.array(idArb, { minLength: 0, maxLength: 12 }),
        async (ops, queryIds) => {
          const { repo, nodeIds } = repoFromOps(ops);
          const present = new Set(nodeIds);
          const result = await repo.getNodes(queryIds);
          // Length: queryIds filtered to those that exist.
          const expectedLength = queryIds.filter((id) => present.has(id)).length;
          if (result.length !== expectedLength) return false;
          // Order: result ids must be a subsequence of queryIds.
          let qi = 0;
          for (const node of result) {
            while (qi < queryIds.length && queryIds[qi] !== node.id) qi++;
            if (qi >= queryIds.length) return false;
            qi++;
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });
});
