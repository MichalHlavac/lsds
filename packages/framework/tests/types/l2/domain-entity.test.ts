// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import { DomainEntitySchema } from "../../../src/types/l2/domain-entity.js";
import { expectIssue, tknBase } from "../../fixtures.js";

const baseEntity = {
  ...tknBase({ type: "DomainEntity", layer: "L2", name: "Invoice" }),
  description: "An issued invoice with line items and a payment status.",
  attributes: [
    { name: "invoiceId", type: "string" },
    { name: "totalCents", type: "number" },
    { name: "status", type: "InvoiceStatus" },
  ],
  identityAttribute: "invoiceId",
  lifecycleStates: ["DRAFT", "ISSUED", "PAID"],
  invariants: ["totalCents must equal sum(lineItems.amountCents)"],
} as const;

describe("DomainEntity (kap. 4 § L2)", () => {
  it("accepts a fully populated entity", () => {
    expect(DomainEntitySchema.parse(baseEntity)).toMatchObject({ type: "DomainEntity", layer: "L2" });
  });

  it("rejects empty attributes (kap. 4 invariant)", () => {
    expectIssue(
      DomainEntitySchema.safeParse({ ...baseEntity, attributes: [] }),
      /at least one attribute/,
    );
  });

  it("rejects identityAttribute that does not match an attribute name", () => {
    expectIssue(
      DomainEntitySchema.safeParse({ ...baseEntity, identityAttribute: "missingId" }),
      /must reference an attribute name/,
    );
  });

  it("rejects empty invariants (kap. 4 invariant)", () => {
    expectIssue(
      DomainEntitySchema.safeParse({ ...baseEntity, invariants: [] }),
      /at least one business invariant/,
    );
  });

  it("defaults lifecycleStates to empty array when omitted", () => {
    const { lifecycleStates: _omit, ...minimal } = baseEntity;
    expect(DomainEntitySchema.parse(minimal).lifecycleStates).toEqual([]);
  });
});
