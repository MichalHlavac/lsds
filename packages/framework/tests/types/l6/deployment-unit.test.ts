import { describe, expect, it } from "vitest";
import {
  DEPLOYMENT_UNIT_KINDS,
  DEPLOYMENT_UNIT_TRAVERSAL_WEIGHT,
  DeploymentUnitSchema,
} from "../../../src/types/l6/deployment-unit.js";
import { expectIssue, sampleTeam } from "../../fixtures.js";
import { sampleRepo, tknBase } from "./_fixtures.js";

const baseUnit = {
  ...tknBase({ type: "DeploymentUnit", layer: "L6", name: "api-container" }),
  description: "Docker container for the LSDS API service.",
  owner: sampleTeam,
  kind: "CONTAINER" as const,
  imageReference: "ghcr.io/example/lsds-api:1.0.0",
  continuousDeployment: true,
};

describe("DeploymentUnit (L6)", () => {
  it("accepts a CONTAINER with imageReference", () => {
    expect(DeploymentUnitSchema.parse(baseUnit)).toMatchObject({
      type: "DeploymentUnit",
      layer: "L6",
      kind: "CONTAINER",
    });
  });

  it("accepts a CONTAINER with buildfilePath instead of imageReference", () => {
    expect(
      DeploymentUnitSchema.parse({
        ...baseUnit,
        imageReference: undefined,
        buildfilePath: "apps/api/Dockerfile",
      }),
    ).toMatchObject({ buildfilePath: "apps/api/Dockerfile" });
  });

  it("accepts a non-CONTAINER unit without imageReference or buildfilePath", () => {
    expect(
      DeploymentUnitSchema.parse({
        ...baseUnit,
        kind: "STATIC_SITE",
        imageReference: undefined,
        repoRef: sampleRepo,
      }),
    ).toMatchObject({ kind: "STATIC_SITE" });
  });

  it("rejects CONTAINER with neither imageReference nor buildfilePath", () => {
    expectIssue(
      DeploymentUnitSchema.safeParse({
        ...baseUnit,
        imageReference: undefined,
      }),
      /CONTAINER requires imageReference or buildfilePath/,
    );
  });

  it("rejects unknown kind (closed enum)", () => {
    expectIssue(
      DeploymentUnitSchema.safeParse({ ...baseUnit, kind: "WASM_MODULE" }),
      /Invalid enum value/,
    );
  });

  it("rejects layer mismatch", () => {
    expectIssue(
      DeploymentUnitSchema.safeParse({ ...baseUnit, layer: "L5" }),
      /Invalid literal value/,
    );
  });

  it("declares EAGER traversal weight", () => {
    expect(DEPLOYMENT_UNIT_TRAVERSAL_WEIGHT).toBe("EAGER");
  });

  it("exposes 7 deployment unit kinds (closed enum)", () => {
    expect(DEPLOYMENT_UNIT_KINDS).toHaveLength(7);
  });
});
