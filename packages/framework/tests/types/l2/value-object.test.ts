// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import { ValueObjectSchema } from "../../../src/types/l2/value-object.js";
import { expectIssue, tknBase } from "../../fixtures.js";

const baseValueObject = {
  ...tknBase({ type: "ValueObject", layer: "L2", name: "Money" }),
  description: "An amount in a specific currency, immutable.",
  attributes: [
    { name: "amountCents", type: "number" },
    { name: "currency", type: "ISO4217" },
  ],
} as const;

describe("ValueObject (kap. 4 § L2)", () => {
  it("accepts a fully populated value object", () => {
    expect(ValueObjectSchema.parse(baseValueObject)).toMatchObject({ type: "ValueObject", layer: "L2" });
  });

  it("defaults immutable to true", () => {
    expect(ValueObjectSchema.parse(baseValueObject).immutable).toBe(true);
  });

  it("rejects immutable=false (value objects are immutable by definition)", () => {
    expectIssue(
      ValueObjectSchema.safeParse({ ...baseValueObject, immutable: false }),
      /Invalid literal value/,
    );
  });

  it("rejects empty attributes", () => {
    expectIssue(
      ValueObjectSchema.safeParse({ ...baseValueObject, attributes: [] }),
      /at least one attribute/,
    );
  });
});
