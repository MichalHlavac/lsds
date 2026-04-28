import { describe, expect, it } from "vitest";
import {
  PROPAGATION_POLICIES,
  RELATIONSHIP_CATEGORIES,
  RELATIONSHIP_TYPES,
  RelationshipDefinitionSchema,
  TRAVERSAL_WEIGHTS,
  getRelationshipDefinition,
  listRelationshipDefinitions,
  validateRelationshipEdge,
} from "../../src/relationship/index.js";
import type { RelationshipType } from "../../src/relationship/index.js";

describe("relationship registry — kap. 2.2 / 2.5 / 2.10", () => {
  it("registers exactly the 19 relationship types from kap. 2.2", () => {
    expect([...RELATIONSHIP_TYPES]).toEqual([
      "realizes",
      "implements",
      "contains",
      "part-of",
      "depends-on",
      "uses",
      "calls",
      "context-integration",
      "supersedes",
      "traces-to",
      "validated-by",
      "owned-by",
      "deploys-to",
      "decided-by",
      "violates",
      "motivated-by",
      "impacts",
      "publishes",
      "consumes",
    ]);
  });

  it("every registered definition parses against the schema", () => {
    for (const def of listRelationshipDefinitions()) {
      expect(() => RelationshipDefinitionSchema.parse(def)).not.toThrow();
    }
  });

  it("registry is keyed 1:1 with the type catalog", () => {
    const defTypes = listRelationshipDefinitions().map((d) => d.type);
    expect(new Set(defTypes).size).toBe(RELATIONSHIP_TYPES.length);
    expect(defTypes.sort()).toEqual([...RELATIONSHIP_TYPES].sort());
  });

  it("all categories used are within the closed enum", () => {
    for (const def of listRelationshipDefinitions()) {
      expect(RELATIONSHIP_CATEGORIES).toContain(def.category);
    }
  });

  it("traversal weight and propagation policy stay within their enums", () => {
    for (const def of listRelationshipDefinitions()) {
      expect(TRAVERSAL_WEIGHTS).toContain(def.traversalWeight);
      expect(PROPAGATION_POLICIES).toContain(def.propagationPolicy);
    }
  });

  it("hard-wires kap. 2.5 propagation rules: contains/realizes=DOWNWARD, part-of/traces-to=UPWARD", () => {
    expect(getRelationshipDefinition("contains").propagationPolicy).toBe("DOWNWARD");
    expect(getRelationshipDefinition("realizes").propagationPolicy).toBe("DOWNWARD");
    expect(getRelationshipDefinition("part-of").propagationPolicy).toBe("UPWARD");
    expect(getRelationshipDefinition("traces-to").propagationPolicy).toBe("UPWARD");
  });

  it("encodes the kap. 2.2 traversal weight column", () => {
    const expected: Record<RelationshipType, "EAGER" | "LAZY"> = {
      realizes: "EAGER",
      implements: "EAGER",
      contains: "EAGER",
      "part-of": "EAGER",
      "depends-on": "EAGER",
      uses: "LAZY",
      calls: "LAZY",
      "context-integration": "EAGER",
      supersedes: "LAZY",
      "traces-to": "EAGER",
      "validated-by": "LAZY",
      "owned-by": "EAGER",
      "deploys-to": "LAZY",
      "decided-by": "LAZY",
      violates: "EAGER",
      "motivated-by": "LAZY",
      impacts: "LAZY",
      publishes: "EAGER",
      consumes: "EAGER",
    };
    for (const type of RELATIONSHIP_TYPES) {
      expect(getRelationshipDefinition(type).traversalWeight).toBe(expected[type]);
    }
  });

  it("forces every definition to ship a non-empty rationale (system educates)", () => {
    for (const def of listRelationshipDefinitions()) {
      expect(def.rationale.length).toBeGreaterThanOrEqual(10);
      expect(def.semantics.length).toBeGreaterThanOrEqual(10);
    }
  });

  it("getRelationshipDefinition throws for unknown types", () => {
    expect(() => getRelationshipDefinition("nope" as RelationshipType)).toThrow(/unknown relationship type/);
  });

  it("owned-by is the only registered type with an external target", () => {
    const externals = listRelationshipDefinitions().filter((d) => d.layerRules.targetIsExternal);
    expect(externals.map((d) => d.type)).toEqual(["owned-by"]);
    expect(externals[0].layerRules.allowedTargetLayers).toEqual([]);
  });
});

describe("validateRelationshipEdge", () => {
  it("rejects unknown relationship type", () => {
    const issues = validateRelationshipEdge({ type: "ghost", sourceLayer: "L1", targetLayer: "L1" });
    expect(issues.map((i) => i.code)).toEqual(["UNKNOWN_TYPE"]);
  });

  it("accepts a canonical realizes edge: L4 Service → L3 Component", () => {
    const issues = validateRelationshipEdge({ type: "realizes", sourceLayer: "L4", targetLayer: "L3" });
    expect(issues).toEqual([]);
  });

  it("rejects realizes that runs upward in concreteness (L3 → L4)", () => {
    const issues = validateRelationshipEdge({ type: "realizes", sourceLayer: "L3", targetLayer: "L4" });
    expect(issues.map((i) => i.code)).toContain("ORDINAL_CONSTRAINT_VIOLATED");
  });

  it("rejects part-of when target layer is more concrete than source", () => {
    const issues = validateRelationshipEdge({ type: "part-of", sourceLayer: "L2", targetLayer: "L4" });
    expect(issues.map((i) => i.code)).toContain("ORDINAL_CONSTRAINT_VIOLATED");
  });

  it("enforces context-integration as L2 ↔ L2", () => {
    expect(validateRelationshipEdge({ type: "context-integration", sourceLayer: "L2", targetLayer: "L2" })).toEqual([]);
    const cross = validateRelationshipEdge({ type: "context-integration", sourceLayer: "L2", targetLayer: "L3" });
    expect(cross.map((i) => i.code)).toContain("TARGET_LAYER_NOT_ALLOWED");
  });

  it("enforces impacts as L1 → L2..L6", () => {
    expect(validateRelationshipEdge({ type: "impacts", sourceLayer: "L1", targetLayer: "L4" })).toEqual([]);
    const wrongSource = validateRelationshipEdge({ type: "impacts", sourceLayer: "L2", targetLayer: "L4" });
    expect(wrongSource.map((i) => i.code)).toContain("SOURCE_LAYER_NOT_ALLOWED");
    const wrongTarget = validateRelationshipEdge({ type: "impacts", sourceLayer: "L1", targetLayer: "L1" });
    expect(wrongTarget.map((i) => i.code)).toContain("TARGET_LAYER_NOT_ALLOWED");
  });

  it("enforces motivated-by as L2..L6 → L1 (strictly upward)", () => {
    expect(validateRelationshipEdge({ type: "motivated-by", sourceLayer: "L4", targetLayer: "L1" })).toEqual([]);
    const sameLayer = validateRelationshipEdge({ type: "motivated-by", sourceLayer: "L1", targetLayer: "L1" });
    expect(sameLayer.map((i) => i.code)).toContain("SOURCE_LAYER_NOT_ALLOWED");
  });

  it("requires owned-by target to be external (null layer)", () => {
    expect(validateRelationshipEdge({ type: "owned-by", sourceLayer: "L1", targetLayer: null })).toEqual([]);
    const withLayer = validateRelationshipEdge({ type: "owned-by", sourceLayer: "L1", targetLayer: "L1" });
    expect(withLayer.map((i) => i.code)).toContain("TARGET_EXTERNAL_REQUIRED");
  });

  it("requires non-owned-by relationships to carry a target layer", () => {
    const issues = validateRelationshipEdge({ type: "contains", sourceLayer: "L2", targetLayer: null });
    expect(issues.map((i) => i.code)).toContain("TARGET_LAYER_NOT_ALLOWED");
  });

  it("traces-to: L3 → L2 valid; L1 → L4 invalid (must run upward in abstraction)", () => {
    expect(validateRelationshipEdge({ type: "traces-to", sourceLayer: "L3", targetLayer: "L2" })).toEqual([]);
    const downward = validateRelationshipEdge({ type: "traces-to", sourceLayer: "L1", targetLayer: "L4" });
    expect(downward.map((i) => i.code)).toContain("ORDINAL_CONSTRAINT_VIOLATED");
  });

  it("publishes / consumes hold same-layer L4 invariant", () => {
    expect(validateRelationshipEdge({ type: "publishes", sourceLayer: "L4", targetLayer: "L4" })).toEqual([]);
    const wrong = validateRelationshipEdge({ type: "publishes", sourceLayer: "L4", targetLayer: "L5" });
    expect(wrong.map((i) => i.code)).toContain("TARGET_LAYER_NOT_ALLOWED");
  });

  it("decided-by routes any layer to an L3 ADR", () => {
    expect(validateRelationshipEdge({ type: "decided-by", sourceLayer: "L1", targetLayer: "L3" })).toEqual([]);
    expect(validateRelationshipEdge({ type: "decided-by", sourceLayer: "L6", targetLayer: "L3" })).toEqual([]);
    const wrong = validateRelationshipEdge({ type: "decided-by", sourceLayer: "L4", targetLayer: "L4" });
    expect(wrong.map((i) => i.code)).toContain("TARGET_LAYER_NOT_ALLOWED");
  });

  it("deploys-to runs from L4/L5 to L6", () => {
    expect(validateRelationshipEdge({ type: "deploys-to", sourceLayer: "L5", targetLayer: "L6" })).toEqual([]);
    const wrong = validateRelationshipEdge({ type: "deploys-to", sourceLayer: "L6", targetLayer: "L5" });
    expect(wrong.map((i) => i.code)).toContain("SOURCE_LAYER_NOT_ALLOWED");
  });
});
