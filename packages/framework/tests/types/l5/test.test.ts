import { describe, expect, it } from "vitest";
import { TestSchema } from "../../../src/types/l5/test.js";
import { expectIssue } from "../../fixtures.js";
import { sampleRepo, tknBase } from "./_fixtures.js";

const baseTest = {
  ...tknBase({ type: "Test", layer: "L5", name: "framework guardrail catalog tests" }),
  testType: "UNIT" as const,
  scopeDescription: "Asserts every guardrail in the catalog round-trips through GuardrailRuleSchema.",
  repoRef: sampleRepo,
  ciIntegration: true,
};

describe("Test (kap. 4 § L5)", () => {
  it("accepts a fully populated test entry", () => {
    expect(TestSchema.parse(baseTest)).toMatchObject({ type: "Test", layer: "L5", testType: "UNIT" });
  });

  it("rejects empty scopeDescription", () => {
    expectIssue(
      TestSchema.safeParse({ ...baseTest, scopeDescription: "" }),
      /must state what the test covers/,
    );
  });

  it("rejects unknown testType (closed enum)", () => {
    expectIssue(TestSchema.safeParse({ ...baseTest, testType: "FUZZ" }), /Invalid enum value/);
  });

  it("rejects layer other than L5", () => {
    expectIssue(TestSchema.safeParse({ ...baseTest, layer: "L4" }), /Invalid literal value/);
  });

  it("requires ciIntegration to be a boolean (no truthy strings)", () => {
    expectIssue(
      TestSchema.safeParse({ ...baseTest, ciIntegration: "yes" as unknown as boolean }),
      /Expected boolean/,
    );
  });
});
