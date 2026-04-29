import { describe, expect, it } from "vitest";
import { BusinessCapabilitySchema } from "../../../src/types/l1/business-capability.js";
import { expectIssue, sampleTeam, tknBase } from "../../fixtures.js";

const baseCapability = {
  ...tknBase({ type: "BusinessCapability", layer: "L1", name: "Customer Onboarding" }),
  description: "Process of bringing new B2B customers from contract to first activation.",
  owner: sampleTeam,
  maturity: "DEFINED",
  businessValue: "CORE",
} as const;

describe("BusinessCapability (kap. 4 § L1)", () => {
  it("accepts a fully populated capability", () => {
    expect(BusinessCapabilitySchema.parse(baseCapability).type).toBe("BusinessCapability");
  });

  it("rejects unknown maturity level", () => {
    expectIssue(
      BusinessCapabilitySchema.safeParse({ ...baseCapability, maturity: "AMAZING" }),
      /Invalid enum value/,
    );
  });

  it("rejects unknown businessValue", () => {
    expectIssue(
      BusinessCapabilitySchema.safeParse({ ...baseCapability, businessValue: "STRATEGIC" }),
      /Invalid enum value/,
    );
  });

  it("rejects missing owner", () => {
    const { owner: _drop, ...withoutOwner } = baseCapability;
    expectIssue(BusinessCapabilitySchema.safeParse(withoutOwner), /Required/);
  });
});
