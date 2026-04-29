// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import { AlertSchema } from "../../../src/types/l6/alert.js";
import { expectIssue, sampleTeam } from "../../fixtures.js";
import { tknBase } from "./_fixtures.js";

const sampleRunbookRef = {
  kind: "runbook" as const,
  id: "55555555-5555-4555-8555-555555555555",
};

const baseAlert = {
  ...tknBase({ type: "Alert", layer: "L6", name: "checkout-availability-breach" }),
  condition: "checkout-api availability < 99.5% for 5 minutes (SLO breach).",
  severity: "CRITICAL" as const,
  runbookReference: sampleRunbookRef,
  owner: sampleTeam,
};

describe("Alert (kap. 4 § L6)", () => {
  it("accepts a fully populated alert", () => {
    expect(AlertSchema.parse(baseAlert)).toMatchObject({ type: "Alert", severity: "CRITICAL" });
  });

  it("requires runbookReference (kap. 4 § L6 invariant: every alert MUST have a runbook)", () => {
    const { runbookReference: _omit, ...withoutRef } = baseAlert;
    expectIssue(AlertSchema.safeParse(withoutRef as unknown as typeof baseAlert), /Required/);
  });

  it("rejects runbookReference with non-UUID id", () => {
    expectIssue(
      AlertSchema.safeParse({
        ...baseAlert,
        runbookReference: { kind: "runbook", id: "not-a-uuid" },
      }),
      /uuid/i,
    );
  });

  it("rejects empty condition", () => {
    expectIssue(
      AlertSchema.safeParse({ ...baseAlert, condition: "" }),
      /must describe the metric\/threshold/,
    );
  });

  it("rejects unknown severity", () => {
    expectIssue(AlertSchema.safeParse({ ...baseAlert, severity: "URGENT" }), /Invalid enum value/);
  });

  it("rejects layer other than L6", () => {
    expectIssue(AlertSchema.safeParse({ ...baseAlert, layer: "L5" }), /Invalid literal value/);
  });
});
