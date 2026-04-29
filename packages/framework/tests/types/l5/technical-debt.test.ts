// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import { TechnicalDebtSchema } from "../../../src/types/l5/technical-debt.js";
import { expectIssue } from "../../fixtures.js";
import { tknBase } from "./_fixtures.js";

const baseDebt = {
  ...tknBase({ type: "TechnicalDebt", layer: "L5", name: "Inline JSON cache" }),
  title: "Inline JSON cache instead of Redis",
  description: "Cache layer holds JSON in-process so the API ships before Redis is provisioned.",
  debtType: "DESIGN" as const,
  impact: "Cache loss on every restart, no horizontal scale.",
  estimatedEffort: "MEDIUM" as const,
  interestRate: "MEDIUM" as const,
  rationale: "Provisioning Redis was blocked behind a billing approval; this kept the launch on schedule.",
  status: "OPEN" as const,
};

describe("TechnicalDebt (kap. 4 § L5)", () => {
  it("accepts a fully populated debt entry", () => {
    expect(TechnicalDebtSchema.parse(baseDebt)).toMatchObject({
      type: "TechnicalDebt",
      layer: "L5",
    });
  });

  it("rejects rationale shorter than 20 characters (structural guardrail kap. 5)", () => {
    expectIssue(
      TechnicalDebtSchema.safeParse({ ...baseDebt, rationale: "TODO" }),
      /must explain why the trade-off was accepted/,
    );
  });

  it("rejects empty impact", () => {
    expectIssue(
      TechnicalDebtSchema.safeParse({ ...baseDebt, impact: "" }),
      /must describe the concrete consequence/,
    );
  });

  it("rejects unknown debtType", () => {
    expectIssue(
      TechnicalDebtSchema.safeParse({ ...baseDebt, debtType: "PROCESS" }),
      /Invalid enum value/,
    );
  });

  it("rejects unknown estimatedEffort", () => {
    expectIssue(
      TechnicalDebtSchema.safeParse({ ...baseDebt, estimatedEffort: "TINY" }),
      /Invalid enum value/,
    );
  });

  it("rejects layer other than L5", () => {
    expectIssue(TechnicalDebtSchema.safeParse({ ...baseDebt, layer: "L4" }), /Invalid literal value/);
  });

  it("accepts optional targetResolution as ISO date", () => {
    expect(
      TechnicalDebtSchema.parse({ ...baseDebt, targetResolution: "2026-12-31" }).targetResolution,
    ).toBe("2026-12-31");
  });
});
