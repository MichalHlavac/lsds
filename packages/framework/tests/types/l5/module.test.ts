// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  CodeModuleSchema,
  MODULE_TYPES,
  ModuleTypeSchema,
} from "../../../src/types/l5/module.js";
import { expectIssue, sampleTeam } from "../../fixtures.js";
import { tknBase } from "./_fixtures.js";

const sampleTechnology = {
  kind: "technology" as const,
  name: "TypeScript",
  version: "5.4.0",
};

const sampleRepositoryReference = {
  kind: "repo" as const,
  url: "https://github.com/example/lsds",
  path: "packages/framework/src",
};

const baseCodeModule = {
  ...tknBase({ type: "CodeModule", layer: "L5", name: "framework-core" }),
  description: "Tenant-agnostic framework core — types and guardrails.",
  owner: sampleTeam,
  language: sampleTechnology,
  moduleType: "DOMAIN" as const,
  repositoryReference: sampleRepositoryReference,
};

describe("CodeModule (L5 — kap. 4 spec, ADR A3 grain)", () => {
  it("accepts a fully populated CodeModule", () => {
    expect(CodeModuleSchema.parse(baseCodeModule)).toMatchObject({
      type: "CodeModule",
      layer: "L5",
      moduleType: "DOMAIN",
      language: { kind: "technology", name: "TypeScript" },
    });
  });

  it("requires moduleType (architectural role)", () => {
    const { moduleType: _drop, ...withoutModuleType } = baseCodeModule;
    expectIssue(CodeModuleSchema.safeParse(withoutModuleType), /Required/);
  });

  it("rejects unknown moduleType (closed enum)", () => {
    expectIssue(
      CodeModuleSchema.safeParse({ ...baseCodeModule, moduleType: "OPS" }),
      /Invalid enum value/,
    );
  });

  it("accepts every architectural moduleType", () => {
    for (const moduleType of MODULE_TYPES) {
      expect(
        CodeModuleSchema.parse({ ...baseCodeModule, moduleType }),
      ).toMatchObject({ moduleType });
    }
  });

  it("requires language as a TechnologyRef (not a free-form string)", () => {
    expectIssue(
      CodeModuleSchema.safeParse({ ...baseCodeModule, language: "TYPESCRIPT" }),
      /Expected object/,
    );
  });

  it("rejects TechnologyRef language without a name", () => {
    expectIssue(
      CodeModuleSchema.safeParse({
        ...baseCodeModule,
        language: { kind: "technology", name: "" },
      }),
      /at least 1 character/,
    );
  });

  it("requires repositoryReference.path (kap. 4: repository_reference = url + path)", () => {
    expectIssue(
      CodeModuleSchema.safeParse({
        ...baseCodeModule,
        repositoryReference: {
          kind: "repo",
          url: "https://github.com/example/lsds",
        },
      }),
      /Required/,
    );
  });

  it("rejects empty repositoryReference.path", () => {
    expectIssue(
      CodeModuleSchema.safeParse({
        ...baseCodeModule,
        repositoryReference: { ...sampleRepositoryReference, path: "" },
      }),
      /non-empty repo-relative path/,
    );
  });

  it("rejects invalid repositoryReference.url", () => {
    expectIssue(
      CodeModuleSchema.safeParse({
        ...baseCodeModule,
        repositoryReference: { ...sampleRepositoryReference, url: "not-a-url" },
      }),
      /Invalid url/,
    );
  });

  it("rejects layer mismatch (CodeModule must declare layer=L5)", () => {
    expectIssue(
      CodeModuleSchema.safeParse({ ...baseCodeModule, layer: "L4" }),
      /Invalid literal value/,
    );
  });

  it("rejects type literal drift (must be 'CodeModule', not legacy 'Module')", () => {
    expectIssue(
      CodeModuleSchema.safeParse({ ...baseCodeModule, type: "Module" }),
      /Invalid literal value/,
    );
  });

  it("rejects dropped legacy fields by not exposing them on the parsed shape", () => {
    const parsed = CodeModuleSchema.parse({
      ...baseCodeModule,
      // Spread under cast to verify Zod strips unknowns rather than persisting drift.
      ...({ publicApi: true, testCoverageTarget: 80 } as Record<string, unknown>),
    }) as Record<string, unknown>;
    expect(parsed.publicApi).toBeUndefined();
    expect(parsed.testCoverageTarget).toBeUndefined();
  });


  it("exposes 5 architectural module types (closed enum)", () => {
    expect(MODULE_TYPES).toHaveLength(5);
    expect(ModuleTypeSchema.options).toEqual([
      "DOMAIN",
      "APPLICATION",
      "INFRASTRUCTURE",
      "PRESENTATION",
      "SHARED",
    ]);
  });
});
