import { describe, expect, it } from "vitest";
import { SloSchema } from "../../../src/types/l6/slo.js";
import { expectIssue, sampleTeam } from "../../fixtures.js";
import { tknBase } from "../l6/_fixtures.js";

const baseSlo = {
  ...tknBase({ type: "SLO", layer: "L6", name: "API availability — checkout" }),
  sloType: "AVAILABILITY" as const,
  target: 99.9,
  targetUnit: "%",
  window: "P30D",
  measurementMethod: "Prometheus blackbox probe over the public /healthz endpoint, scraped every 15s.",
  owner: sampleTeam,
};

describe("SLO (kap. 4 § L6)", () => {
  it("accepts a fully populated availability SLO", () => {
    expect(SloSchema.parse(baseSlo)).toMatchObject({ type: "SLO", sloType: "AVAILABILITY" });
  });

  it("accepts ISO durations PT1H and P1Y", () => {
    expect(SloSchema.parse({ ...baseSlo, window: "PT1H" }).window).toBe("PT1H");
    expect(SloSchema.parse({ ...baseSlo, window: "P1Y" }).window).toBe("P1Y");
  });

  it("rejects an invalid duration string", () => {
    expectIssue(SloSchema.safeParse({ ...baseSlo, window: "30 days" }), /ISO-8601 duration/);
  });

  it("rejects AVAILABILITY target outside [0, 100]", () => {
    expectIssue(SloSchema.safeParse({ ...baseSlo, target: 101 }), /percentage in \[0, 100\]/);
  });

  it("rejects negative LATENCY target", () => {
    expectIssue(
      SloSchema.safeParse({ ...baseSlo, sloType: "LATENCY", target: -5, targetUnit: "ms" }),
      /must be non-negative/,
    );
  });

  it("rejects empty measurementMethod", () => {
    expectIssue(SloSchema.safeParse({ ...baseSlo, measurementMethod: "" }), /must describe how the metric is collected/);
  });

  it("rejects unknown sloType", () => {
    expectIssue(SloSchema.safeParse({ ...baseSlo, sloType: "FRESHNESS" }), /Invalid enum value/);
  });
});
