import { describe, expect, it } from "vitest";
import { BoundedContextSchema } from "../../../src/types/l2/bounded-context.js";
import { expectIssue, sampleTeam, tknBase } from "../../fixtures.js";

const longDef = (term: string) =>
  `${term} is a precise term in the ubiquitous language describing ${term} usage in this bounded context.`;

const baseContext = {
  ...tknBase({ type: "BoundedContext", layer: "L2", name: "Billing" }),
  description: "Authoritative billing context for invoices, charges and refunds.",
  ubiquitousLanguage: [
    { term: "Invoice", definition: longDef("Invoice") },
    { term: "Charge", definition: longDef("Charge") },
    { term: "Refund", definition: longDef("Refund") },
  ],
  owner: sampleTeam,
  domainType: "CORE",
  maturity: "DEFINED",
} as const;

describe("BoundedContext (kap. 4 § L2)", () => {
  it("accepts a fully populated context", () => {
    expect(BoundedContextSchema.parse(baseContext)).toMatchObject({
      type: "BoundedContext",
      layer: "L2",
    });
  });

  it("rejects fewer than 3 ubiquitous-language terms (kap. 4 invariant)", () => {
    expectIssue(
      BoundedContextSchema.safeParse({
        ...baseContext,
        ubiquitousLanguage: baseContext.ubiquitousLanguage.slice(0, 2),
      }),
      /at least 3 terms/,
    );
  });

  it("rejects duplicate ubiquitousLanguage terms (case-insensitive)", () => {
    expectIssue(
      BoundedContextSchema.safeParse({
        ...baseContext,
        ubiquitousLanguage: [
          { term: "Invoice", definition: longDef("Invoice") },
          { term: "invoice", definition: longDef("invoice") },
          { term: "Refund", definition: longDef("Refund") },
        ],
      }),
      /must be unique/,
    );
  });

  it("rejects a term whose definition is shorter than 30 chars", () => {
    expectIssue(
      BoundedContextSchema.safeParse({
        ...baseContext,
        ubiquitousLanguage: [
          { term: "Invoice", definition: "too short" },
          { term: "Charge", definition: longDef("Charge") },
          { term: "Refund", definition: longDef("Refund") },
        ],
      }),
      /at least 30 characters/,
    );
  });

  it("rejects unknown domainType (closed enum, no freetext)", () => {
    expectIssue(
      BoundedContextSchema.safeParse({ ...baseContext, domainType: "ANCHOR" }),
      /Invalid enum value/,
    );
  });

  it("rejects unknown maturity", () => {
    expectIssue(
      BoundedContextSchema.safeParse({ ...baseContext, maturity: "MATURE" }),
      /Invalid enum value/,
    );
  });

  it("rejects layer other than L2", () => {
    expectIssue(BoundedContextSchema.safeParse({ ...baseContext, layer: "L1" }), /Invalid literal value/);
  });
});
