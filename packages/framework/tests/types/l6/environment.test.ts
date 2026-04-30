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
  ...tknBase({ type: "Environment", layer: "L6", name: "production" }),
  description: "Primary production environment for the LSDS API.",
  environmentType: "PRODUCTION" as const,
  owner: sampleTeam,
  accessRestriction: "APPROVALS_REQUIRED" as const,
  promotionGate: "Smoke tests + manual approval from #ops gate.",
  iacReference: sampleRepo,
};

describe("Environment (kap. 4 § L6, lines 606–635)", () => {
  it("accepts a fully populated PRODUCTION environment", () => {
    expect(EnvironmentSchema.parse(baseEnv)).toMatchObject({
      type: "Environment",
      layer: "L6",
      environmentType: "PRODUCTION",
    });
  });

  it("accepts a STAGING environment without iacReference / promotionGate", () => {
    const parsed = EnvironmentSchema.parse({
      ...baseEnv,
      environmentType: "STAGING",
      promotionGate: undefined,
      iacReference: undefined,
    });
    expect(parsed.environmentType).toBe("STAGING");
    expect(parsed.iacReference).toBeUndefined();
    expect(parsed.promotionGate).toBeUndefined();
  });

  it("requires iacReference for environmentType=PRODUCTION (GR-L6-006)", () => {
    expectIssue(
      EnvironmentSchema.safeParse({ ...baseEnv, iacReference: undefined }),
      /iacReference is required for environmentType=PRODUCTION or DR/,
    );
  });

  it("requires iacReference for environmentType=DR (GR-L6-006)", () => {
    expectIssue(
      EnvironmentSchema.safeParse({
        ...baseEnv,
        environmentType: "DR",
        iacReference: undefined,
      }),
      /iacReference is required for environmentType=PRODUCTION or DR/,
    );
  });

  it("requires promotionGate for environmentType=PRODUCTION (GR-L6-007)", () => {
    expectIssue(
      EnvironmentSchema.safeParse({ ...baseEnv, promotionGate: undefined }),
      /promotionGate is required for environmentType=PRODUCTION or DR/,
    );
  });

  it("requires promotionGate for environmentType=DR (GR-L6-007)", () => {
    expectIssue(
      EnvironmentSchema.safeParse({
        ...baseEnv,
        environmentType: "DR",
        promotionGate: undefined,
      }),
      /promotionGate is required for environmentType=PRODUCTION or DR/,
    );
  });

  it("rejects unknown environmentType (closed enum)", () => {
    expectIssue(
      EnvironmentSchema.safeParse({ ...baseEnv, environmentType: "TEST" }),
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
    expectIssue(EnvironmentSchema.safeParse({ ...baseEnv, description: "" }), /at least 1/);
  });

  it("rejects layer other than L6", () => {
    expectIssue(EnvironmentSchema.safeParse({ ...baseEnv, layer: "L5" }), /Invalid literal value/);
  });

  it("declares EAGER traversal weight (kap. 4 § L6 Environment)", () => {
    expect(ENVIRONMENT_TRAVERSAL_WEIGHT).toBe("EAGER");
  });

  it("exposes all 5 environment types and 3 access restrictions (closed enums)", () => {
    expect(ENVIRONMENT_TYPES).toEqual([
      "PRODUCTION",
      "STAGING",
      "DEVELOPMENT",
      "PREVIEW",
      "DR",
    ]);
    expect(ACCESS_RESTRICTIONS).toEqual([
      "UNRESTRICTED",
      "TEAM_ONLY",
      "APPROVALS_REQUIRED",
    ]);
  });
});
