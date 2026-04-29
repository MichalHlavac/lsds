import { describe, expect, it } from "vitest";
import { AggregateSchema } from "../../../src/types/l2/aggregate.js";
import { expectIssue, tknBase } from "../../fixtures.js";

const baseAggregate = {
  ...tknBase({ type: "Aggregate", layer: "L2", name: "InvoiceAggregate" }),
  description: "Invoice and its line items committed atomically.",
  rootEntity: { kind: "domain-entity", id: "44444444-4444-4444-8444-444444444444" },
  invariants: ["sum(lineItems.amountCents) == totalCents"],
  transactionBoundary: "Issuing or amending an invoice updates header + all line items in one DB tx.",
} as const;

describe("Aggregate (kap. 4 § L2)", () => {
  it("accepts a fully populated aggregate", () => {
    expect(AggregateSchema.parse(baseAggregate)).toMatchObject({ type: "Aggregate", layer: "L2" });
  });

  it("rejects empty invariants", () => {
    expectIssue(
      AggregateSchema.safeParse({ ...baseAggregate, invariants: [] }),
      /at least one invariant/,
    );
  });

  it("rejects empty transactionBoundary", () => {
    expectIssue(
      AggregateSchema.safeParse({ ...baseAggregate, transactionBoundary: "" }),
      /must describe what is committed atomically/,
    );
  });

  it("rejects rootEntity with non-UUID id", () => {
    expectIssue(
      AggregateSchema.safeParse({
        ...baseAggregate,
        rootEntity: { kind: "domain-entity", id: "nope" },
      }),
      /uuid/i,
    );
  });
});
