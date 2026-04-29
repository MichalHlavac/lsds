import { describe, expect, it } from "vitest";
import { RunbookSchema } from "../../../src/types/l6/runbook.js";
import { expectIssue, sampleTeam } from "../../fixtures.js";
import { tknBase } from "./_fixtures.js";

const baseRunbook = {
  ...tknBase({ type: "Runbook", layer: "L6", name: "checkout-api-down" }),
  title: "Checkout API down",
  triggerCondition: "PagerDuty fires on AVAILABILITY SLO breach > 5 minutes.",
  severity: "P1" as const,
  steps: [
    { order: 1, action: "Check upstream payment provider status page." },
    { order: 2, action: "If provider is up, fail over to standby region per ADR-007." },
  ],
  owner: sampleTeam,
};

describe("Runbook (kap. 4 § L6)", () => {
  it("accepts a fully populated runbook", () => {
    expect(RunbookSchema.parse(baseRunbook)).toMatchObject({ type: "Runbook", severity: "P1" });
  });

  it("rejects fewer than 2 steps", () => {
    expectIssue(
      RunbookSchema.safeParse({
        ...baseRunbook,
        steps: [{ order: 1, action: "Page on-call." }],
      }),
      /at least 2 ordered steps/,
    );
  });

  it("rejects out-of-order step numbers", () => {
    expectIssue(
      RunbookSchema.safeParse({
        ...baseRunbook,
        steps: [
          { order: 1, action: "First action." },
          { order: 3, action: "Skipped step 2." },
        ],
      }),
      /must be 2/,
    );
  });

  it("rejects empty step action", () => {
    expectIssue(
      RunbookSchema.safeParse({
        ...baseRunbook,
        steps: [
          { order: 1, action: "" },
          { order: 2, action: "Second." },
        ],
      }),
      /must describe a concrete operator action/,
    );
  });

  it("rejects unknown severity", () => {
    expectIssue(RunbookSchema.safeParse({ ...baseRunbook, severity: "P0" }), /Invalid enum value/);
  });

  it("accepts optional lastTested ISO date and ISO-duration estimatedResolutionTime", () => {
    const parsed = RunbookSchema.parse({
      ...baseRunbook,
      lastTested: "2026-04-01",
      estimatedResolutionTime: "PT15M",
    });
    expect(parsed.lastTested).toBe("2026-04-01");
    expect(parsed.estimatedResolutionTime).toBe("PT15M");
  });
});
