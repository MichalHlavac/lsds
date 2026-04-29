import { describe, expect, it } from "vitest";
import {
  PROPAGATION_DIRECTIONS,
  PropagationDirectionSchema,
  PropagationEdgeSchema,
  demoteSeverity,
  generateSuppressionMarker,
  propagateViolation,
  type PropagationEdge,
} from "../../src/guardrail/propagation";
import type { Violation } from "../../src/guardrail/violation";

const baseViolation: Violation = {
  id: "v-001",
  rule_id: "GR-L1-001",
  object_id: "bg-1",
  object_type: "BusinessGoal",
  severity: "ERROR",
  status: "OPEN",
  detectedAt: "2026-04-01T10:00:00.000Z",
  message: "Goal lacks a measurable kpi",
};

const upEdge: PropagationEdge = {
  toObjectId: "parent-1",
  toObjectType: "Portfolio",
  direction: "UP",
  relationshipType: "part-of",
};
const downEdge: PropagationEdge = {
  toObjectId: "child-1",
  toObjectType: "BusinessCapability",
  direction: "DOWN",
  relationshipType: "contains",
};
const lateralEdge: PropagationEdge = {
  toObjectId: "peer-1",
  toObjectType: "BusinessGoal",
  direction: "LATERAL",
  relationshipType: "depends-on",
};

describe("PropagationDirectionSchema", () => {
  it.each(PROPAGATION_DIRECTIONS)("accepts %s", (d) => {
    expect(() => PropagationDirectionSchema.parse(d)).not.toThrow();
  });

  it("rejects unknown direction", () => {
    expect(() => PropagationDirectionSchema.parse("SIDEWAYS")).toThrow();
  });
});

describe("PropagationEdgeSchema", () => {
  it("accepts a fully populated edge", () => {
    expect(() => PropagationEdgeSchema.parse(upEdge)).not.toThrow();
  });

  it("rejects edges with empty relationshipType", () => {
    expect(() =>
      PropagationEdgeSchema.parse({ ...upEdge, relationshipType: "" }),
    ).toThrow();
  });
});

describe("demoteSeverity", () => {
  it("demotes ERROR → WARNING", () => {
    expect(demoteSeverity("ERROR")).toBe("WARNING");
  });
  it("demotes WARNING → INFO", () => {
    expect(demoteSeverity("WARNING")).toBe("INFO");
  });
  it("returns null for INFO (floor)", () => {
    expect(demoteSeverity("INFO")).toBeNull();
  });
});

describe("propagateViolation", () => {
  it("returns [] when policy is NONE", () => {
    expect(propagateViolation(baseViolation, "NONE", [upEdge, downEdge])).toEqual([]);
  });

  it("propagates UP only when policy is UPWARD", () => {
    const result = propagateViolation(baseViolation, "UPWARD", [upEdge, downEdge, lateralEdge]);
    expect(result).toHaveLength(1);
    expect(result[0].object_id).toBe("parent-1");
    expect(result[0].severity).toBe("WARNING");
  });

  it("propagates DOWN only when policy is DOWNWARD", () => {
    const result = propagateViolation(baseViolation, "DOWNWARD", [upEdge, downEdge, lateralEdge]);
    expect(result).toHaveLength(1);
    expect(result[0].object_id).toBe("child-1");
  });

  it("propagates UP+DOWN when policy is BOTH", () => {
    const result = propagateViolation(baseViolation, "BOTH", [upEdge, downEdge, lateralEdge]);
    const targets = result.map((v) => v.object_id).sort();
    expect(targets).toEqual(["child-1", "parent-1"]);
    expect(result.every((v) => v.severity === "WARNING")).toBe(true);
  });

  it("propagates LATERAL only when policy is LATERAL", () => {
    const result = propagateViolation(baseViolation, "LATERAL", [upEdge, downEdge, lateralEdge]);
    expect(result).toHaveLength(1);
    expect(result[0].object_id).toBe("peer-1");
  });

  it("inherited violation references the original origin id and increments depth", () => {
    const firstHop = propagateViolation(baseViolation, "UPWARD", [upEdge])[0];
    expect(firstHop.inheritedFrom).toBe(baseViolation.id);
    expect(firstHop.inheritDepth).toBe(1);

    const grandparentEdge: PropagationEdge = {
      toObjectId: "grandparent-1",
      toObjectType: "Portfolio",
      direction: "UP",
      relationshipType: "part-of",
    };
    const secondHop = propagateViolation(firstHop, "UPWARD", [grandparentEdge])[0];
    expect(secondHop.inheritedFrom).toBe(baseViolation.id);
    expect(secondHop.inheritDepth).toBe(2);
    expect(secondHop.severity).toBe("INFO"); // WARNING demoted to INFO
  });

  it("stops propagating once severity reaches the INFO floor", () => {
    const infoSource: Violation = { ...baseViolation, severity: "INFO" };
    expect(propagateViolation(infoSource, "BOTH", [upEdge, downEdge])).toEqual([]);
  });

  it("forces inherited violations into OPEN status regardless of source status", () => {
    const ack: Violation = { ...baseViolation, status: "ACKNOWLEDGED" };
    const inherited = propagateViolation(ack, "UPWARD", [upEdge]);
    expect(inherited[0].status).toBe("OPEN");
  });

  it("uses the supplied idGenerator when provided", () => {
    const result = propagateViolation(
      baseViolation,
      "UPWARD",
      [upEdge],
      { idGenerator: () => "custom-id" },
    );
    expect(result[0].id).toBe("custom-id");
  });

  it("emits descriptive message that names the source and relationship", () => {
    const result = propagateViolation(baseViolation, "UPWARD", [upEdge]);
    expect(result[0].message).toContain(baseViolation.id);
    expect(result[0].message).toContain("part-of");
  });
});

describe("generateSuppressionMarker", () => {
  const suppression = {
    rationale: "Approved by security council pending vendor migration window.",
    suppressedAt: "2026-04-01T10:00:00.000Z",
    expiresAt: "2026-05-01T10:00:00.000Z",
    suppressedBy: "user:alice",
  };

  it("returns an INFO violation that names the source and rationale", () => {
    const marker = generateSuppressionMarker({
      ...baseViolation,
      status: "SUPPRESSED",
      suppression,
    });
    expect(marker.severity).toBe("INFO");
    expect(marker.status).toBe("OPEN");
    expect(marker.object_id).toBe(baseViolation.object_id);
    expect(marker.message).toContain(baseViolation.id);
    expect(marker.message).toContain(suppression.rationale);
    expect(marker.message).toContain(suppression.expiresAt);
    expect(marker.detectedAt).toBe(suppression.suppressedAt);
  });

  it("throws when source violation is not SUPPRESSED", () => {
    expect(() => generateSuppressionMarker(baseViolation)).toThrow(
      /must be SUPPRESSED/,
    );
  });
});
