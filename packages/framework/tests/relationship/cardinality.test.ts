// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  validateGraphCardinality,
  type RelationshipEdge,
} from "../../src/relationship/index.js";

// Convenience constructor — keeps test bodies short and readable.
const edge = (
  type: RelationshipEdge["type"],
  sourceTknId: string,
  targetTknId: string,
  sourceLayer: RelationshipEdge["sourceLayer"],
  targetLayer: RelationshipEdge["targetLayer"],
): RelationshipEdge => ({ type, sourceLayer, targetLayer, sourceTknId, targetTknId });

describe("validateGraphCardinality — kap. 2.2", () => {
  it("returns no issues for an empty graph", () => {
    expect(validateGraphCardinality([])).toEqual([]);
  });

  it("M:N relationships impose no graph-level constraint", () => {
    // realizes is M:N — many concrete realizers per abstract definition is allowed.
    const edges: RelationshipEdge[] = [
      edge("realizes", "svc-a", "comp-1", "L4", "L3"),
      edge("realizes", "svc-b", "comp-1", "L4", "L3"),
      edge("realizes", "svc-a", "comp-2", "L4", "L3"),
    ];
    expect(validateGraphCardinality(edges)).toEqual([]);
  });

  it("N:1 part-of: one outgoing per source is fine", () => {
    const edges: RelationshipEdge[] = [
      edge("part-of", "entity-a", "context-1", "L2", "L2"),
      edge("part-of", "entity-b", "context-1", "L2", "L2"),
      edge("part-of", "entity-c", "context-2", "L2", "L2"),
    ];
    expect(validateGraphCardinality(edges)).toEqual([]);
  });

  it("N:1 part-of: rejects a source with two outgoing edges", () => {
    const edges: RelationshipEdge[] = [
      edge("part-of", "entity-a", "context-1", "L2", "L2"),
      edge("part-of", "entity-a", "context-2", "L2", "L2"),
    ];
    const issues = validateGraphCardinality(edges);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("CARDINALITY_VIOLATED");
    expect(issues[0].message).toMatch(/part-of \(N:1\)/);
    expect(issues[0].message).toContain("entity-a");
    expect(issues[0].message).toContain("context-1");
    expect(issues[0].message).toContain("context-2");
  });

  it("1:N contains: many distinct children per parent is fine", () => {
    const edges: RelationshipEdge[] = [
      edge("contains", "ctx-1", "entity-a", "L2", "L2"),
      edge("contains", "ctx-1", "entity-b", "L2", "L2"),
      edge("contains", "ctx-1", "entity-c", "L2", "L2"),
    ];
    expect(validateGraphCardinality(edges)).toEqual([]);
  });

  it("1:N contains: rejects two parents owning the same child", () => {
    const edges: RelationshipEdge[] = [
      edge("contains", "ctx-1", "entity-a", "L2", "L2"),
      edge("contains", "ctx-2", "entity-a", "L2", "L2"),
    ];
    const issues = validateGraphCardinality(edges);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("CARDINALITY_VIOLATED");
    expect(issues[0].message).toMatch(/contains \(1:N\)/);
    expect(issues[0].message).toContain("entity-a");
    expect(issues[0].message).toContain("ctx-1");
    expect(issues[0].message).toContain("ctx-2");
  });

  it("1:1 supersedes: a clean replacement chain registers no issue", () => {
    const edges: RelationshipEdge[] = [
      edge("supersedes", "adr-2", "adr-1", "L3", "L3"),
      edge("supersedes", "adr-3", "adr-2", "L3", "L3"),
    ];
    expect(validateGraphCardinality(edges)).toEqual([]);
  });

  it("1:1 supersedes: rejects forking outgoing (one source supersedes two)", () => {
    const edges: RelationshipEdge[] = [
      edge("supersedes", "adr-new", "adr-1", "L3", "L3"),
      edge("supersedes", "adr-new", "adr-2", "L3", "L3"),
    ];
    const issues = validateGraphCardinality(edges);
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("CARDINALITY_VIOLATED");
    const outgoingIssue = issues.find((i) => i.message.includes("outgoing"));
    expect(outgoingIssue).toBeDefined();
    expect(outgoingIssue!.message).toMatch(/supersedes \(1:1\)/);
    expect(outgoingIssue!.message).toContain("adr-new");
  });

  it("1:1 supersedes: rejects forking incoming (two sources supersede one target)", () => {
    const edges: RelationshipEdge[] = [
      edge("supersedes", "adr-2", "adr-1", "L3", "L3"),
      edge("supersedes", "adr-3", "adr-1", "L3", "L3"),
    ];
    const issues = validateGraphCardinality(edges);
    const incomingIssue = issues.find((i) => i.message.includes("incoming"));
    expect(incomingIssue).toBeDefined();
    expect(incomingIssue!.code).toBe("CARDINALITY_VIOLATED");
    expect(incomingIssue!.message).toMatch(/supersedes \(1:1\)/);
    expect(incomingIssue!.message).toContain("adr-1");
  });

  it("1:1 supersedes: dual fork emits both outgoing and incoming issues", () => {
    // adr-x supersedes adr-1 and adr-2 (outgoing fork on adr-x)
    // adr-y also supersedes adr-1 (incoming fork on adr-1)
    const edges: RelationshipEdge[] = [
      edge("supersedes", "adr-x", "adr-1", "L3", "L3"),
      edge("supersedes", "adr-x", "adr-2", "L3", "L3"),
      edge("supersedes", "adr-y", "adr-1", "L3", "L3"),
    ];
    const issues = validateGraphCardinality(edges);
    const outgoing = issues.filter((i) => i.message.includes("outgoing"));
    const incoming = issues.filter((i) => i.message.includes("incoming"));
    expect(outgoing).toHaveLength(1);
    expect(incoming).toHaveLength(1);
    expect(outgoing[0].message).toContain("adr-x");
    expect(incoming[0].message).toContain("adr-1");
  });

  it("deduplicates exact-duplicate edges before counting (no false positive)", () => {
    // Same edge listed twice — caller bug, not a cardinality breach.
    const e = edge("part-of", "entity-a", "context-1", "L2", "L2");
    expect(validateGraphCardinality([e, e])).toEqual([]);
  });

  it("does not cross-count between distinct relationship types", () => {
    // Both edges share source `node-a` but belong to different types.
    // Neither type alone has more than one outgoing for `node-a`, so OK.
    const edges: RelationshipEdge[] = [
      edge("part-of", "node-a", "ctx-1", "L2", "L2"),
      edge("supersedes", "node-a", "node-b", "L2", "L2"),
    ];
    expect(validateGraphCardinality(edges)).toEqual([]);
  });

  it("evaluates cardinality independently per type in mixed graphs", () => {
    const edges: RelationshipEdge[] = [
      // OK: M:N realizes
      edge("realizes", "svc-a", "comp-1", "L4", "L3"),
      edge("realizes", "svc-b", "comp-1", "L4", "L3"),
      // OK: M:N impacts (one Requirement, many distinct targets)
      edge("impacts", "req-1", "svc-a", "L1", "L4"),
      edge("impacts", "req-1", "svc-b", "L1", "L4"),
      // VIOLATION: N:1 part-of forking
      edge("part-of", "entity-x", "ctx-1", "L2", "L2"),
      edge("part-of", "entity-x", "ctx-2", "L2", "L2"),
    ];
    const issues = validateGraphCardinality(edges);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("CARDINALITY_VIOLATED");
    expect(issues[0].message).toMatch(/part-of \(N:1\)/);
  });

  it("silently skips edges whose type is unknown to the registry", () => {
    // Unknown type would be flagged by validateRelationshipEdge (UNKNOWN_TYPE);
    // graph-level cardinality has nothing to enforce on it.
    const stranger = { ...edge("part-of", "a", "b", "L2", "L2"), type: "ghost" } as unknown as RelationshipEdge;
    const real = edge("part-of", "a", "b", "L2", "L2");
    // Mixed bag: stranger should not be counted alongside the real part-of edge.
    expect(validateGraphCardinality([stranger, real])).toEqual([]);
  });
});
