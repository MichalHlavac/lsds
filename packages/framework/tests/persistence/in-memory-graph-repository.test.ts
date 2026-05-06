// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

// Contract spec for the in-memory GraphRepository adapter (LSDS-547).
//
// These tests are *not* about traversal semantics — those live in
// `tests/traversal/`. They pin the public contract every persistence adapter
// must honour: idempotent reads, missing-id filtering, and seed isolation.

import { describe, expect, it } from "vitest";

import { InMemoryGraphRepository } from "../../src/persistence/index.js";
import type { TknBase } from "../../src/shared/base.js";
import type { RelationshipEdge } from "../../src/relationship/types.js";
import type { ViolationRecord } from "../../src/traversal.js";

const TS = "2026-01-01T00:00:00.000Z";

function node(id: string, layer: TknBase["layer"] = "L4"): TknBase {
  return {
    id,
    type: "Service",
    layer,
    name: `Node ${id}`,
    version: "1.0.0",
    lifecycle: "ACTIVE",
    createdAt: TS,
    updatedAt: TS,
  };
}

function edge(source: string, target: string): RelationshipEdge {
  return {
    type: "depends-on",
    sourceLayer: "L4",
    targetLayer: "L4",
    sourceTknId: source,
    targetTknId: target,
  };
}

function violation(id: string, objectId: string): ViolationRecord {
  return {
    id,
    rule_id: "GR-L4-001",
    object_id: objectId,
    object_type: "Service",
    severity: "ERROR",
    status: "OPEN",
    detectedAt: TS,
    message: `violation ${id}`,
  };
}

describe("InMemoryGraphRepository — seed constructor", () => {
  it("accepts an empty seed and behaves like the no-arg constructor", async () => {
    const repo = new InMemoryGraphRepository({});
    expect(await repo.getNode("missing")).toBeNull();
    expect(await repo.getNodes(["missing"])).toEqual([]);
    expect(await repo.getOutgoingEdges("missing")).toEqual([]);
    expect(await repo.getIncomingEdges("missing")).toEqual([]);
    expect(await repo.getViolations(["missing"])).toEqual([]);
  });

  it("seeds nodes, edges, and violations from a snapshot", async () => {
    const a = node("a");
    const b = node("b");
    const e = edge("a", "b");
    const v = violation("v-1", "a");

    const repo = new InMemoryGraphRepository({
      nodes: [a, b],
      edges: [e],
      violations: [v],
    });

    expect(await repo.getNode("a")).toBe(a);
    expect(await repo.getNode("b")).toBe(b);
    expect(await repo.getOutgoingEdges("a")).toEqual([e]);
    expect(await repo.getIncomingEdges("b")).toEqual([e]);
    expect(await repo.getViolations(["a"])).toEqual([v]);
  });

  it("isolates the repo from later mutations of the source arrays", async () => {
    const seedEdge = edge("a", "b");
    const nodes: TknBase[] = [node("a")];
    const edges: RelationshipEdge[] = [seedEdge];
    const violations: ViolationRecord[] = [violation("v-1", "a")];

    const repo = new InMemoryGraphRepository({ nodes, edges, violations });

    nodes.push(node("ghost"));
    edges.push(edge("ghost", "a"));
    violations.push(violation("v-ghost", "ghost"));

    expect(await repo.getNode("ghost")).toBeNull();
    // Seed edge still visible; the post-construction push did NOT leak in
    // (otherwise `a` would have an incoming ghost edge).
    expect(await repo.getOutgoingEdges("a")).toEqual([seedEdge]);
    expect(await repo.getIncomingEdges("a")).toEqual([]);
    expect(await repo.getViolations(["ghost"])).toEqual([]);
  });

  it("does not leak adapter mutations back into the seed arrays", async () => {
    const seedNodes: TknBase[] = [node("a")];
    const seedEdges: RelationshipEdge[] = [];
    const seedViolations: ViolationRecord[] = [];

    const repo = new InMemoryGraphRepository({
      nodes: seedNodes,
      edges: seedEdges,
      violations: seedViolations,
    });

    repo.addNode(node("b"));
    repo.addEdge(edge("a", "b"));
    repo.addViolation(violation("v-1", "b"));

    expect(seedNodes).toHaveLength(1);
    expect(seedEdges).toHaveLength(0);
    expect(seedViolations).toHaveLength(0);
  });
});

describe("InMemoryGraphRepository — read semantics", () => {
  it("getNode returns null for missing ids and the stored node otherwise", async () => {
    const repo = new InMemoryGraphRepository();
    const a = node("a");
    repo.addNode(a);

    expect(await repo.getNode("a")).toBe(a);
    expect(await repo.getNode("missing")).toBeNull();
  });

  it("getNodes filters out ids without a matching node (per GraphRepository JSDoc)", async () => {
    const repo = new InMemoryGraphRepository();
    const a = node("a");
    const c = node("c");
    repo.addNode(a).addNode(c);

    const result = await repo.getNodes(["a", "missing", "c", "also-missing"]);
    expect(result).toEqual([a, c]);
  });

  it("getNodes preserves caller-requested order for present ids", async () => {
    const repo = new InMemoryGraphRepository();
    const a = node("a");
    const b = node("b");
    const c = node("c");
    repo.addNode(a).addNode(b).addNode(c);

    expect(await repo.getNodes(["c", "a", "b"])).toEqual([c, a, b]);
  });

  it("getOutgoingEdges returns only edges where the node is the source", async () => {
    const repo = new InMemoryGraphRepository();
    const eAB = edge("a", "b");
    const eAC = edge("a", "c");
    const eBA = edge("b", "a");
    repo.addEdge(eAB).addEdge(eAC).addEdge(eBA);

    expect(await repo.getOutgoingEdges("a")).toEqual([eAB, eAC]);
    expect(await repo.getOutgoingEdges("b")).toEqual([eBA]);
    expect(await repo.getOutgoingEdges("missing")).toEqual([]);
  });

  it("getIncomingEdges returns only edges where the node is the target", async () => {
    const repo = new InMemoryGraphRepository();
    const eAB = edge("a", "b");
    const eCB = edge("c", "b");
    const eBA = edge("b", "a");
    repo.addEdge(eAB).addEdge(eCB).addEdge(eBA);

    expect(await repo.getIncomingEdges("b")).toEqual([eAB, eCB]);
    expect(await repo.getIncomingEdges("a")).toEqual([eBA]);
    expect(await repo.getIncomingEdges("missing")).toEqual([]);
  });

  it("getViolations returns only violations whose object_id is in the requested set", async () => {
    const repo = new InMemoryGraphRepository();
    const v1 = violation("v-1", "a");
    const v2 = violation("v-2", "b");
    const v3 = violation("v-3", "c");
    repo.addViolation(v1).addViolation(v2).addViolation(v3);

    expect(await repo.getViolations(["a", "c"])).toEqual([v1, v3]);
    expect(await repo.getViolations(["missing"])).toEqual([]);
    expect(await repo.getViolations([])).toEqual([]);
  });

  it("reads are idempotent — repeated calls do not mutate state", async () => {
    const repo = new InMemoryGraphRepository();
    repo.addNode(node("a")).addNode(node("b")).addEdge(edge("a", "b"));

    const first = await repo.getOutgoingEdges("a");
    const second = await repo.getOutgoingEdges("a");
    expect(first).toEqual(second);

    const firstNodes = await repo.getNodes(["a", "b"]);
    const secondNodes = await repo.getNodes(["a", "b"]);
    expect(firstNodes).toEqual(secondNodes);
  });
});
