// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  validateGraphCardinality,
  type RelationshipEdge,
} from "../../src/relationship/index.js";

// Per kap. 2.2 each relationship type carries one of {1:1, 1:N, N:1, M:N}.
// `validateGraphCardinality` is the only place where the count of edges (not
// just their layer/type validity) is checked — so every assertion below pivots
// on the *number* of outgoing or incoming edges per source/target node.

function edge(
  type: RelationshipEdge["type"],
  sourceTknId: string,
  targetTknId: string,
  sourceLayer: RelationshipEdge["sourceLayer"] = "L3",
  targetLayer: RelationshipEdge["targetLayer"] = "L3",
): RelationshipEdge {
  return { type, sourceLayer, targetLayer, sourceTknId, targetTknId };
}

describe("validateGraphCardinality — kap. 2.2", () => {
  it("returns no issues for an empty graph", () => {
    expect(validateGraphCardinality([])).toEqual([]);
  });

  it("accepts a single edge of every cardinality kind", () => {
    const edges: RelationshipEdge[] = [
      edge("supersedes", "adr:A", "adr:B"), // 1:1
      edge("part-of", "service:X", "bc:Y", "L4", "L2"), // N:1
      edge("contains", "bc:Y", "entity:Z", "L2", "L2"), // 1:N
      edge("realizes", "service:X", "comp:K", "L4", "L3"), // M:N
    ];
    expect(validateGraphCardinality(edges)).toEqual([]);
  });

  // ── 1:1 — supersedes ────────────────────────────────────────────────────────
  describe("1:1 (supersedes)", () => {
    it("rejects two outgoing supersedes from the same source", () => {
      const issues = validateGraphCardinality([
        edge("supersedes", "adr:A", "adr:B"),
        edge("supersedes", "adr:A", "adr:C"),
      ]);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.code).toBe("CARDINALITY_VIOLATED");
      expect(issues[0]?.message).toContain("supersedes");
      expect(issues[0]?.message).toContain("'adr:A'");
      expect(issues[0]?.message).toContain("outgoing");
    });

    it("rejects two incoming supersedes into the same target", () => {
      const issues = validateGraphCardinality([
        edge("supersedes", "adr:A", "adr:Z"),
        edge("supersedes", "adr:B", "adr:Z"),
      ]);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.code).toBe("CARDINALITY_VIOLATED");
      expect(issues[0]?.message).toContain("'adr:Z'");
      expect(issues[0]?.message).toContain("incoming");
    });

    it("flags BOTH directions when a single source overflows on both sides", () => {
      // adr:A has two outgoing AND adr:Z has two incoming
      const issues = validateGraphCardinality([
        edge("supersedes", "adr:A", "adr:Z"),
        edge("supersedes", "adr:A", "adr:Y"),
        edge("supersedes", "adr:B", "adr:Z"),
      ]);
      const codes = issues.map((i) => i.code);
      expect(codes).toEqual(["CARDINALITY_VIOLATED", "CARDINALITY_VIOLATED"]);
      const messages = issues.map((i) => i.message).join("\n");
      expect(messages).toContain("outgoing");
      expect(messages).toContain("incoming");
    });
  });

  // ── N:1 — part-of ───────────────────────────────────────────────────────────
  describe("N:1 (part-of)", () => {
    it("accepts many sources pointing to the same target", () => {
      const issues = validateGraphCardinality([
        edge("part-of", "entity:A", "bc:Z", "L2", "L2"),
        edge("part-of", "entity:B", "bc:Z", "L2", "L2"),
        edge("part-of", "entity:C", "bc:Z", "L2", "L2"),
      ]);
      expect(issues).toEqual([]);
    });

    it("rejects one source with two outgoing part-of edges", () => {
      const issues = validateGraphCardinality([
        edge("part-of", "service:X", "bc:Y", "L4", "L2"),
        edge("part-of", "service:X", "bc:Z", "L4", "L2"),
      ]);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.code).toBe("CARDINALITY_VIOLATED");
      expect(issues[0]?.message).toContain("part-of");
      expect(issues[0]?.message).toContain("'service:X'");
      expect(issues[0]?.message).toContain("outgoing");
    });

    it("counts duplicate edges as separate occurrences (no silent dedupe)", () => {
      const issues = validateGraphCardinality([
        edge("part-of", "service:X", "bc:Y", "L4", "L2"),
        edge("part-of", "service:X", "bc:Y", "L4", "L2"),
      ]);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.message).toContain("'service:X'");
    });
  });

  // ── 1:N — contains ──────────────────────────────────────────────────────────
  describe("1:N (contains)", () => {
    it("accepts a single parent with many children", () => {
      const issues = validateGraphCardinality([
        edge("contains", "bc:Y", "entity:A", "L2", "L2"),
        edge("contains", "bc:Y", "entity:B", "L2", "L2"),
        edge("contains", "bc:Y", "entity:C", "L2", "L2"),
      ]);
      expect(issues).toEqual([]);
    });

    it("rejects two parents claiming the same child", () => {
      const issues = validateGraphCardinality([
        edge("contains", "bc:Y", "entity:Z", "L2", "L2"),
        edge("contains", "bc:W", "entity:Z", "L2", "L2"),
      ]);
      expect(issues).toHaveLength(1);
      expect(issues[0]?.code).toBe("CARDINALITY_VIOLATED");
      expect(issues[0]?.message).toContain("contains");
      expect(issues[0]?.message).toContain("'entity:Z'");
      expect(issues[0]?.message).toContain("incoming");
    });
  });

  // ── M:N — realizes (and friends) ────────────────────────────────────────────
  describe("M:N (realizes)", () => {
    it("does not flag many-to-many fan-out / fan-in", () => {
      const issues = validateGraphCardinality([
        edge("realizes", "service:A", "comp:K", "L4", "L3"),
        edge("realizes", "service:A", "comp:L", "L4", "L3"),
        edge("realizes", "service:B", "comp:K", "L4", "L3"),
        edge("realizes", "service:B", "comp:L", "L4", "L3"),
      ]);
      expect(issues).toEqual([]);
    });
  });

  // ── Cross-talk isolation ────────────────────────────────────────────────────
  it("does not count edges across types together (no cross-type bleed)", () => {
    // adr:X has one outgoing supersedes (ok) and one outgoing part-of (ok).
    // Cross-type counting would falsely fire as 2 outgoing.
    const issues = validateGraphCardinality([
      edge("supersedes", "adr:X", "adr:Y"),
      edge("part-of", "adr:X", "adr:Z"),
    ]);
    expect(issues).toEqual([]);
  });

  it("reports violations per type independently in a mixed graph", () => {
    const issues = validateGraphCardinality([
      // 1:1 violation: adr:A → two ADRs
      edge("supersedes", "adr:A", "adr:B"),
      edge("supersedes", "adr:A", "adr:C"),
      // N:1 violation: service:S → two BCs via part-of
      edge("part-of", "service:S", "bc:1", "L4", "L2"),
      edge("part-of", "service:S", "bc:2", "L4", "L2"),
      // 1:N violation: entity:E claimed by two BCs
      edge("contains", "bc:1", "entity:E", "L2", "L2"),
      edge("contains", "bc:2", "entity:E", "L2", "L2"),
      // M:N realizes — no violation expected
      edge("realizes", "service:S", "comp:K", "L4", "L3"),
      edge("realizes", "service:S", "comp:L", "L4", "L3"),
    ]);
    const messages = issues.map((i) => i.message);
    expect(issues).toHaveLength(3);
    expect(messages.some((m) => m.includes("supersedes") && m.includes("'adr:A'"))).toBe(true);
    expect(messages.some((m) => m.includes("part-of") && m.includes("'service:S'"))).toBe(true);
    expect(messages.some((m) => m.includes("contains") && m.includes("'entity:E'"))).toBe(true);
    for (const i of issues) expect(i.code).toBe("CARDINALITY_VIOLATED");
  });

  it("ignores edges of unknown relationship types (single-edge validator owns UNKNOWN_TYPE)", () => {
    const issues = validateGraphCardinality([
      // @ts-expect-error — exercise the runtime guard with an invalid type literal
      { type: "ghost", sourceLayer: "L3", targetLayer: "L3", sourceTknId: "a", targetTknId: "b" },
      // @ts-expect-error — second to ensure no fake bucket is created
      { type: "ghost", sourceLayer: "L3", targetLayer: "L3", sourceTknId: "a", targetTknId: "c" },
    ]);
    expect(issues).toEqual([]);
  });
});
