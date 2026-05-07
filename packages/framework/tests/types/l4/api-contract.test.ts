// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  API_CONTRACT_SPEC_TYPES,
  ApiContractSchema,
} from "../../../src/types/l4/api-contract.js";
import { expectIssue } from "../../fixtures.js";
import { tknBase } from "./_fixtures.js";

const baseContract = {
  ...tknBase({ type: "APIContract", layer: "L4", name: "billing-public-v1" }),
  description: "Public billing REST API used by partners and dashboards.",
  specType: "OPENAPI" as const,
  specReference: "https://github.com/example/billing/blob/main/openapi.yaml",
  breakingChangePolicy:
    "Breaking changes ship under a new vN URL prefix; previous version sunsets after 6 months.",
};

describe("APIContract (kap. 4 § L4)", () => {
  it("accepts a fully populated OpenAPI contract", () => {
    expect(ApiContractSchema.parse(baseContract)).toMatchObject({
      type: "APIContract",
      layer: "L4",
      specType: "OPENAPI",
    });
  });

  it("rejects unknown specType (closed enum)", () => {
    expectIssue(
      ApiContractSchema.safeParse({ ...baseContract, specType: "RAML" }),
      /Invalid enum value/,
    );
  });

  it("rejects malformed specReference (must be URL)", () => {
    expectIssue(
      ApiContractSchema.safeParse({ ...baseContract, specReference: "openapi.yaml" }),
      /must be a URL/,
    );
  });

  it("rejects too-short breakingChangePolicy (< 30 chars)", () => {
    expectIssue(
      ApiContractSchema.safeParse({
        ...baseContract,
        breakingChangePolicy: "TBD",
      }),
      /breakingChangePolicy must describe how/,
    );
  });

  it("rejects non-semver version (TknBase invariant)", () => {
    expectIssue(
      ApiContractSchema.safeParse({ ...baseContract, version: "v1" }),
      /SemVer/,
    );
  });


  it("exposes 5 spec types (kap. 4 closed enum)", () => {
    expect(API_CONTRACT_SPEC_TYPES).toEqual([
      "OPENAPI",
      "GRPC_PROTO",
      "GRAPHQL",
      "ASYNCAPI",
      "CUSTOM",
    ]);
  });
});
