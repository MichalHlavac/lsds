import { describe, expect, it } from "vitest";
import { BusinessGoalSchema } from "../../../src/types/l1/business-goal.js";
import { expectIssue, sampleTeam, tknBase } from "../../fixtures.js";

const baseGoal = {
  ...tknBase({ type: "BusinessGoal", layer: "L1", name: "Reach $10M ARR by FY27" }),
  description:
    "Reach annual recurring revenue of $10M by end of FY27 by expanding into the EU mid-market segment.",
  owner: sampleTeam,
  timeHorizon: "MEDIUM",
  successMetrics: ["ARR ≥ $10M", "EU customers ≥ 40"],
  status: "ACTIVE",
} as const;

describe("BusinessGoal (kap. 4 § L1)", () => {
  it("accepts a fully populated goal", () => {
    expect(BusinessGoalSchema.parse(baseGoal)).toMatchObject({ type: "BusinessGoal", layer: "L1" });
  });

  it("accepts optional priority", () => {
    expect(BusinessGoalSchema.parse({ ...baseGoal, priority: "P2" }).priority).toBe("P2");
  });

  it("rejects empty successMetrics (kap. 4 invariant)", () => {
    expectIssue(
      BusinessGoalSchema.safeParse({ ...baseGoal, successMetrics: [] }),
      "successMetrics must contain at least one metric",
    );
  });

  it("rejects name longer than 100 chars", () => {
    expectIssue(
      BusinessGoalSchema.safeParse({ ...baseGoal, name: "x".repeat(101) }),
      /at most 100|too_big|String must contain at most 100/,
    );
  });

  it("rejects description shorter than 50 chars", () => {
    expectIssue(BusinessGoalSchema.safeParse({ ...baseGoal, description: "too short" }), /at least 50/);
  });

  it("rejects unknown timeHorizon", () => {
    expectIssue(
      BusinessGoalSchema.safeParse({ ...baseGoal, timeHorizon: "ETERNAL" }),
      /Invalid enum value/,
    );
  });

  it("rejects layer other than L1", () => {
    expectIssue(BusinessGoalSchema.safeParse({ ...baseGoal, layer: "L2" }), /Invalid literal value/);
  });

  it("accepts explicit isLeaf=true (kap. 4 § L1, GR-L1-BG-001)", () => {
    expect(BusinessGoalSchema.parse({ ...baseGoal, isLeaf: true }).isLeaf).toBe(true);
  });

  it("defaults isLeaf to false when omitted (kap. 4 § L1)", () => {
    expect(BusinessGoalSchema.parse(baseGoal).isLeaf).toBe(false);
  });

  it("accepts optional lastReviewDate as ISO date (kap. 4 § L1, GR-L1-007)", () => {
    expect(
      BusinessGoalSchema.parse({ ...baseGoal, lastReviewDate: "2026-04-01" }).lastReviewDate,
    ).toBe("2026-04-01");
  });

  it("rejects lastReviewDate that is not ISO date (kap. 4 § L1)", () => {
    expectIssue(
      BusinessGoalSchema.safeParse({ ...baseGoal, lastReviewDate: "April 1, 2026" }),
      /lastReviewDate must be ISO date/,
    );
  });
});
