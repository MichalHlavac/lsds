import { describe, expect, it } from "vitest";
import {
  AcceptanceCriterionSchema,
  ImpactSchema,
  REQUIREMENT_TRAVERSAL_WEIGHT,
  RequirementSchema,
} from "../../../src/types/l1/requirement.js";
import { expectIssue, sampleTeam, tknBase } from "../../fixtures.js";

const validAcceptanceCriterion = {
  id: "AC-001",
  description: "Onboarding completes in under 5 minutes for ≥95% of new sign-ups.",
  type: "FUNCTIONAL",
  status: "PENDING",
} as const;

const validImpactCreate = {
  target: null,
  changeType: "CREATE",
  description: "Introduce a new BoundedContext for self-service onboarding.",
} as const;

const validImpactModify = {
  target: { kind: "tkn", type: "BoundedContext", id: "22222222-2222-4222-8222-222222222222" },
  changeType: "MODIFY",
  description: "Add invite-only signup flag to existing onboarding context.",
} as const;

const baseRequirement = {
  ...tknBase({ type: "Requirement", layer: "L1", name: "Self-service onboarding" }),
  description: "Allow customers to onboard without a sales call.",
  motivation: "Sales-led onboarding does not scale beyond 50 signups/week.",
  requirementType: "FUNCTIONAL",
  priority: "MUST",
  source: "Q2 2026 OKR — onboarding throughput",
  status: "APPROVED",
  owner: sampleTeam,
  acceptanceCriteria: [validAcceptanceCriterion],
  impacts: [validImpactCreate, validImpactModify],
} as const;

describe("Requirement (kap. 4 § Requirement, A5)", () => {
  it("accepts a well-formed requirement", () => {
    expect(RequirementSchema.parse(baseRequirement).type).toBe("Requirement");
  });

  it("rejects requirement without motivation (structural guardrail)", () => {
    expectIssue(
      RequirementSchema.safeParse({ ...baseRequirement, motivation: "" }),
      "Requirement.motivation is required",
    );
  });

  it("rejects empty acceptanceCriteria (kap. 4 invariant)", () => {
    expectIssue(
      RequirementSchema.safeParse({ ...baseRequirement, acceptanceCriteria: [] }),
      "acceptanceCriteria must contain at least one",
    );
  });

  it("rejects unknown requirementType", () => {
    expectIssue(
      RequirementSchema.safeParse({ ...baseRequirement, requirementType: "WISHFUL" }),
      /Invalid enum value/,
    );
  });

  it("declares LAZY traversal weight (kap. 4)", () => {
    expect(REQUIREMENT_TRAVERSAL_WEIGHT).toBe("LAZY");
  });
});

describe("AcceptanceCriterion (kap. 4 § Requirement)", () => {
  it("accepts a minimal criterion", () => {
    expect(AcceptanceCriterionSchema.parse(validAcceptanceCriterion).id).toBe("AC-001");
  });

  it("accepts validatedBy TestRef", () => {
    const parsed = AcceptanceCriterionSchema.parse({
      ...validAcceptanceCriterion,
      validatedBy: { kind: "test", id: "33333333-3333-4333-8333-333333333333" },
    });
    expect(parsed.validatedBy?.kind).toBe("test");
  });

  it("rejects ids that do not match AC-<n>", () => {
    expectIssue(
      AcceptanceCriterionSchema.safeParse({ ...validAcceptanceCriterion, id: "criterion-1" }),
      /AC-<number>/,
    );
  });
});

describe("Impact (kap. 4 § Requirement Impact)", () => {
  it("accepts CREATE with null target", () => {
    expect(ImpactSchema.parse(validImpactCreate).changeType).toBe("CREATE");
  });

  it("accepts MODIFY referencing an existing target", () => {
    expect(ImpactSchema.parse(validImpactModify).target?.type).toBe("BoundedContext");
  });

  it("rejects null target with non-CREATE changeType", () => {
    expectIssue(
      ImpactSchema.safeParse({
        target: null,
        changeType: "MODIFY",
        description: "needs target",
      }),
      "may only be null when changeType is CREATE",
    );
  });
});
