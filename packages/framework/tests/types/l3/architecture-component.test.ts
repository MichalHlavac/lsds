// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  ARCHITECTURE_COMPONENT_TYPES,
  ArchitectureComponentSchema,
  DATA_CLASSIFICATIONS,
  SCALABILITY_MODES,
} from "../../../src/types/l3/architecture-component.js";
import { expectIssue, sampleTeam } from "../../fixtures.js";
import { sampleTechnology, tknBase } from "./_fixtures.js";

const baseComponent = {
  ...tknBase({ type: "ArchitectureComponent", layer: "L3", name: "billing-api" }),
  description: "Stateless HTTP service exposing the billing public API.",
  componentType: "SERVICE",
  technology: sampleTechnology,
  owner: sampleTeam,
  dataClassification: "CONFIDENTIAL",
  scalabilityMode: "STATELESS",
} as const;

describe("ArchitectureComponent (kap. 4 § L3)", () => {
  it("accepts a fully populated component", () => {
    expect(ArchitectureComponentSchema.parse(baseComponent)).toMatchObject({
      type: "ArchitectureComponent",
      layer: "L3",
      componentType: "SERVICE",
    });
  });

  it("accepts a component without scalabilityMode (optional field)", () => {
    const { scalabilityMode: _omit, ...minimal } = baseComponent;
    expect(ArchitectureComponentSchema.parse(minimal).scalabilityMode).toBeUndefined();
  });

  it("rejects unknown componentType (closed enum)", () => {
    expectIssue(
      ArchitectureComponentSchema.safeParse({ ...baseComponent, componentType: "PROXY" }),
      /Invalid enum value/,
    );
  });

  it("rejects unknown dataClassification", () => {
    expectIssue(
      ArchitectureComponentSchema.safeParse({ ...baseComponent, dataClassification: "SECRET" }),
      /Invalid enum value/,
    );
  });

  it("rejects unknown scalabilityMode when supplied", () => {
    expectIssue(
      ArchitectureComponentSchema.safeParse({ ...baseComponent, scalabilityMode: "ELASTIC" }),
      /Invalid enum value/,
    );
  });

  it("rejects technology without kind 'technology'", () => {
    expectIssue(
      ArchitectureComponentSchema.safeParse({
        ...baseComponent,
        technology: { kind: "package", name: "PostgreSQL" },
      }),
      /Invalid literal value/,
    );
  });


  it("exposes 8 component types, 4 data classifications, 3 scalability modes", () => {
    expect(ARCHITECTURE_COMPONENT_TYPES).toHaveLength(8);
    expect(DATA_CLASSIFICATIONS).toHaveLength(4);
    expect(SCALABILITY_MODES).toHaveLength(3);
  });
});
