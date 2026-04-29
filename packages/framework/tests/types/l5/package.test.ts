import { describe, expect, it } from "vitest";
import {
  PACKAGE_MANAGERS,
  PACKAGE_TRAVERSAL_WEIGHT,
  PackageSchema,
} from "../../../src/types/l5/package.js";
import { expectIssue, sampleTeam } from "../../fixtures.js";
import { tknBase } from "./_fixtures.js";

const basePackage = {
  ...tknBase({ type: "Package", layer: "L5", name: "lsds-framework" }),
  description: "Published NPM package for the LSDS framework.",
  owner: sampleTeam,
  packageManager: "NPM" as const,
  packageName: "@lsds/framework",
  isPublic: false,
};

describe("Package (L5 — ADR A3 grain)", () => {
  it("accepts a minimal package without optional fields", () => {
    expect(PackageSchema.parse(basePackage)).toMatchObject({
      type: "Package",
      layer: "L5",
      packageManager: "NPM",
    });
  });

  it("accepts a package with registryUrl and repoRef", () => {
    expect(
      PackageSchema.parse({
        ...basePackage,
        registryUrl: "https://registry.npmjs.org",
        repoRef: { kind: "repo", url: "https://github.com/example/lsds" },
      }),
    ).toMatchObject({ registryUrl: "https://registry.npmjs.org" });
  });

  it("rejects invalid registryUrl", () => {
    expectIssue(
      PackageSchema.safeParse({ ...basePackage, registryUrl: "not-a-url" }),
      /valid URL/,
    );
  });

  it("rejects empty packageName", () => {
    expectIssue(
      PackageSchema.safeParse({ ...basePackage, packageName: "" }),
      /String must contain at least 1/,
    );
  });

  it("rejects unknown packageManager (closed enum)", () => {
    expectIssue(
      PackageSchema.safeParse({ ...basePackage, packageManager: "HOMEBREW" }),
      /Invalid enum value/,
    );
  });

  it("rejects layer mismatch (Package must declare layer=L5)", () => {
    expectIssue(
      PackageSchema.safeParse({ ...basePackage, layer: "L6" }),
      /Invalid literal value/,
    );
  });

  it("declares LAZY traversal weight", () => {
    expect(PACKAGE_TRAVERSAL_WEIGHT).toBe("LAZY");
  });

  it("exposes 8 package managers (closed enum)", () => {
    expect(PACKAGE_MANAGERS).toHaveLength(8);
  });
});
