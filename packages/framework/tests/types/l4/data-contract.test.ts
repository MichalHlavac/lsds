// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  DATA_CONTRACT_CLASSIFICATIONS,
  DATA_CONTRACT_FORMATS,
  DATA_CONTRACT_FRESHNESS,
  DATA_CONTRACT_TRAVERSAL_WEIGHT,
  DataContractSchema,
} from "../../../src/types/l4/data-contract.js";
import { expectIssue, sampleTeam } from "../../fixtures.js";
import { sampleJsonSchema, tknBase } from "./_fixtures.js";

const baseData = {
  ...tknBase({ type: "DataContract", layer: "L4", name: "billing.invoices.daily" }),
  description: "Daily snapshot of invoices for finance and reporting consumers.",
  owner: sampleTeam,
  format: "AVRO" as const,
  schema: sampleJsonSchema,
  freshness: "BATCH_DAILY" as const,
  classification: "INTERNAL" as const,
  retention: "30d",
};

describe("DataContract (kap. 4 § L4)", () => {
  it("accepts a fully populated INTERNAL daily contract", () => {
    expect(DataContractSchema.parse(baseData)).toMatchObject({
      type: "DataContract",
      layer: "L4",
      classification: "INTERNAL",
    });
  });

  it("requires slaReference when classification=RESTRICTED", () => {
    expectIssue(
      DataContractSchema.safeParse({ ...baseData, classification: "RESTRICTED" }),
      /slaReference is required when classification=RESTRICTED/,
    );
  });

  it("accepts RESTRICTED contract with slaReference", () => {
    expect(
      DataContractSchema.parse({
        ...baseData,
        classification: "RESTRICTED",
        slaReference: "DLP policy DPA-2026-04 — daily reconciliation, owner finance-ops.",
      }),
    ).toMatchObject({ classification: "RESTRICTED" });
  });

  it("rejects malformed retention (must be <number><d|w|m|y>)", () => {
    expectIssue(
      DataContractSchema.safeParse({ ...baseData, retention: "30 days" }),
      /retention must match/,
    );
  });

  it("rejects unknown format / freshness / classification (closed enums)", () => {
    expectIssue(
      DataContractSchema.safeParse({ ...baseData, format: "XML" }),
      /Invalid enum value/,
    );
    expectIssue(
      DataContractSchema.safeParse({ ...baseData, freshness: "MONTHLY" }),
      /Invalid enum value/,
    );
    expectIssue(
      DataContractSchema.safeParse({ ...baseData, classification: "TOP_SECRET" }),
      /Invalid enum value/,
    );
  });

  it("declares EAGER traversal weight", () => {
    expect(DATA_CONTRACT_TRAVERSAL_WEIGHT).toBe("EAGER");
  });

  it("exposes the closed enums kap. 4 calls out", () => {
    expect(DATA_CONTRACT_FORMATS).toHaveLength(5);
    expect(DATA_CONTRACT_FRESHNESS).toHaveLength(6);
    expect(DATA_CONTRACT_CLASSIFICATIONS).toEqual([
      "PUBLIC",
      "INTERNAL",
      "CONFIDENTIAL",
      "RESTRICTED",
    ]);
  });
});
