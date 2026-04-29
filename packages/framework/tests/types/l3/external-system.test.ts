// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  EXTERNAL_SYSTEM_CRITICALITIES,
  EXTERNAL_SYSTEM_TRAVERSAL_WEIGHT,
  ExternalSystemSchema,
} from "../../../src/types/l3/external-system.js";
import { expectIssue, sampleTeam } from "../../fixtures.js";
import { samplePerson, tknBase } from "./_fixtures.js";

const baseExt = {
  ...tknBase({ type: "ExternalSystem", layer: "L3", name: "Stripe Payments" }),
  description: "Card processing and recurring billing.",
  vendor: "Stripe Inc.",
  criticality: "CRITICAL" as const,
  slaReference: "MSA section 4.3 — payment uptime 99.99%",
  fallbackStrategy:
    "Queue charges in the local outbox and retry against Stripe; surface degraded mode in dunning.",
  contractOwner: samplePerson,
  documentationUrl: "https://stripe.com/docs/api",
  owner: sampleTeam,
};

describe("ExternalSystem (kap. 4 § L3)", () => {
  it("accepts a fully populated CRITICAL external system", () => {
    expect(ExternalSystemSchema.parse(baseExt)).toMatchObject({
      type: "ExternalSystem",
      layer: "L3",
      criticality: "CRITICAL",
    });
  });

  it("accepts a MEDIUM external system without SLA or fallback", () => {
    const { slaReference: _s, fallbackStrategy: _f, ...minimal } = baseExt;
    expect(
      ExternalSystemSchema.parse({ ...minimal, criticality: "MEDIUM" }),
    ).toMatchObject({ criticality: "MEDIUM" });
  });

  it("requires slaReference for HIGH criticality", () => {
    const { slaReference: _s, ...withoutSla } = baseExt;
    expectIssue(
      ExternalSystemSchema.safeParse({ ...withoutSla, criticality: "HIGH" }),
      /slaReference is required for criticality=HIGH/,
    );
  });

  it("requires slaReference for CRITICAL criticality", () => {
    const { slaReference: _s, ...withoutSla } = baseExt;
    expectIssue(
      ExternalSystemSchema.safeParse(withoutSla),
      /slaReference is required for criticality=CRITICAL/,
    );
  });

  it("rejects too-short slaReference (< 10 chars)", () => {
    expectIssue(
      ExternalSystemSchema.safeParse({ ...baseExt, slaReference: "TBD" }),
      /slaReference is required/,
    );
  });

  it("requires fallbackStrategy when criticality=CRITICAL", () => {
    const { fallbackStrategy: _f, ...withoutFallback } = baseExt;
    expectIssue(
      ExternalSystemSchema.safeParse(withoutFallback),
      /fallbackStrategy is required for criticality=CRITICAL/,
    );
  });

  it("does NOT require fallbackStrategy when criticality=HIGH", () => {
    const { fallbackStrategy: _f, ...withoutFallback } = baseExt;
    expect(
      ExternalSystemSchema.parse({ ...withoutFallback, criticality: "HIGH" }),
    ).toMatchObject({ criticality: "HIGH" });
  });

  it("rejects too-short fallbackStrategy (< 20 chars)", () => {
    expectIssue(
      ExternalSystemSchema.safeParse({ ...baseExt, fallbackStrategy: "Retry later" }),
      /fallbackStrategy/,
    );
  });

  it("rejects malformed documentationUrl", () => {
    expectIssue(
      ExternalSystemSchema.safeParse({ ...baseExt, documentationUrl: "not-a-url" }),
      /valid URL/,
    );
  });

  it("rejects unknown criticality (closed enum)", () => {
    expectIssue(
      ExternalSystemSchema.safeParse({ ...baseExt, criticality: "LOW" }),
      /Invalid enum value/,
    );
  });

  it("rejects non-ISO lastReviewDate when supplied", () => {
    expectIssue(
      ExternalSystemSchema.safeParse({ ...baseExt, lastReviewDate: "2026/04/15" }),
      /ISO date/,
    );
  });

  it("declares EAGER traversal weight", () => {
    expect(EXTERNAL_SYSTEM_TRAVERSAL_WEIGHT).toBe("EAGER");
  });

  it("exposes the 3 criticality levels (kap. 4 closed enum)", () => {
    expect(EXTERNAL_SYSTEM_CRITICALITIES).toEqual(["CRITICAL", "HIGH", "MEDIUM"]);
  });
});
