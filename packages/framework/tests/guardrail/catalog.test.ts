// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  GUARDRAIL_CATALOG,
  validateCatalog,
} from "../../src/guardrail";
import { GuardrailRuleSchema } from "../../src/guardrail/types";

describe("GUARDRAIL_CATALOG completeness", () => {
  it("has all expected layer ranges", () => {
    const expected = {
      L1: ["GR-L1-001", "GR-L1-002", "GR-L1-003", "GR-L1-004", "GR-L1-005",
           "GR-L1-006", "GR-L1-007", "GR-L1-008", "GR-L1-009"],
      L2: ["GR-L2-001", "GR-L2-002", "GR-L2-003", "GR-L2-004", "GR-L2-005",
           "GR-L2-006", "GR-L2-007", "GR-L2-008"],
      L3: ["GR-L3-001", "GR-L3-002", "GR-L3-003", "GR-L3-004", "GR-L3-005",
           "GR-L3-006", "GR-L3-007", "GR-L3-008", "GR-L3-009"],
      L4: ["GR-L4-001", "GR-L4-002", "GR-L4-003", "GR-L4-004", "GR-L4-005",
           "GR-L4-006", "GR-L4-007"],
      L5: ["GR-L5-001", "GR-L5-002", "GR-L5-003", "GR-L5-004", "GR-L5-005",
           "GR-L5-006", "GR-L5-007"],
      L6: ["GR-L6-001", "GR-L6-002", "GR-L6-003", "GR-L6-004", "GR-L6-005",
           "GR-L6-006", "GR-L6-007", "GR-L6-008", "GR-L6-009"],
      XL: ["GR-XL-001", "GR-XL-002", "GR-XL-003", "GR-XL-004", "GR-XL-005",
           "GR-XL-006", "GR-XL-007", "GR-XL-008", "GR-XL-009", "GR-XL-010",
           "GR-XL-011"],
    };

    const actualByLayer: Record<string, string[]> = {};
    for (const rule of GUARDRAIL_CATALOG) {
      (actualByLayer[rule.layer] ??= []).push(rule.rule_id);
    }
    for (const layer of Object.keys(expected) as Array<keyof typeof expected>) {
      expect(actualByLayer[layer]?.sort()).toEqual([...expected[layer]].sort());
    }
  });

  it("has unique rule_ids", () => {
    const ids = GUARDRAIL_CATALOG.map((r) => r.rule_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("totals approximately 40 rules (research kap. 5)", () => {
    expect(GUARDRAIL_CATALOG.length).toBeGreaterThanOrEqual(40);
    expect(GUARDRAIL_CATALOG.length).toBeLessThanOrEqual(60);
  });

  it("every rule has rationale ≥ 20 chars and remediation ≥ 20 chars", () => {
    for (const rule of GUARDRAIL_CATALOG) {
      expect(rule.rationale.length).toBeGreaterThanOrEqual(20);
      expect(rule.remediation.length).toBeGreaterThanOrEqual(20);
    }
  });

  it("every rule passes the GuardrailRuleSchema", () => {
    for (const rule of GUARDRAIL_CATALOG) {
      expect(() => GuardrailRuleSchema.parse(rule)).not.toThrow();
    }
  });

  it("validateCatalog() does not throw", () => {
    expect(() => validateCatalog()).not.toThrow();
  });

  it("every rule declares at least one trigger", () => {
    for (const rule of GUARDRAIL_CATALOG) {
      expect(rule.scope.triggers.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("PRESCRIPTIVE rules fire on CREATE or UPDATE (write-time)", () => {
    const prescriptive = GUARDRAIL_CATALOG.filter((r) => r.evaluation === "PRESCRIPTIVE");
    for (const rule of prescriptive) {
      const writeTime = rule.scope.triggers.some(
        (t) => t === "CREATE" || t === "UPDATE" || t === "DELETE" || t === "ARCHIVE",
      );
      expect(writeTime).toBe(true);
    }
  });
});
