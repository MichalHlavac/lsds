// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import { decideChange } from "../../src/change/decide";
import {
  ChangePropagationSource,
  propagateChange,
} from "../../src/change/propagation";
import { StaleFlagSchema } from "../../src/change/stale-flag";
import type { PropagationEdge } from "../../src/guardrail/propagation";

const RAISED_AT = "2026-05-10T13:35:00.000Z";

function sourceFor(
  layer: "L3" | "L5" | "L1",
  kind:
    | "RENAME"
    | "RELATIONSHIP_ADDED"
    | "DESCRIPTION_CHANGED"
    | "TYPE_CHANGE",
  opts: { changeId?: string; objectId?: string; objectType?: string } = {},
): ChangePropagationSource {
  const decision = decideChange(
    layer === "L1"
      ? {
          layer,
          kind,
          confirmation: {
            severity:
              kind === "RENAME" || kind === "TYPE_CHANGE"
                ? "MAJOR"
                : kind === "RELATIONSHIP_ADDED"
                ? "MINOR"
                : "PATCH",
            confirmedBy: "user:alice",
            confirmedAt: RAISED_AT,
          },
        }
      : { layer, kind },
  );
  if (decision.status !== "APPLIED") {
    throw new Error("test fixture must produce APPLIED decision");
  }
  return {
    changeId: opts.changeId ?? "ch-001",
    objectId: opts.objectId ?? "svc-1",
    objectType: opts.objectType ?? "Service",
    decision,
    raisedAt: RAISED_AT,
  };
}

const edgeRealizes: PropagationEdge = {
  toObjectId: "req-1",
  toObjectType: "Requirement",
  direction: "UP",
  relationshipType: "realizes",
};
const edgeImplements: PropagationEdge = {
  toObjectId: "comp-1",
  toObjectType: "ArchitectureComponent",
  direction: "DOWN",
  relationshipType: "implements",
};
const edgeTracesTo: PropagationEdge = {
  toObjectId: "goal-1",
  toObjectType: "BusinessGoal",
  direction: "UP",
  relationshipType: "traces-to",
};
const edgePartOf: PropagationEdge = {
  toObjectId: "sys-1",
  toObjectType: "ArchitectureSystem",
  direction: "UP",
  relationshipType: "part-of",
};
const edgeDependsOn: PropagationEdge = {
  toObjectId: "svc-2",
  toObjectType: "Service",
  direction: "LATERAL",
  relationshipType: "depends-on",
};
const edgeContainsDown: PropagationEdge = {
  toObjectId: "mod-1",
  toObjectType: "CodeModule",
  direction: "DOWN",
  relationshipType: "contains",
};
const allEdges = [
  edgeRealizes,
  edgeImplements,
  edgeTracesTo,
  edgePartOf,
  edgeDependsOn,
  edgeContainsDown,
];

describe("StaleFlagSchema", () => {
  it("accepts a fully populated flag", () => {
    const flag = {
      id: "flag-1",
      sourceChangeId: "ch-1",
      objectId: "obj-1",
      objectType: "Service",
      severity: "ERROR" as const,
      raisedAt: RAISED_AT,
      message: "stale",
      viaRelationshipType: "realizes",
      depth: 1,
    };
    expect(() => StaleFlagSchema.parse(flag)).not.toThrow();
  });

  it.each([
    ["empty id", { id: "" }],
    ["empty sourceChangeId", { sourceChangeId: "" }],
    ["empty objectId", { objectId: "" }],
    ["empty objectType", { objectType: "" }],
    ["bad severity", { severity: "FATAL" }],
    ["non-datetime raisedAt", { raisedAt: "yesterday" }],
    ["empty message", { message: "" }],
    ["empty relationship", { viaRelationshipType: "" }],
    ["zero depth", { depth: 0 }],
    ["negative depth", { depth: -1 }],
    ["non-int depth", { depth: 1.5 }],
  ])("rejects %s", (_label, override) => {
    const base = {
      id: "f",
      sourceChangeId: "c",
      objectId: "o",
      objectType: "T",
      severity: "INFO",
      raisedAt: RAISED_AT,
      message: "m",
      viaRelationshipType: "r",
      depth: 1,
    };
    expect(() => StaleFlagSchema.parse({ ...base, ...override })).toThrow();
  });
});

describe("propagateChange — MAJOR (ALL_RELATIONSHIPS / ERROR)", () => {
  it("emits ERROR flag on every edge regardless of relationship type", () => {
    const flags = propagateChange(sourceFor("L3", "RENAME"), allEdges);
    expect(flags).toHaveLength(allEdges.length);
    expect(flags.every((f) => f.severity === "ERROR")).toBe(true);
    const targets = flags.map((f) => f.objectId).sort();
    expect(targets).toEqual(
      [...allEdges].map((e) => e.toObjectId).sort(),
    );
  });

  it("attributes flags to the source change and stamps depth=1", () => {
    const flags = propagateChange(
      sourceFor("L3", "RENAME", { changeId: "ch-XYZ" }),
      [edgeRealizes],
    );
    expect(flags[0].sourceChangeId).toBe("ch-XYZ");
    expect(flags[0].depth).toBe(1);
    expect(flags[0].viaRelationshipType).toBe("realizes");
  });
});

describe("propagateChange — MINOR (SELECTED_RELATIONSHIPS / WARNING)", () => {
  it("emits WARNING flags only on realizes/implements/traces-to", () => {
    const flags = propagateChange(
      sourceFor("L3", "RELATIONSHIP_ADDED"),
      allEdges,
    );
    const targets = flags.map((f) => f.objectId).sort();
    expect(targets).toEqual(
      [edgeImplements, edgeRealizes, edgeTracesTo]
        .map((e) => e.toObjectId)
        .sort(),
    );
    expect(flags.every((f) => f.severity === "WARNING")).toBe(true);
  });

  it("ignores part-of, depends-on, contains for MINOR", () => {
    const flags = propagateChange(sourceFor("L3", "RELATIONSHIP_ADDED"), [
      edgePartOf,
      edgeDependsOn,
      edgeContainsDown,
    ]);
    expect(flags).toEqual([]);
  });
});

describe("propagateChange — PATCH (DIRECT_PARENTS / INFO)", () => {
  it("emits INFO flags only on UP edges (direct parents) regardless of relationship", () => {
    const flags = propagateChange(
      sourceFor("L3", "DESCRIPTION_CHANGED"),
      allEdges,
    );
    const targets = flags.map((f) => f.objectId).sort();
    // All UP edges: realizes (UP), traces-to (UP), part-of (UP)
    expect(targets).toEqual(
      [edgeRealizes, edgeTracesTo, edgePartOf]
        .map((e) => e.toObjectId)
        .sort(),
    );
    expect(flags.every((f) => f.severity === "INFO")).toBe(true);
    expect(flags.every((f) => f.depth === 1)).toBe(true);
  });

  it("does not emit on DOWN or LATERAL edges for PATCH", () => {
    const flags = propagateChange(sourceFor("L3", "DESCRIPTION_CHANGED"), [
      edgeImplements, // DOWN
      edgeDependsOn, // LATERAL
      edgeContainsDown, // DOWN
    ]);
    expect(flags).toEqual([]);
  });
});

describe("propagateChange — depth tracking", () => {
  it("defaults depth to 1 (origin depth 0 + 1 hop)", () => {
    const flags = propagateChange(sourceFor("L3", "RENAME"), [edgeRealizes]);
    expect(flags[0].depth).toBe(1);
  });

  it("respects originDepth option for multi-hop walks", () => {
    const flags = propagateChange(
      sourceFor("L3", "RENAME"),
      [edgeRealizes],
      { originDepth: 2 },
    );
    expect(flags[0].depth).toBe(3);
  });
});

describe("propagateChange — dedupe", () => {
  it("emits only one flag per (objectId, objectType) target even with multiple edges", () => {
    const dupA: PropagationEdge = { ...edgeRealizes };
    const dupB: PropagationEdge = {
      ...edgeRealizes,
      relationshipType: "implements",
    };
    const flags = propagateChange(sourceFor("L3", "RELATIONSHIP_ADDED"), [
      dupA,
      dupB,
    ]);
    expect(flags).toHaveLength(1);
    // First eligible edge wins for relationshipType labelling.
    expect(flags[0].viaRelationshipType).toBe("realizes");
  });
});

describe("propagateChange — schema invariants", () => {
  it("emitted flags pass StaleFlagSchema", () => {
    const flags = propagateChange(sourceFor("L5", "RENAME"), allEdges);
    for (const f of flags) {
      expect(() => StaleFlagSchema.parse(f)).not.toThrow();
    }
  });

  it("uses default deterministic id `${changeId}::${edge.toObjectId}`", () => {
    const flags = propagateChange(
      sourceFor("L3", "RENAME", { changeId: "ch-A" }),
      [edgeRealizes],
    );
    expect(flags[0].id).toBe("ch-A::req-1");
  });

  it("supports custom idGenerator", () => {
    const flags = propagateChange(
      sourceFor("L3", "RENAME"),
      [edgeRealizes],
      { idGenerator: (s, e) => `flag-${s.changeId}-${e.toObjectId}` },
    );
    expect(flags[0].id).toBe("flag-ch-001-req-1");
  });

  it("message names the source severity, source object, and relationship", () => {
    const flags = propagateChange(
      sourceFor("L3", "RENAME", { objectId: "svc-Foo" }),
      [edgeRealizes],
    );
    expect(flags[0].message).toContain("MAJOR");
    expect(flags[0].message).toContain("svc-Foo");
    expect(flags[0].message).toContain("realizes");
  });
});

describe("propagateChange — guards", () => {
  it("throws when decision.status is PENDING_CONFIRMATION", () => {
    const pending = decideChange({ layer: "L1", kind: "RENAME" });
    expect(pending.status).toBe("PENDING_CONFIRMATION");
    expect(() =>
      propagateChange(
        {
          changeId: "ch-1",
          objectId: "o",
          objectType: "Goal",
          // typecheck-bypass is intentional: runtime guard is the test target.
          decision: pending as never,
          raisedAt: RAISED_AT,
        },
        [edgeRealizes],
      ),
    ).toThrow(/APPLIED/);
  });

  it("returns [] for an empty edge list", () => {
    const flags = propagateChange(sourceFor("L3", "RENAME"), []);
    expect(flags).toEqual([]);
  });
});

describe("propagateChange — APPLIED L1 (post-confirmation)", () => {
  it("treats a CONFIRMED L1 MAJOR change exactly like an L3 MAJOR for emission", () => {
    const flags = propagateChange(
      sourceFor("L1", "TYPE_CHANGE", { objectType: "BusinessGoal" }),
      [edgeRealizes, edgePartOf, edgeDependsOn],
    );
    expect(flags).toHaveLength(3);
    expect(flags.every((f) => f.severity === "ERROR")).toBe(true);
  });
});
