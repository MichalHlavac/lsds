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

  it("declares LAZY traversal weight", () => {
    expect(EXTERNAL_DEPENDENCY_TRAVERSAL_WEIGHT).toBe("LAZY");
  });
});
