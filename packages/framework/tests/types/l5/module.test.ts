import { describe, expect, it } from "vitest";
import {
  MODULE_LANGUAGES,
  MODULE_TRAVERSAL_WEIGHT,
  MODULE_TYPES,
  ModuleSchema,
} from "../../../src/types/l5/module.js";
import { expectIssue, sampleTeam } from "../../fixtures.js";
import { sampleRepo, tknBase } from "./_fixtures.js";

const baseModule = {
  ...tknBase({ type: "Module", layer: "L5", name: "framework-core" }),
  description: "Tenant-agnostic framework core — types and guardrails.",
  owner: sampleTeam,
  language: "TYPESCRIPT" as const,
  moduleType: "DOMAIN" as const,
  repoRef: sampleRepo,
  path: "packages/framework/src",
  publicApi: true,
};

describe("Module (L5 — ADR A3 grain)", () => {
  it("accepts a fully populated module", () => {
    expect(ModuleSchema.parse(baseModule)).toMatchObject({
      type: "Module",
      layer: "L5",
      language: "TYPESCRIPT",
    });
  });

  it("accepts optional testCoverageTarget", () => {
    expect(
      ModuleSchema.parse({ ...baseModule, testCoverageTarget: 80 }),
    ).toMatchObject({ testCoverageTarget: 80 });
  });

  it("rejects testCoverageTarget > 100", () => {
    expectIssue(
      ModuleSchema.safeParse({ ...baseModule, testCoverageTarget: 101 }),
      /Number must be less than or equal to 100/,
    );
  });

  it("rejects empty path", () => {
    expectIssue(
      ModuleSchema.safeParse({ ...baseModule, path: "" }),
      /non-empty/,
    );
  });

  it("rejects unknown language (closed enum)", () => {
    expectIssue(
      ModuleSchema.safeParse({ ...baseModule, language: "COBOL" }),
      /Invalid enum value/,
    );
  });

  it("rejects layer mismatch (Module must declare layer=L5)", () => {
    expectIssue(
      ModuleSchema.safeParse({ ...baseModule, layer: "L4" }),
      /Invalid literal value/,
    );
  });

  it("declares LAZY traversal weight", () => {
    expect(MODULE_TRAVERSAL_WEIGHT).toBe("LAZY");
  });

  it("exposes 9 languages (closed enum)", () => {
    expect(MODULE_LANGUAGES).toHaveLength(9);
  });

  describe("moduleType (kap. 4 § L5 / CodeModule.module_type)", () => {
    it("exposes the closed enum from kap. 4: DOMAIN/APPLICATION/INFRASTRUCTURE/PRESENTATION/SHARED", () => {
      expect(MODULE_TYPES).toEqual([
        "DOMAIN",
        "APPLICATION",
        "INFRASTRUCTURE",
        "PRESENTATION",
        "SHARED",
      ]);
    });

    it.each(MODULE_TYPES)("accepts %s moduleType", (moduleType) => {
      expect(
        ModuleSchema.parse({ ...baseModule, moduleType }),
      ).toMatchObject({ moduleType });
    });

    it("rejects missing moduleType (kap. 4 marks it as required)", () => {
      const { moduleType: _omit, ...withoutModuleType } = baseModule;
      void _omit;
      const result = ModuleSchema.safeParse(withoutModuleType);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some(
            (i) => i.path.includes("moduleType") && i.message === "Required",
          ),
        ).toBe(true);
      }
    });

    it("rejects unknown moduleType (closed enum)", () => {
      expectIssue(
        ModuleSchema.safeParse({ ...baseModule, moduleType: "UTILITY" }),
        /Invalid enum value/,
      );
    });

    it("rejects empty-string moduleType", () => {
      expectIssue(
        ModuleSchema.safeParse({ ...baseModule, moduleType: "" }),
        /Invalid enum value/,
      );
    });

    it("treats moduleType as orthogonal to language (DOMAIN module can still declare TYPESCRIPT)", () => {
      const parsed = ModuleSchema.parse({
        ...baseModule,
        moduleType: "DOMAIN",
        language: "TYPESCRIPT",
      });
      expect(parsed.moduleType).toBe("DOMAIN");
      expect(parsed.language).toBe("TYPESCRIPT");
    });
  });
});
