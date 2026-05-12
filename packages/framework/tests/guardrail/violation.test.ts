// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  SUPPRESSION_MAX_DAYS,
  SuppressionSchema,
  ViolationSchema,
  ViolationStatusSchema,
  ViolationTransitionError,
  assertViolationTransition,
  canTransitionViolation,
  isSuppressionExpired,
  isTerminalViolationStatus,
  violationStatusSuccessors,
} from "../../src/guardrail";
import type { ViolationStatus } from "../../src/guardrail";

const baseViolation = {
  id: "v-001",
  rule_id: "GR-L1-001",
  object_id: "bg-1",
  object_type: "BusinessCapability",
  severity: "ERROR" as const,
  status: "OPEN" as const,
  detectedAt: "2026-04-01T10:00:00.000Z",
  message: "Capability has no traces-to BusinessGoal",
};

describe("ViolationStatusSchema", () => {
  it.each([
    "DETECTED",
    "OPEN",
    "ACKNOWLEDGED",
    "IN_PROGRESS",
    "RESOLVED",
    "SUPPRESSED",
  ])("accepts %s", (status) => {
    expect(() => ViolationStatusSchema.parse(status)).not.toThrow();
  });

  it("rejects unknown status", () => {
    expect(() => ViolationStatusSchema.parse("CLOSED")).toThrow();
  });
});

describe("ViolationSchema", () => {
  it("accepts a normal OPEN violation without suppression", () => {
    expect(() => ViolationSchema.parse(baseViolation)).not.toThrow();
  });

  it("requires suppression metadata when status is SUPPRESSED", () => {
    expect(() =>
      ViolationSchema.parse({ ...baseViolation, status: "SUPPRESSED" }),
    ).toThrow(/SUPPRESSED violations must include suppression metadata/);
  });

  it("rejects suppression metadata on non-SUPPRESSED status", () => {
    expect(() =>
      ViolationSchema.parse({
        ...baseViolation,
        status: "OPEN",
        suppression: {
          rationale: "Approved by security council pending vendor migration.",
          suppressedAt: "2026-04-01T10:00:00.000Z",
          expiresAt: "2026-05-01T10:00:00.000Z",
          suppressedBy: "user:alice",
        },
      }),
    ).toThrow(/suppression metadata is only valid for SUPPRESSED status/);
  });

  it("accepts SUPPRESSED with valid suppression", () => {
    expect(() =>
      ViolationSchema.parse({
        ...baseViolation,
        status: "SUPPRESSED",
        suppression: {
          rationale: "Approved by security council pending vendor migration.",
          suppressedAt: "2026-04-01T10:00:00.000Z",
          expiresAt: "2026-05-01T10:00:00.000Z",
          suppressedBy: "user:alice",
        },
      }),
    ).not.toThrow();
  });
});

describe("SuppressionSchema", () => {
  const validSuppression = {
    rationale: "Documented and signed-off vendor migration window.",
    suppressedAt: "2026-04-01T10:00:00.000Z",
    expiresAt: "2026-05-01T10:00:00.000Z",
    suppressedBy: "user:alice",
  };

  it("accepts a 30-day suppression", () => {
    expect(() => SuppressionSchema.parse(validSuppression)).not.toThrow();
  });

  it("rejects rationale shorter than 20 chars", () => {
    expect(() =>
      SuppressionSchema.parse({ ...validSuppression, rationale: "ok" }),
    ).toThrow();
  });

  it("rejects suppression window > 90 days", () => {
    expect(() =>
      SuppressionSchema.parse({
        ...validSuppression,
        suppressedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-06-01T00:00:00.000Z",
      }),
    ).toThrow(/≤ 90 days/);
  });

  it("rejects expiresAt before suppressedAt", () => {
    expect(() =>
      SuppressionSchema.parse({
        ...validSuppression,
        suppressedAt: "2026-04-01T00:00:00.000Z",
        expiresAt: "2026-03-01T00:00:00.000Z",
      }),
    ).toThrow(/expiresAt must be after suppressedAt/);
  });

  it("accepts exactly the 90-day boundary", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date(start.getTime() + SUPPRESSION_MAX_DAYS * 24 * 60 * 60 * 1000);
    expect(() =>
      SuppressionSchema.parse({
        ...validSuppression,
        suppressedAt: start.toISOString(),
        expiresAt: end.toISOString(),
      }),
    ).not.toThrow();
  });
});

describe("canTransitionViolation", () => {
  it("allows OPEN → ACKNOWLEDGED → IN_PROGRESS → RESOLVED", () => {
    expect(canTransitionViolation("OPEN", "ACKNOWLEDGED")).toBe(true);
    expect(canTransitionViolation("ACKNOWLEDGED", "IN_PROGRESS")).toBe(true);
    expect(canTransitionViolation("IN_PROGRESS", "RESOLVED")).toBe(true);
  });

  it("allows OPEN → SUPPRESSED and SUPPRESSED → OPEN", () => {
    expect(canTransitionViolation("OPEN", "SUPPRESSED")).toBe(true);
    expect(canTransitionViolation("SUPPRESSED", "OPEN")).toBe(true);
  });

  it("forbids leaving RESOLVED", () => {
    expect(canTransitionViolation("RESOLVED", "OPEN")).toBe(false);
    expect(canTransitionViolation("RESOLVED", "ACKNOWLEDGED")).toBe(false);
  });

  it("forbids skipping straight from DETECTED to ACKNOWLEDGED", () => {
    expect(canTransitionViolation("DETECTED", "ACKNOWLEDGED")).toBe(false);
  });
});

describe("assertViolationTransition", () => {
  it("returns void for legal transitions", () => {
    expect(() => assertViolationTransition("OPEN", "ACKNOWLEDGED")).not.toThrow();
    expect(() => assertViolationTransition("SUPPRESSED", "OPEN")).not.toThrow();
  });

  it("throws ViolationTransitionError for illegal transitions", () => {
    expect(() => assertViolationTransition("RESOLVED", "OPEN")).toThrow(
      ViolationTransitionError,
    );
  });

  it("error carries from/to and a descriptive message", () => {
    try {
      assertViolationTransition("DETECTED", "ACKNOWLEDGED");
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ViolationTransitionError);
      const e = err as ViolationTransitionError;
      expect(e.from).toBe("DETECTED");
      expect(e.to).toBe("ACKNOWLEDGED");
      expect(e.name).toBe("ViolationTransitionError");
      expect(e.message).toMatch(/DETECTED.*ACKNOWLEDGED/);
    }
  });
});

describe("violationStatusSuccessors", () => {
  it("returns the legal next statuses for OPEN", () => {
    expect([...violationStatusSuccessors("OPEN")].sort()).toEqual(
      ["ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "SUPPRESSED"].sort(),
    );
  });

  it("returns empty for terminal RESOLVED", () => {
    expect(violationStatusSuccessors("RESOLVED")).toEqual([]);
  });

  it("stays consistent with canTransitionViolation for every status", () => {
    const all: ViolationStatus[] = [
      "DETECTED",
      "OPEN",
      "ACKNOWLEDGED",
      "IN_PROGRESS",
      "RESOLVED",
      "SUPPRESSED",
    ];
    for (const from of all) {
      const successors = new Set(violationStatusSuccessors(from));
      for (const to of all) {
        expect(canTransitionViolation(from, to)).toBe(successors.has(to));
      }
    }
  });
});

describe("isTerminalViolationStatus", () => {
  it("returns true for RESOLVED", () => {
    expect(isTerminalViolationStatus("RESOLVED")).toBe(true);
  });

  it("returns false for every non-RESOLVED status", () => {
    for (const status of [
      "DETECTED",
      "OPEN",
      "ACKNOWLEDGED",
      "IN_PROGRESS",
      "SUPPRESSED",
    ] as const) {
      expect(isTerminalViolationStatus(status)).toBe(false);
    }
  });
});

describe("isSuppressionExpired", () => {
  const suppression = {
    rationale: "Documented and signed-off vendor migration window.",
    suppressedAt: "2026-04-01T10:00:00.000Z",
    expiresAt: "2026-05-01T10:00:00.000Z",
    suppressedBy: "user:alice",
  };

  it("returns true after expiresAt", () => {
    expect(isSuppressionExpired(suppression, new Date("2026-06-01T00:00:00.000Z"))).toBe(true);
  });

  it("returns false before expiresAt", () => {
    expect(isSuppressionExpired(suppression, new Date("2026-04-15T00:00:00.000Z"))).toBe(false);
  });

  it("returns true exactly at expiresAt", () => {
    expect(isSuppressionExpired(suppression, new Date("2026-05-01T10:00:00.000Z"))).toBe(true);
  });
});
