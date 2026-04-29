import { describe, expect, it } from "vitest";
import {
  QUALITY_ATTRIBUTE_CATEGORIES,
  QUALITY_ATTRIBUTE_PRIORITIES,
  QUALITY_ATTRIBUTE_TRAVERSAL_WEIGHT,
  QualityAttributeSchema,
} from "../../../src/types/l3/quality-attribute.js";
import { expectIssue } from "../../fixtures.js";
import { tknBase } from "./_fixtures.js";

const baseQa = {
  ...tknBase({ type: "QualityAttribute", layer: "L3", name: "API p99 latency" }),
  category: "PERFORMANCE",
  requirement: "API p99 latency must stay under 250ms at 1k RPS sustained.",
  measurement: "Prometheus histogram quantile(0.99, http_request_duration_seconds).",
  priority: "MUST",
} as const;

describe("QualityAttribute (kap. 4 § L3)", () => {
  it("accepts a fully populated quality attribute", () => {
    expect(QualityAttributeSchema.parse(baseQa)).toMatchObject({
      type: "QualityAttribute",
      layer: "L3",
      category: "PERFORMANCE",
      priority: "MUST",
    });
  });

  it("rejects measurement shorter than 20 chars", () => {
    expectIssue(
      QualityAttributeSchema.safeParse({ ...baseQa, measurement: "p99 < 250ms" }),
      /how it is measured/,
    );
  });

  it("rejects requirement shorter than 20 chars", () => {
    expectIssue(
      QualityAttributeSchema.safeParse({ ...baseQa, requirement: "fast" }),
      /measurable/,
    );
  });

  it("rejects unknown category (closed enum)", () => {
    expectIssue(
      QualityAttributeSchema.safeParse({ ...baseQa, category: "GREEN_IT" }),
      /Invalid enum value/,
    );
  });

  it("rejects unknown priority", () => {
    expectIssue(
      QualityAttributeSchema.safeParse({ ...baseQa, priority: "NICE_TO_HAVE" }),
      /Invalid enum value/,
    );
  });

  it("rejects layer other than L3", () => {
    expectIssue(QualityAttributeSchema.safeParse({ ...baseQa, layer: "L2" }), /Invalid literal value/);
  });

  it("declares EAGER traversal weight", () => {
    expect(QUALITY_ATTRIBUTE_TRAVERSAL_WEIGHT).toBe("EAGER");
  });

  it("exposes 7 categories and 3 priorities (kap. 4 closed enums)", () => {
    expect(QUALITY_ATTRIBUTE_CATEGORIES).toHaveLength(7);
    expect(QUALITY_ATTRIBUTE_PRIORITIES).toEqual(["MUST", "SHOULD", "COULD"]);
  });
});
