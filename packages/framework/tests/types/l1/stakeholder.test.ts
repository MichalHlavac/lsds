// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import { StakeholderSchema } from "../../../src/types/l1/stakeholder.js";
import { expectIssue, tknBase } from "../../fixtures.js";

const baseStakeholder = {
  ...tknBase({ type: "Stakeholder", layer: "L1", name: "VP Product" }),
  role: "VP Product",
  interestDescription: "Owns roadmap and outcome targets for the platform.",
  influenceLevel: "HIGH",
} as const;

describe("Stakeholder (kap. 4 § L1)", () => {
  it("accepts a populated stakeholder", () => {
    expect(StakeholderSchema.parse(baseStakeholder).influenceLevel).toBe("HIGH");
  });

  it("rejects unknown influenceLevel", () => {
    expectIssue(
      StakeholderSchema.safeParse({ ...baseStakeholder, influenceLevel: "MASSIVE" }),
      /Invalid enum value/,
    );
  });

  it("rejects empty role", () => {
    expectIssue(
      StakeholderSchema.safeParse({ ...baseStakeholder, role: "" }),
      /at least 1/,
    );
  });
});
