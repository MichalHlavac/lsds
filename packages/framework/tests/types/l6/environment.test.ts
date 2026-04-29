// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  ACCESS_RESTRICTIONS,
  ENVIRONMENT_TRAVERSAL_WEIGHT,
  ENVIRONMENT_TYPES,
  EnvironmentSchema,
} from "../../../src/types/l6/environment.js";
import { expectIssue, sampleTeam } from "../../fixtures.js";
import { sampleRepo, tknBase } from "./_fixtures.js";

const baseEnv = {
  ...tknBase({ type: "Environment", layer: "L6", name: "production-eu" }),
  description: "Primary EU production environment for the LSDS API.",
  environmentType: "PRODUCTION" as const,
  owner: sampleTeam,
  accessRestriction: "APPROVALS_REQUIRED" as const,
  promotionGate: "Green canary for 30 minutes; on-call sign-off required.",
  iacReference: sampleRepo,
};

describe("Environment (kap. 4 § L6)", () => {
  it("accepts a fully populated PRODUCTION environment", () => {
    expect(EnvironmentSchema.parse(baseEnv)).toMatchObject({
      type: "Environment",
      layer: "L6",
      environmentType: "PRODUCTION",
    });
  });

  it("accepts a DEVELOPMENT environment without iacReference or promotionGate", () => {
    const parsed = EnvironmentSchema.parse({
      ...baseEnv,
      environmentType: "DEVELOPMENT",
      accessRestriction: "UNRESTRICTED",
      promotionGate: undefined,
      iacReference: undefined,
    });
    expect(parsed.environmentType).toBe("DEVELOPMENT");
    expect(parsed.iacReference).toBeUndefined();
  });

  it("rejects PRODUCTION without iacReference (GR-L6-006)", () => {
    expectIssue(
      EnvironmentSchema.safeParse({ ...baseEnv, iacReference: undefined }),
      /iacReference is required for environmentType=PRODUCTION/,
    );
  });

  it("rejects DR without iacReference (GR-L6-006)", () => {
    expectIssue(
      EnvironmentSchema.safeParse({
        ...baseEnv,
        environmentType: "DR",
        iacReference: undefined,
      }),
      /iacReference is required for environmentType=DR/,
    );
  });

  it("rejects PRODUCTION without promotionGate (GR-L6-007)", () => {
    expectIssue(
      EnvironmentSchema.safeParse({ ...baseEnv, promotionGate: undefined }),
      /promotionGate is required for environmentType=PRODUCTION/,
    );
  });

  it("rejects PRODUCTION with whitespace-only promotionGate", () => {
    expectIssue(
      EnvironmentSchema.safeParse({ ...baseEnv, promotionGate: "   " }),
      /promotionGate is required for environmentType=PRODUCTION/,
    );
  });

  it("rejects unknown environmentType (closed enum)", () => {
    expectIssue(
      EnvironmentSchema.safeParse({ ...baseEnv, environmentType: "QA" }),
      /Invalid enum value/,
    );
  });

  it("rejects unknown accessRestriction (closed enum)", () => {
    expectIssue(
      EnvironmentSchema.safeParse({ ...baseEnv, accessRestriction: "PUBLIC" }),
      /Invalid enum value/,
    );
  });

  it("rejects empty description", () => {
    expectIssue(
      EnvironmentSchema.safeParse({ ...baseEnv, description: "" }),
      /description must describe what runs in this environment/,
    );
  });

  it("rejects layer mismatch", () => {
    expectIssue(
      EnvironmentSchema.safeParse({ ...baseEnv, layer: "L5" }),
      /Invalid literal value/,
    );
  });

  it("declares EAGER traversal weight", () => {
    expect(ENVIRONMENT_TRAVERSAL_WEIGHT).toBe("EAGER");
  });

  it("exposes 5 environment types and 3 access restrictions (closed enums)", () => {
    expect(ENVIRONMENT_TYPES).toHaveLength(5);
    expect(ACCESS_RESTRICTIONS).toHaveLength(3);
  });
});
