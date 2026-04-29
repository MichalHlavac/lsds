import { describe, expect, it } from "vitest";
import { LanguageTermSchema } from "../../../src/types/l2/language-term.js";
import { expectIssue, tknBase } from "../../fixtures.js";

const baseTerm = {
  ...tknBase({ type: "LanguageTerm", layer: "L2", name: "Invoice" }),
  term: "Invoice",
  definition:
    "An invoice is a billing document issued to a customer requesting payment for goods or services.",
  examples: ["Subscription invoice", "One-time charge invoice"],
  antiPatterns: ["Receipt", "Quote"],
  context: {
    kind: "bounded-context",
    id: "22222222-2222-4222-8222-222222222222",
  },
} as const;

describe("LanguageTerm (kap. 4 § L2)", () => {
  it("accepts a fully populated term", () => {
    expect(LanguageTermSchema.parse(baseTerm)).toMatchObject({ type: "LanguageTerm", layer: "L2" });
  });

  it("rejects definition shorter than 30 characters (kap. 4 invariant)", () => {
    expectIssue(
      LanguageTermSchema.safeParse({ ...baseTerm, definition: "too short" }),
      /at least 30 characters/,
    );
  });

  it("defaults examples and antiPatterns to empty arrays", () => {
    const { examples: _ex, antiPatterns: _ap, ...minimal } = baseTerm;
    const parsed = LanguageTermSchema.parse(minimal);
    expect(parsed.examples).toEqual([]);
    expect(parsed.antiPatterns).toEqual([]);
  });

  it("rejects context with non-UUID id", () => {
    expectIssue(
      LanguageTermSchema.safeParse({
        ...baseTerm,
        context: { kind: "bounded-context", id: "not-a-uuid" },
      }),
      /uuid/i,
    );
  });
});
