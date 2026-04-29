import { describe, expect, it } from "vitest";
import { DomainEventSchema } from "../../../src/types/l2/domain-event.js";
import { expectIssue, tknBase } from "../../fixtures.js";

const baseEvent = {
  ...tknBase({ type: "DomainEvent", layer: "L2", name: "InvoiceIssued" }),
  description: "An invoice has been issued to a customer.",
  payloadSchema: {
    type: "object",
    properties: { invoiceId: { type: "string" }, totalCents: { type: "integer" } },
    required: ["invoiceId", "totalCents"],
  },
  produces: { kind: "bounded-context", id: "22222222-2222-4222-8222-222222222222" },
  consumes: [{ kind: "bounded-context", id: "33333333-3333-4333-8333-333333333333" }],
} as const;

describe("DomainEvent (kap. 4 § L2)", () => {
  it("accepts a past-tense event name", () => {
    expect(DomainEventSchema.parse(baseEvent)).toMatchObject({ type: "DomainEvent", layer: "L2" });
  });

  it("rejects imperative event names (events describe what happened)", () => {
    expectIssue(
      DomainEventSchema.safeParse({ ...baseEvent, name: "CreateInvoice" }),
      /past-tense/,
    );
  });

  it("defaults consumes to empty array when omitted", () => {
    const { consumes: _omit, ...minimal } = baseEvent;
    expect(DomainEventSchema.parse(minimal).consumes).toEqual([]);
  });

  it("rejects produces with non-UUID id", () => {
    expectIssue(
      DomainEventSchema.safeParse({
        ...baseEvent,
        produces: { kind: "bounded-context", id: "not-a-uuid" },
      }),
      /uuid/i,
    );
  });
});
