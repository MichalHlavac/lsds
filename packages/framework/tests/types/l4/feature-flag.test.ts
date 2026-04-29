import { describe, expect, it } from "vitest";
import {
  FEATURE_FLAG_KINDS,
  FEATURE_FLAG_LIFECYCLE_PLANS,
  FEATURE_FLAG_TRAVERSAL_WEIGHT,
  FeatureFlagSchema,
} from "../../../src/types/l4/feature-flag.js";
import { expectIssue, sampleTeam } from "../../fixtures.js";
import { tknBase } from "./_fixtures.js";

const baseFlag = {
  ...tknBase({ type: "FeatureFlag", layer: "L4", name: "billing.new_invoice_view" }),
  key: "billing.new_invoice_view",
  description: "Toggles the redesigned invoice detail page.",
  kind: "RELEASE" as const,
  defaultValue: false,
  owner: sampleTeam,
  lifecyclePlan: "TEMPORARY" as const,
  expiresAt: "2026-12-31",
};

describe("FeatureFlag (kap. 4 § L4)", () => {
  it("accepts a fully populated TEMPORARY release flag", () => {
    expect(FeatureFlagSchema.parse(baseFlag)).toMatchObject({
      type: "FeatureFlag",
      layer: "L4",
      lifecyclePlan: "TEMPORARY",
    });
  });

  it("requires expiresAt when lifecyclePlan=TEMPORARY", () => {
    const { expiresAt: _omit, ...without } = baseFlag;
    expectIssue(
      FeatureFlagSchema.safeParse(without),
      /expiresAt is required when lifecyclePlan=TEMPORARY/,
    );
  });

  it("rejects expiresAt when lifecyclePlan=PERMANENT", () => {
    expectIssue(
      FeatureFlagSchema.safeParse({ ...baseFlag, lifecyclePlan: "PERMANENT" }),
      /expiresAt is only valid when lifecyclePlan=TEMPORARY/,
    );
  });

  it("accepts PERMANENT flag without expiresAt", () => {
    const { expiresAt: _omit, ...without } = baseFlag;
    expect(
      FeatureFlagSchema.parse({ ...without, lifecyclePlan: "PERMANENT" }),
    ).toMatchObject({ lifecyclePlan: "PERMANENT" });
  });

  it("rejects malformed key (must be lower_snake with optional dotted namespaces)", () => {
    expectIssue(
      FeatureFlagSchema.safeParse({ ...baseFlag, key: "Billing-NewInvoiceView" }),
      /lower_snake_case/,
    );
  });

  it("accepts string and number defaults (multivariate flags)", () => {
    expect(
      FeatureFlagSchema.parse({ ...baseFlag, defaultValue: "control" }).defaultValue,
    ).toBe("control");
    expect(
      FeatureFlagSchema.parse({ ...baseFlag, defaultValue: 0.25 }).defaultValue,
    ).toBe(0.25);
  });

  it("rejects unknown kind / lifecyclePlan (closed enums)", () => {
    expectIssue(
      FeatureFlagSchema.safeParse({ ...baseFlag, kind: "AB_TEST" }),
      /Invalid enum value/,
    );
    expectIssue(
      FeatureFlagSchema.safeParse({ ...baseFlag, lifecyclePlan: "ETERNAL" }),
      /Invalid enum value/,
    );
  });

  it("rejects malformed expiresAt (must be ISO YYYY-MM-DD)", () => {
    expectIssue(
      FeatureFlagSchema.safeParse({ ...baseFlag, expiresAt: "Q4 2026" }),
      /ISO date/,
    );
  });

  it("declares LAZY traversal weight", () => {
    expect(FEATURE_FLAG_TRAVERSAL_WEIGHT).toBe("LAZY");
  });

  it("exposes 4 kinds and 2 lifecycle plans (kap. 4 closed enums)", () => {
    expect(FEATURE_FLAG_KINDS).toEqual(["RELEASE", "EXPERIMENT", "OPS", "PERMISSION"]);
    expect(FEATURE_FLAG_LIFECYCLE_PLANS).toEqual(["TEMPORARY", "PERMANENT"]);
  });
});
