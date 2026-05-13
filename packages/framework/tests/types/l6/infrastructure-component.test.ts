// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  INFRA_COMPONENT_KINDS,
  INFRA_ENVIRONMENTS,
  InfrastructureComponentSchema,
} from "../../../src/types/l6/infrastructure-component.js";
import { expectIssue, sampleTeam } from "../../fixtures.js";
import { tknBase } from "./_fixtures.js";

const baseInfra = {
  ...tknBase({ type: "InfrastructureComponent", layer: "L6", name: "api-postgres" }),
  description: "Primary Postgres instance for the LSDS API.",
  owner: sampleTeam,
  kind: "DATABASE" as const,
  environment: "PROD" as const,
  provider: "AWS RDS",
  isManagedService: true,
  slaReference: "SLA-AWS-RDS-2026",
  iacReference: "infra/aws/rds/api-postgres.tf",
};

describe("InfrastructureComponent (L6)", () => {
  it("accepts a PROD managed database with slaReference", () => {
    expect(InfrastructureComponentSchema.parse(baseInfra)).toMatchObject({
      type: "InfrastructureComponent",
      layer: "L6",
      kind: "DATABASE",
    });
  });

  it("accepts a non-PROD managed service without slaReference", () => {
    expect(
      InfrastructureComponentSchema.parse({
        ...baseInfra,
        environment: "STAGING",
        slaReference: undefined,
      }),
    ).toMatchObject({ environment: "STAGING" });
  });

  it("accepts a PROD self-managed service without slaReference", () => {
    expect(
      InfrastructureComponentSchema.parse({
        ...baseInfra,
        isManagedService: false,
        slaReference: undefined,
      }),
    ).toMatchObject({ isManagedService: false });
  });

  it("rejects PROD managed service without slaReference", () => {
    expectIssue(
      InfrastructureComponentSchema.safeParse({
        ...baseInfra,
        slaReference: undefined,
      }),
      /slaReference is required for PROD managed services/,
    );
  });

  it("rejects unknown kind (closed enum)", () => {
    expectIssue(
      InfrastructureComponentSchema.safeParse({ ...baseInfra, kind: "DNS" }),
      /Invalid enum value/,
    );
  });

  it("rejects unknown environment (closed enum)", () => {
    expectIssue(
      InfrastructureComponentSchema.safeParse({ ...baseInfra, environment: "TEST" }),
      /Invalid enum value/,
    );
  });

  it("rejects empty provider", () => {
    expectIssue(
      InfrastructureComponentSchema.safeParse({ ...baseInfra, provider: "" }),
      /provider/,
    );
  });

  it("rejects layer mismatch", () => {
    expectIssue(
      InfrastructureComponentSchema.safeParse({ ...baseInfra, layer: "L5" }),
      /Invalid literal value/,
    );
  });

  it("requires iacReference (kap. 4 § L6 invariant; GR-L6-001 enforced at schema level)", () => {
    const { iacReference: _omit, ...withoutIac } = baseInfra;
    expectIssue(
      InfrastructureComponentSchema.safeParse(withoutIac as unknown as typeof baseInfra),
      /Required/,
    );
  });

  it("rejects empty iacReference", () => {
    expectIssue(
      InfrastructureComponentSchema.safeParse({ ...baseInfra, iacReference: "" }),
      /String must contain at least 1 character/,
    );
  });


  it("exposes 9 kinds and 4 environments (closed enums)", () => {
    expect(INFRA_COMPONENT_KINDS).toHaveLength(9);
    expect(INFRA_ENVIRONMENTS).toHaveLength(4);
  });
});
