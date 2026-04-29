// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  EXTERNAL_DEPENDENCY_TRAVERSAL_WEIGHT,
  ExternalDependencySchema,
} from "../../../src/types/l5/external-dependency.js";
import { expectIssue } from "../../fixtures.js";
import { sampleTknRef, tknBase } from "./_fixtures.js";

const baseDep = {
  ...tknBase({ type: "ExternalDependency", layer: "L5", name: "zod" }),
  description: "Schema validation library used across all packages.",
  packageManager: "NPM" as const,
  packageName: "zod",
  versionConstraint: "^3.22.4",
  isDirect: true,
  hasKnownVulnerability: false,
  criticality: "LOW" as const,
};

describe("ExternalDependency (L5 — ADR A8)", () => {
  it("accepts a safe dependency without externalSystemRef", () => {
    expect(ExternalDependencySchema.parse(baseDep)).toMatchObject({
      type: "ExternalDependency",
      layer: "L5",
      hasKnownVulnerability: false,
    });
  });

  it("accepts a dependency with externalSystemRef", () => {
    expect(
      ExternalDependencySchema.parse({
        ...baseDep,
        externalSystemRef: sampleTknRef,
      }),
    ).toMatchObject({ externalSystemRef: sampleTknRef });
  });

  it("accepts a vulnerable dep when externalSystemRef is supplied (ADR A8)", () => {
    expect(
      ExternalDependencySchema.parse({
        ...baseDep,
        hasKnownVulnerability: true,
        externalSystemRef: sampleTknRef,
      }),
    ).toMatchObject({ hasKnownVulnerability: true });
  });

  it("rejects hasKnownVulnerability=true without externalSystemRef (ADR A8 traceability)", () => {
    expectIssue(
      ExternalDependencySchema.safeParse({
        ...baseDep,
        hasKnownVulnerability: true,
      }),
      /externalSystemRef is required when hasKnownVulnerability=true/,
    );
  });

  it("rejects empty versionConstraint", () => {
    expectIssue(
      ExternalDependencySchema.safeParse({ ...baseDep, versionConstraint: "" }),
      /non-empty SemVer constraint/,
    );
  });

  it("rejects layer mismatch", () => {
    expectIssue(
      ExternalDependencySchema.safeParse({ ...baseDep, layer: "L3" }),
      /Invalid literal value/,
    );
  });

  it("accepts CRITICAL dep with securityAuditDate (GR-L5-004 satisfied)", () => {
    expect(
      ExternalDependencySchema.parse({
        ...baseDep,
        criticality: "CRITICAL",
        securityAuditDate: "2026-03-01",
      }),
    ).toMatchObject({ criticality: "CRITICAL", securityAuditDate: "2026-03-01" });
  });

  it("accepts CRITICAL dep without securityAuditDate (guardrail fires, schema allows)", () => {
    expect(
      ExternalDependencySchema.parse({
        ...baseDep,
        criticality: "CRITICAL",
      }),
    ).toMatchObject({ criticality: "CRITICAL" });
  });

  it("rejects invalid criticality value", () => {
    expectIssue(
      ExternalDependencySchema.safeParse({ ...baseDep, criticality: "EXTREME" }),
      /Invalid enum value/,
    );
  });

  it("rejects invalid securityAuditDate format", () => {
    expectIssue(
      ExternalDependencySchema.safeParse({ ...baseDep, securityAuditDate: "not-a-date" }),
      /Invalid date/,
    );
  });

  it("declares LAZY traversal weight", () => {
    expect(EXTERNAL_DEPENDENCY_TRAVERSAL_WEIGHT).toBe("LAZY");
  });
});
