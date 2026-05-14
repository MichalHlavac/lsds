// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

// Regression suite for the LSDS-1003 guardrail normalization.
//
// Three stale-predicate rules were converted from "affirmative" form
// (condition is TRUE when a violation exists) to "invariant" form
// (condition is TRUE when the system is healthy; violation fires when
// condition is FALSE). This file:
//
//   1. Locks in the invariant-form operators for GR-L1-007, GR-L1-009,
//      GR-L3-009 so that a catalog revert is caught immediately.
//   2. Guards against regression to the old affirmative operators.
//   3. Provides semantic commentary that documents when each rule fires,
//      bridging the gap between the string condition and the evaluation model.

import { describe, expect, it } from "vitest";
import { getGuardrailOrThrow } from "../../src/guardrail";

describe("LSDS-1003 normalization — GR-L1-007 BusinessGoal staleness", () => {
  describe("positive: invariant-form operators are present", () => {
    it("condition uses lifecycle != to exclude non-ACTIVE goals from violation scope", () => {
      const rule = getGuardrailOrThrow("GR-L1-007");
      expect(rule.condition).toContain("lifecycle != 'ACTIVE'");
    });

    it("condition uses <= 180 boundary (healthy if reviewed within 180 days)", () => {
      const rule = getGuardrailOrThrow("GR-L1-007");
      expect(rule.condition).toContain("<= 180");
    });

    it("is DESCRIPTIVE evaluation (not PRESCRIPTIVE)", () => {
      const rule = getGuardrailOrThrow("GR-L1-007");
      expect(rule.evaluation).toBe("DESCRIPTIVE");
    });
  });

  describe("negative: old affirmative-form operators are absent (regression guard)", () => {
    it("condition does not use lifecycle == 'ACTIVE' (old violation-fires-when-TRUE form)", () => {
      const rule = getGuardrailOrThrow("GR-L1-007");
      expect(rule.condition).not.toContain("lifecycle == 'ACTIVE'");
    });

    it("condition does not use > 180 threshold (old affirmative staleness test)", () => {
      const rule = getGuardrailOrThrow("GR-L1-007");
      expect(rule.condition).not.toContain("> 180");
    });
  });

  it("semantic: violation fires on ACTIVE goal whose last_review_date > 180 days ago", () => {
    // Invariant: `lifecycle != 'ACTIVE' || (now - last_review_date) <= 180 days`
    // Violation fires when: lifecycle == 'ACTIVE' AND (now - last_review_date) > 180 days
    // (the OR-connective means both conditions must fail for the invariant to be false)
    const rule = getGuardrailOrThrow("GR-L1-007");
    expect(rule.condition).toContain("lifecycle != 'ACTIVE'");
    expect(rule.condition).toContain("<= 180");
    expect(rule.scope.object_type).toBe("BusinessGoal");
    expect(rule.scope.triggers).toContain("PERIODIC");
  });
});

describe("LSDS-1003 normalization — GR-L1-009 APPROVED Requirement impacts", () => {
  describe("positive: invariant-form operators are present", () => {
    it("condition uses status != 'APPROVED' to exclude non-APPROVED requirements", () => {
      const rule = getGuardrailOrThrow("GR-L1-009");
      expect(rule.condition).toContain("status != 'APPROVED'");
    });

    it("condition uses impacts.length > 0 (healthy if impacts are declared)", () => {
      const rule = getGuardrailOrThrow("GR-L1-009");
      expect(rule.condition).toContain("impacts.length > 0");
    });

    it("is DESCRIPTIVE evaluation (not PRESCRIPTIVE)", () => {
      const rule = getGuardrailOrThrow("GR-L1-009");
      expect(rule.evaluation).toBe("DESCRIPTIVE");
    });
  });

  describe("negative: old affirmative-form operators are absent (regression guard)", () => {
    it("condition does not use status == 'APPROVED' (old violation-fires-when-TRUE form)", () => {
      // Before LSDS-1003: `object.status == 'APPROVED' && object.impacts.length == 0`
      const rule = getGuardrailOrThrow("GR-L1-009");
      expect(rule.condition).not.toContain("status == 'APPROVED'");
    });

    it("condition does not use impacts.length == 0 (old empty-impacts assertion)", () => {
      const rule = getGuardrailOrThrow("GR-L1-009");
      expect(rule.condition).not.toContain("impacts.length == 0");
    });
  });

  it("semantic: violation fires on APPROVED requirement with no declared impacts", () => {
    // Invariant: `status != 'APPROVED' || impacts.length > 0`
    // Violation fires when: status == 'APPROVED' AND impacts.length == 0
    const rule = getGuardrailOrThrow("GR-L1-009");
    expect(rule.condition).toContain("status != 'APPROVED'");
    expect(rule.condition).toContain("impacts.length > 0");
    expect(rule.scope.object_type).toBe("Requirement");
    expect(rule.scope.triggers).toContain("PERIODIC");
    expect(rule.scope.triggers).toContain("UPDATE");
    expect(rule.severity).toBe("INFO");
  });
});

describe("LSDS-1003 normalization — GR-L3-009 ExternalSystem staleness", () => {
  describe("positive: invariant-form operators are present", () => {
    it("condition uses <= 180 boundary (healthy if reviewed within 180 days)", () => {
      const rule = getGuardrailOrThrow("GR-L3-009");
      expect(rule.condition).toContain("<= 180");
    });

    it("is DESCRIPTIVE evaluation (not PRESCRIPTIVE)", () => {
      const rule = getGuardrailOrThrow("GR-L3-009");
      expect(rule.evaluation).toBe("DESCRIPTIVE");
    });
  });

  describe("negative: old affirmative-form operators are absent (regression guard)", () => {
    it("condition does not use > 180 threshold (old affirmative staleness test)", () => {
      // Before LSDS-1003: `(now - object.last_review_date) > 180 days`
      const rule = getGuardrailOrThrow("GR-L3-009");
      expect(rule.condition).not.toContain("> 180");
    });
  });

  it("semantic: violation fires on ExternalSystem with last_review_date > 180 days ago", () => {
    // Invariant: `(now - object.last_review_date) <= 180 days`
    // Violation fires when: (now - last_review_date) > 180 days
    const rule = getGuardrailOrThrow("GR-L3-009");
    expect(rule.condition).toContain("object.last_review_date");
    expect(rule.condition).toContain("<= 180");
    expect(rule.scope.object_type).toBe("ExternalSystem");
    expect(rule.scope.triggers).toContain("PERIODIC");
    expect(rule.severity).toBe("WARNING");
  });
});

describe("LSDS-1003 normalization — cross-rule consistency", () => {
  it("all three normalized rules are DESCRIPTIVE+WARNING or DESCRIPTIVE+INFO (not PRESCRIPTIVE)", () => {
    const l1007 = getGuardrailOrThrow("GR-L1-007");
    const l1009 = getGuardrailOrThrow("GR-L1-009");
    const l3009 = getGuardrailOrThrow("GR-L3-009");
    expect(l1007.evaluation).toBe("DESCRIPTIVE");
    expect(l1009.evaluation).toBe("DESCRIPTIVE");
    expect(l3009.evaluation).toBe("DESCRIPTIVE");
    expect(l1007.origin).toBe("SEMANTIC");
    expect(l1009.origin).toBe("SEMANTIC");
    expect(l3009.origin).toBe("SEMANTIC");
  });

  it("no normalized rule uses && to combine a lifecycle/status gate with a violation test (old affirmative pattern)", () => {
    // Old form: `A == 'BAD_VALUE' && metric > threshold`
    // Invariant form: `A != 'BAD_VALUE' || metric <= threshold`
    // The && connector between a lifecycle gate and a threshold is the tell-tale sign of the old form.
    const l1007 = getGuardrailOrThrow("GR-L1-007");
    const l1009 = getGuardrailOrThrow("GR-L1-009");
    // GR-L1-007: old form was `lifecycle == 'ACTIVE' && ... > 180`
    expect(l1007.condition).not.toMatch(/lifecycle\s*==.*&&.*>\s*180/);
    // GR-L1-009: old form was `status == 'APPROVED' && impacts.length == 0`
    expect(l1009.condition).not.toMatch(/status\s*==\s*'APPROVED'\s*&&\s*impacts/);
  });
});
