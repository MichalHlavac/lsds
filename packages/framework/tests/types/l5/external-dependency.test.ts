// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  DEPENDENCY_TYPES,
  DEPENDENCY_UPDATE_POLICIES,
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

  describe("license / dependencyType / updatePolicy (LSDS-920, kap. 4 § L5 / ExternalDependency)", () => {
    it("accepts a dependency with SPDX license string and round-trips it", () => {
      const parsed = ExternalDependencySchema.parse({ ...baseDep, license: "Apache-2.0" });
      expect(parsed.license).toBe("Apache-2.0");
    });

    it("rejects empty license string (min 1)", () => {
      expectIssue(
        ExternalDependencySchema.safeParse({ ...baseDep, license: "" }),
        /String must contain at least 1 character|too_small/,
      );
    });

    it("accepts a vulnerable dep with GPL license + L3 ref (license is independent of vuln gating)", () => {
      // GR-L5-007 is descriptive-only; the schema must not gate license values
      // on hasKnownVulnerability. The ADR A8 traceability superrefine still
      // requires externalSystemRef when hasKnownVulnerability=true.
      expect(
        ExternalDependencySchema.parse({
          ...baseDep,
          hasKnownVulnerability: true,
          externalSystemRef: sampleTknRef,
          license: "GPL-3.0-only",
        }),
      ).toMatchObject({ license: "GPL-3.0-only", hasKnownVulnerability: true });
    });

    it("defaults dependencyType to LIBRARY when omitted (migration safety)", () => {
      const parsed = ExternalDependencySchema.parse(baseDep);
      expect(parsed.dependencyType).toBe("LIBRARY");
    });

    it("accepts every DependencyType enum value", () => {
      for (const value of DEPENDENCY_TYPES) {
        expect(
          ExternalDependencySchema.parse({ ...baseDep, dependencyType: value }).dependencyType,
        ).toBe(value);
      }
    });

    it("rejects invalid dependencyType value", () => {
      expectIssue(
        ExternalDependencySchema.safeParse({ ...baseDep, dependencyType: "PLUGIN" }),
        /Invalid enum value/,
      );
    });

    it("accepts every DependencyUpdatePolicy enum value", () => {
      for (const value of DEPENDENCY_UPDATE_POLICIES) {
        expect(
          ExternalDependencySchema.parse({ ...baseDep, updatePolicy: value }).updatePolicy,
        ).toBe(value);
      }
    });

    it("accepts a dependency without updatePolicy (optional)", () => {
      const parsed = ExternalDependencySchema.parse(baseDep);
      expect(parsed.updatePolicy).toBeUndefined();
    });

    it("rejects invalid updatePolicy value", () => {
      expectIssue(
        ExternalDependencySchema.safeParse({ ...baseDep, updatePolicy: "ASAP" }),
        /Invalid enum value/,
      );
    });
  });

});
