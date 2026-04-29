// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  ARCHITECTURE_SYSTEM_TRAVERSAL_WEIGHT,
  ArchitectureSystemSchema,
} from "../../../src/types/l3/architecture-system.js";
import { expectIssue, sampleTeam } from "../../fixtures.js";
import { qaRefA, qaRefB, tknBase } from "./_fixtures.js";

const baseSystem = {
  ...tknBase({ type: "ArchitectureSystem", layer: "L3", name: "Billing Platform" }),
  description: "Billing platform — invoicing, charges, refunds, dunning.",
  owner: sampleTeam,
  primaryUsers: ["Finance Operations", "Customer Success"],
  qualityAttributes: [qaRefA, qaRefB],
} as const;

describe("ArchitectureSystem (kap. 4 § L3)", () => {
  it("accepts a fully populated system", () => {
    expect(ArchitectureSystemSchema.parse(baseSystem)).toMatchObject({
      type: "ArchitectureSystem",
      layer: "L3",
    });
  });

  it("rejects empty primaryUsers", () => {
    expectIssue(
      ArchitectureSystemSchema.safeParse({ ...baseSystem, primaryUsers: [] }),
      /at least one user role/,
    );
  });

  it("rejects empty qualityAttributes", () => {
    expectIssue(
      ArchitectureSystemSchema.safeParse({ ...baseSystem, qualityAttributes: [] }),
      /at least one QualityAttribute/,
    );
  });

  it("rejects duplicate QualityAttribute refs (dedup by id)", () => {
    expectIssue(
      ArchitectureSystemSchema.safeParse({
        ...baseSystem,
        qualityAttributes: [qaRefA, qaRefA],
      }),
      /unique by id/,
    );
  });

  it("rejects QualityAttributeRef with non-UUID id", () => {
    expectIssue(
      ArchitectureSystemSchema.safeParse({
        ...baseSystem,
        qualityAttributes: [{ kind: "quality-attribute", id: "not-a-uuid" }],
      }),
      /uuid/i,
    );
  });

  it("declares EAGER traversal weight", () => {
    expect(ARCHITECTURE_SYSTEM_TRAVERSAL_WEIGHT).toBe("EAGER");
  });
});
