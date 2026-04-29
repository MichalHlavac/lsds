// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  GuardrailRuleSchema,
  RuleIdSchema,
  ScopeSchema,
} from "../../src/guardrail/types";

const validRule = {
  rule_id: "GR-L1-099",
  name: "Sample rule",
  layer: "L1" as const,
  origin: "STRUCTURAL" as const,
  evaluation: "PRESCRIPTIVE" as const,
  severity: "ERROR" as const,
  scope: {
    object_type: "BusinessGoal",
    triggers: ["CREATE", "UPDATE"] as const,
  },
  condition: "object.foo != null",
  rationale:
    "We need this rule because otherwise downstream callers cannot reason about the object correctly.",
  remediation:
    "Set the foo field on the object before submitting; without it the catalog cannot validate downstream traceability.",
  propagation: "NONE" as const,
};

describe("RuleIdSchema", () => {
  it.each(["GR-L1-001", "GR-L6-005", "GR-XL-008"])("accepts valid id %s", (id) => {
    expect(() => RuleIdSchema.parse(id)).not.toThrow();
  });

  it.each(["GR-L7-001", "GR-L1-1", "GR-l1-001", "L1-001", "GR-XL-12345"])(
    "rejects invalid id %s",
    (id) => {
      expect(() => RuleIdSchema.parse(id)).toThrow();
    },
  );
});

describe("ScopeSchema", () => {
  it("requires at least one trigger", () => {
    expect(() =>
      ScopeSchema.parse({ object_type: "BusinessGoal", triggers: [] }),
    ).toThrow();
  });

  it("accepts wildcard object_type", () => {
    expect(() =>
      ScopeSchema.parse({ object_type: "*", triggers: ["CREATE"] }),
    ).not.toThrow();
  });
});

describe("GuardrailRuleSchema", () => {
  it("accepts a complete rule", () => {
    expect(() => GuardrailRuleSchema.parse(validRule)).not.toThrow();
  });

  it("requires rationale ≥ 20 chars", () => {
    expect(() =>
      GuardrailRuleSchema.parse({ ...validRule, rationale: "too short" }),
    ).toThrow();
  });

  it("requires remediation ≥ 20 chars", () => {
    expect(() =>
      GuardrailRuleSchema.parse({ ...validRule, remediation: "fix it" }),
    ).toThrow();
  });

  it("rejects rule_id whose layer prefix disagrees with layer field", () => {
    expect(() =>
      GuardrailRuleSchema.parse({ ...validRule, rule_id: "GR-L2-099" }),
    ).toThrow(/rule_id layer/);
  });

  it("rejects unknown extra fields", () => {
    expect(() =>
      GuardrailRuleSchema.parse({ ...validRule, foo: "bar" }),
    ).toThrow();
  });
});
