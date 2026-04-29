// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  ChangeConfirmation,
  ChangeOverride,
  decideChange,
  OVERRIDE_RATIONALE_MIN_CHARS,
} from "../../src/change";

const validOverride: ChangeOverride = {
  severity: "MAJOR",
  rationale: "Renaming is breaking for downstream consumers; treat as major.",
  overriddenBy: "user:alice",
  overriddenAt: "2026-04-29T12:00:00.000Z",
};

const validConfirmation: ChangeConfirmation = {
  severity: "MINOR",
  confirmedBy: "user:bob",
  confirmedAt: "2026-04-29T12:00:00.000Z",
};

describe("decideChange — L1/L2 REQUIRE_CONFIRMATION", () => {
  it("returns PENDING_CONFIRMATION when no confirmation supplied", () => {
    const decision = decideChange({ layer: "L1", kind: "RENAME" });
    expect(decision.status).toBe("PENDING_CONFIRMATION");
    if (decision.status !== "PENDING_CONFIRMATION") return;
    expect(decision.policy).toBe("REQUIRE_CONFIRMATION");
    expect(decision.proposedSeverity).toBe("MAJOR");
    expect(decision.effectiveSeverity).toBeNull();
    expect(decision.propagation).toBeNull();
  });

  it("APPLIED + CONFIRMED with confirmation", () => {
    const decision = decideChange({
      layer: "L2",
      kind: "RELATIONSHIP_ADDED",
      confirmation: validConfirmation,
    });
    expect(decision.status).toBe("APPLIED");
    if (decision.status !== "APPLIED") return;
    expect(decision.decisionStatus).toBe("CONFIRMED");
    expect(decision.proposedSeverity).toBe("MINOR");
    expect(decision.effectiveSeverity).toBe("MINOR");
    expect(decision.propagation?.staleSeverity).toBe("WARNING");
  });

  it("rejects override on REQUIRE_CONFIRMATION layers", () => {
    expect(() =>
      decideChange({ layer: "L1", kind: "RENAME", override: validOverride }),
    ).toThrow(/REQUIRE_CONFIRMATION/);
  });

  it("confirmation may upgrade or downgrade severity", () => {
    const decision = decideChange({
      layer: "L1",
      kind: "DESCRIPTION_CHANGED", // proposed PATCH
      confirmation: { ...validConfirmation, severity: "MAJOR" },
    });
    if (decision.status !== "APPLIED") throw new Error("should be applied");
    expect(decision.proposedSeverity).toBe("PATCH");
    expect(decision.effectiveSeverity).toBe("MAJOR");
    expect(decision.propagation?.staleSeverity).toBe("ERROR");
  });
});

describe("decideChange — L3/L4 AUTO_WITH_OVERRIDE", () => {
  it("auto-applies proposed severity without override", () => {
    const decision = decideChange({ layer: "L3", kind: "RENAME" });
    if (decision.status !== "APPLIED") throw new Error("should be applied");
    expect(decision.decisionStatus).toBe("AUTO_APPLIED");
    expect(decision.effectiveSeverity).toBe("MAJOR");
    expect(decision.propagation?.staleSeverity).toBe("ERROR");
  });

  it("override switches severity and records rationale", () => {
    const decision = decideChange({
      layer: "L4",
      kind: "RELATIONSHIP_ADDED", // proposed MINOR
      override: validOverride, // overrides to MAJOR
    });
    if (decision.status !== "APPLIED") throw new Error("should be applied");
    expect(decision.decisionStatus).toBe("OVERRIDDEN");
    expect(decision.proposedSeverity).toBe("MINOR");
    expect(decision.effectiveSeverity).toBe("MAJOR");
    expect(decision.override?.rationale.length).toBeGreaterThanOrEqual(
      OVERRIDE_RATIONALE_MIN_CHARS,
    );
  });

  it("rejects override with rationale shorter than 20 chars", () => {
    expect(() =>
      decideChange({
        layer: "L3",
        kind: "RENAME",
        override: { ...validOverride, rationale: "too short" },
      }),
    ).toThrow();
  });

  it("rejects confirmation on AUTO_WITH_OVERRIDE layers", () => {
    expect(() =>
      decideChange({
        layer: "L3",
        kind: "RENAME",
        confirmation: validConfirmation,
      }),
    ).toThrow(/AUTO_WITH_OVERRIDE/);
  });
});

describe("decideChange — L5/L6 AUTO", () => {
  it("auto-applies without override", () => {
    const decision = decideChange({ layer: "L5", kind: "TYPE_CHANGE" });
    if (decision.status !== "APPLIED") throw new Error("should be applied");
    expect(decision.decisionStatus).toBe("AUTO_APPLIED");
    expect(decision.effectiveSeverity).toBe("MAJOR");
  });

  it("allows override but rejects confirmation", () => {
    const decision = decideChange({
      layer: "L6",
      kind: "DESCRIPTION_CHANGED",
      override: { ...validOverride, severity: "MINOR" },
    });
    if (decision.status !== "APPLIED") throw new Error("should be applied");
    expect(decision.decisionStatus).toBe("OVERRIDDEN");
    expect(decision.effectiveSeverity).toBe("MINOR");

    expect(() =>
      decideChange({
        layer: "L5",
        kind: "RENAME",
        confirmation: validConfirmation,
      }),
    ).toThrow(/AUTO/);
  });
});

describe("decideChange — invariants", () => {
  it("rejects override and confirmation supplied together", () => {
    expect(() =>
      decideChange({
        layer: "L3",
        kind: "RENAME",
        override: validOverride,
        confirmation: validConfirmation,
      }),
    ).toThrow(/either override OR confirmation/);
  });
});
