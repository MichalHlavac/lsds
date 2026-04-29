// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  ARCHITECTURE_PRINCIPLE_TRAVERSAL_WEIGHT,
  ArchitecturePrincipleSchema,
} from "../../../src/types/l3/architecture-principle.js";
import { expectIssue } from "../../fixtures.js";
import { tknBase } from "./_fixtures.js";

const basePrinciple = {
  ...tknBase({ type: "ArchitecturePrinciple", layer: "L3", name: "Stateless services" }),
  statement: "Application services must be stateless and store all session data externally.",
  rationale: "Stateless services scale horizontally and recover from node failure without sticky sessions.",
  implications: [
    "Session state must live in Redis or the auth provider, not in process memory.",
    "Deployments may roll any single replica without draining its in-memory state.",
  ],
};

describe("ArchitecturePrinciple (kap. 4 § L3)", () => {
  it("accepts a fully populated principle", () => {
    expect(ArchitecturePrincipleSchema.parse(basePrinciple)).toMatchObject({
      type: "ArchitecturePrinciple",
      layer: "L3",
    });
  });

  it("accepts an optional `exceptions` clause", () => {
    expect(
      ArchitecturePrincipleSchema.parse({
        ...basePrinciple,
        exceptions: "Long-running batch jobs may keep checkpoint state on local disk.",
      }).exceptions,
    ).toContain("checkpoint");
  });

  it("rejects empty implications array", () => {
    expectIssue(
      ArchitecturePrincipleSchema.safeParse({ ...basePrinciple, implications: [] }),
      /at least one consequence/,
    );
  });

  it("rejects too-short statement (≥ 30 chars)", () => {
    expectIssue(
      ArchitecturePrincipleSchema.safeParse({ ...basePrinciple, statement: "Be stateless." }),
      /clearly express/,
    );
  });

  it("rejects too-short rationale (≥ 30 chars)", () => {
    expectIssue(
      ArchitecturePrincipleSchema.safeParse({ ...basePrinciple, rationale: "Easier to scale." }),
      /why this principle holds/,
    );
  });

  it("declares LAZY traversal weight", () => {
    expect(ARCHITECTURE_PRINCIPLE_TRAVERSAL_WEIGHT).toBe("LAZY");
  });
});
