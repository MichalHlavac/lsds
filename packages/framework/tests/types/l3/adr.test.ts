// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  ADR_STATUSES,
  ADR_TRAVERSAL_WEIGHT,
  AdrSchema,
} from "../../../src/types/l3/adr.js";
import { expectIssue } from "../../fixtures.js";
import { samplePerson, tknBase } from "./_fixtures.js";

const longText = (label: string, n = 80) =>
  `${label}: ` +
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor".slice(0, n);

const baseAdr = {
  ...tknBase({ type: "ADR", layer: "L3", name: "Adopt event sourcing for billing" }),
  adrNumber: 12,
  status: "ACCEPTED" as const,
  context: longText("context"),
  decision: longText("decision"),
  rationale: longText("rationale"),
  consequences: longText("consequences"),
  alternativesConsidered: [
    {
      name: "CRUD with audit log",
      description: "Use plain CRUD plus an append-only audit log table.",
      reasonRejected: "Audit log can drift from the row state under concurrent writes.",
    },
  ],
  author: samplePerson,
  decisionDate: "2026-04-15",
};

describe("ADR (kap. 4 § L3)", () => {
  it("accepts a fully populated ACCEPTED ADR", () => {
    expect(AdrSchema.parse(baseAdr)).toMatchObject({
      type: "ADR",
      layer: "L3",
      status: "ACCEPTED",
    });
  });

  it("requires alternativesConsidered with at least one option", () => {
    expectIssue(
      AdrSchema.safeParse({ ...baseAdr, alternativesConsidered: [] }),
      /at least one option/,
    );
  });

  it("requires reasonRejected on each alternative", () => {
    expectIssue(
      AdrSchema.safeParse({
        ...baseAdr,
        alternativesConsidered: [
          { name: "Option A", description: "Some option", reasonRejected: "" },
        ],
      }),
      /reasonRejected/,
    );
  });

  it("rejects adrNumber 0 or negative (sequential per system)", () => {
    expectIssue(AdrSchema.safeParse({ ...baseAdr, adrNumber: 0 }), /positive integer/);
    expectIssue(AdrSchema.safeParse({ ...baseAdr, adrNumber: -1 }), /positive integer/);
  });

  it("rejects non-ISO decisionDate", () => {
    expectIssue(AdrSchema.safeParse({ ...baseAdr, decisionDate: "April 15, 2026" }), /ISO date/);
  });

  it("requires supersededByAdrId when status === SUPERSEDED", () => {
    expectIssue(
      AdrSchema.safeParse({ ...baseAdr, status: "SUPERSEDED" }),
      /SUPERSEDED ADR must have supersededByAdrId/,
    );
  });

  it("accepts SUPERSEDED with valid supersededByAdrId", () => {
    expect(
      AdrSchema.parse({
        ...baseAdr,
        status: "SUPERSEDED",
        supersededByAdrId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      }),
    ).toMatchObject({ status: "SUPERSEDED" });
  });

  it("rejects supersededByAdrId on non-SUPERSEDED status", () => {
    expectIssue(
      AdrSchema.safeParse({
        ...baseAdr,
        status: "ACCEPTED",
        supersededByAdrId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      }),
      /only valid when status === SUPERSEDED/,
    );
  });

  it("rejects too-short rationale (≥ 30 chars)", () => {
    expectIssue(AdrSchema.safeParse({ ...baseAdr, rationale: "because" }), /rationale/);
  });

  it("rejects unknown status (closed enum)", () => {
    expectIssue(AdrSchema.safeParse({ ...baseAdr, status: "DRAFT" }), /Invalid enum value/);
  });

  it("declares LAZY traversal weight (kap. 4)", () => {
    expect(ADR_TRAVERSAL_WEIGHT).toBe("LAZY");
  });

  it("exposes the 4-state ADR status machine", () => {
    expect(ADR_STATUSES).toEqual(["PROPOSED", "ACCEPTED", "DEPRECATED", "SUPERSEDED"]);
  });
});
