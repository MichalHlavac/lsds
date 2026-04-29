// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import { BusinessProcessSchema } from "../../../src/types/l1/business-process.js";
import { expectIssue, sampleTeam, tknBase } from "../../fixtures.js";

const baseProcess = {
  ...tknBase({ type: "BusinessProcess", layer: "L1", name: "Customer Activation" }),
  steps: [
    { order: 1, name: "Sign-up" },
    { order: 2, name: "Email verification" },
    { order: 3, name: "First successful action" },
  ],
  owner: sampleTeam,
  outcomes: ["Customer reaches first value moment"],
} as const;

describe("BusinessProcess (kap. 4 § L1)", () => {
  it("accepts a process with ≥2 steps and ≥1 outcome", () => {
    expect(BusinessProcessSchema.parse(baseProcess).steps).toHaveLength(3);
  });

  it("rejects fewer than two steps (kap. 4 invariant)", () => {
    expectIssue(
      BusinessProcessSchema.safeParse({ ...baseProcess, steps: [{ order: 1, name: "Solo step" }] }),
      "must contain at least two steps",
    );
  });

  it("rejects empty outcomes (kap. 4 invariant)", () => {
    expectIssue(
      BusinessProcessSchema.safeParse({ ...baseProcess, outcomes: [] }),
      "must contain at least one outcome",
    );
  });

  it("rejects negative step order", () => {
    expectIssue(
      BusinessProcessSchema.safeParse({
        ...baseProcess,
        steps: [
          { order: -1, name: "Bad step" },
          { order: 0, name: "Other step" },
        ],
      }),
      /nonnegative|greater than or equal to 0/,
    );
  });
});
