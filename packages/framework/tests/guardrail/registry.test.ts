import { describe, expect, it } from "vitest";
import {
  findGuardrails,
  getGuardrail,
  getGuardrailOrThrow,
  guardrailsByEvaluation,
  guardrailsByLayer,
  guardrailsByObjectType,
  guardrailsByOrigin,
  guardrailsBySeverity,
  guardrailsByTrigger,
  listGuardrails,
} from "../../src/guardrail";

describe("registry helpers", () => {
  it("listGuardrails returns the full catalog", () => {
    expect(listGuardrails().length).toBeGreaterThanOrEqual(40);
  });

  it("getGuardrail returns the rule by id", () => {
    const rule = getGuardrail("GR-L1-001");
    expect(rule?.layer).toBe("L1");
    expect(rule?.severity).toBe("ERROR");
  });

  it("getGuardrail returns undefined for unknown id", () => {
    expect(getGuardrail("GR-L9-999")).toBeUndefined();
  });

  it("getGuardrailOrThrow throws for unknown id", () => {
    expect(() => getGuardrailOrThrow("GR-L9-999")).toThrow(/Unknown guardrail/);
  });

  it("guardrailsByLayer filters", () => {
    const l1 = guardrailsByLayer("L1");
    expect(l1.length).toBeGreaterThan(0);
    for (const r of l1) expect(r.layer).toBe("L1");
  });

  it("guardrailsByObjectType includes wildcard rules", () => {
    const archived = guardrailsByObjectType("BusinessGoal");
    const ids = archived.map((r) => r.rule_id);
    expect(ids).toContain("GR-L1-002");
    // XL wildcard rules apply to every object type
    expect(ids).toContain("GR-XL-001");
  });

  it("guardrailsByTrigger covers PERIODIC for descriptive rules", () => {
    const periodic = guardrailsByTrigger("PERIODIC");
    expect(periodic.length).toBeGreaterThan(0);
    for (const r of periodic) expect(r.scope.triggers).toContain("PERIODIC");
  });

  it("guardrailsByOrigin partitions cleanly", () => {
    const structural = guardrailsByOrigin("STRUCTURAL");
    const semantic = guardrailsByOrigin("SEMANTIC");
    expect(structural.length + semantic.length).toBe(listGuardrails().length);
  });

  it("guardrailsByEvaluation partitions cleanly", () => {
    const prescriptive = guardrailsByEvaluation("PRESCRIPTIVE");
    const descriptive = guardrailsByEvaluation("DESCRIPTIVE");
    expect(prescriptive.length + descriptive.length).toBe(listGuardrails().length);
  });

  it("guardrailsBySeverity returns ERRORs", () => {
    const errors = guardrailsBySeverity("ERROR");
    expect(errors.length).toBeGreaterThan(10);
  });

  it("findGuardrails composes multiple filters", () => {
    const result = findGuardrails({
      layer: "L1",
      origin: "STRUCTURAL",
      evaluation: "PRESCRIPTIVE",
      severity: "ERROR",
      trigger: "CREATE",
    });
    expect(result.length).toBe(5); // L1-001..005
    for (const r of result) {
      expect(r.layer).toBe("L1");
      expect(r.origin).toBe("STRUCTURAL");
      expect(r.evaluation).toBe("PRESCRIPTIVE");
      expect(r.severity).toBe("ERROR");
    }
  });

  it("findGuardrails with no filters returns full catalog", () => {
    expect(findGuardrails({}).length).toBe(listGuardrails().length);
  });
});
