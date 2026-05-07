// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  DELIVERY_GUARANTEES,
  EventContractSchema,
  ORDERING_GUARANTEES,
} from "../../../src/types/l4/event-contract.js";
import { expectIssue } from "../../fixtures.js";
import { sampleJsonSchema, tknBase } from "./_fixtures.js";

const baseEvent = {
  ...tknBase({ type: "EventContract", layer: "L4", name: "InvoiceIssued" }),
  description: "Emitted when an invoice transitions from DRAFT to ISSUED.",
  channel: "billing.invoice.issued.v1",
  payloadSchema: sampleJsonSchema,
  orderingGuarantee: "PER_KEY" as const,
  deliveryGuarantee: "AT_LEAST_ONCE" as const,
};

describe("EventContract (kap. 4 § L4)", () => {
  it("accepts a fully populated past-tense event", () => {
    expect(EventContractSchema.parse(baseEvent)).toMatchObject({
      type: "EventContract",
      layer: "L4",
      orderingGuarantee: "PER_KEY",
      deliveryGuarantee: "AT_LEAST_ONCE",
    });
  });

  it("requires orderingGuarantee (kap. 4 invariant)", () => {
    const { orderingGuarantee: _omit, ...without } = baseEvent;
    const result = EventContractSchema.safeParse(without);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (i) => i.path.join(".") === "orderingGuarantee" && i.message === "Required",
        ),
      ).toBe(true);
    }
  });

  it("requires deliveryGuarantee (kap. 4 invariant)", () => {
    const { deliveryGuarantee: _omit, ...without } = baseEvent;
    const result = EventContractSchema.safeParse(without);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (i) => i.path.join(".") === "deliveryGuarantee" && i.message === "Required",
        ),
      ).toBe(true);
    }
  });

  it("rejects unknown orderingGuarantee (closed enum)", () => {
    expectIssue(
      EventContractSchema.safeParse({ ...baseEvent, orderingGuarantee: "PARTITIONED" }),
      /Invalid enum value/,
    );
  });

  it("rejects unknown deliveryGuarantee (closed enum)", () => {
    expectIssue(
      EventContractSchema.safeParse({ ...baseEvent, deliveryGuarantee: "BEST_EFFORT" }),
      /Invalid enum value/,
    );
  });

  it("rejects imperative event names (e.g. 'CreateInvoice' is a command, not an event)", () => {
    expectIssue(
      EventContractSchema.safeParse({ ...baseEvent, name: "CreateInvoice" }),
      /past-tense/,
    );
  });

  it("rejects empty channel", () => {
    expectIssue(EventContractSchema.safeParse({ ...baseEvent, channel: "" }), /channel/);
  });


  it("exposes 3 ordering and 3 delivery guarantees (kap. 4 closed enums)", () => {
    expect(ORDERING_GUARANTEES).toEqual(["NONE", "PER_KEY", "GLOBAL"]);
    expect(DELIVERY_GUARANTEES).toEqual([
      "AT_MOST_ONCE",
      "AT_LEAST_ONCE",
      "EXACTLY_ONCE",
    ]);
  });
});
