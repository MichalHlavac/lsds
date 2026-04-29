// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import { DomainServiceSchema } from "../../../src/types/l2/domain-service.js";
import { expectIssue, tknBase } from "../../fixtures.js";

const baseService = {
  ...tknBase({ type: "DomainService", layer: "L2", name: "InvoiceFinalizer" }),
  description: "Coordinates invoice finalization across multiple aggregates.",
  operations: [
    { name: "finalize", description: "Closes draft invoice and emits InvoiceIssued event." },
  ],
} as const;

describe("DomainService (kap. 4 § L2)", () => {
  it("accepts a fully populated service", () => {
    expect(DomainServiceSchema.parse(baseService)).toMatchObject({
      type: "DomainService",
      layer: "L2",
    });
  });

  it("defaults stateless to true", () => {
    expect(DomainServiceSchema.parse(baseService).stateless).toBe(true);
  });

  it("rejects stateless=false (domain services are stateless coordination)", () => {
    expectIssue(
      DomainServiceSchema.safeParse({ ...baseService, stateless: false }),
      /Invalid literal value/,
    );
  });

  it("rejects empty operations", () => {
    expectIssue(
      DomainServiceSchema.safeParse({ ...baseService, operations: [] }),
      /at least one operation/,
    );
  });
});
