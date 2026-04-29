// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import { SemverSchema, TknRefSchema, UuidSchema } from "../../src/shared/refs.js";

describe("shared refs", () => {
  it("validates a v4 UUID", () => {
    expect(UuidSchema.parse("11111111-1111-4111-8111-111111111111")).toBeDefined();
    expect(UuidSchema.safeParse("not-a-uuid").success).toBe(false);
  });

  it("validates SemVer with optional pre-release / build", () => {
    expect(SemverSchema.parse("1.2.3")).toBe("1.2.3");
    expect(SemverSchema.parse("1.0.0-rc.1+build.42")).toBe("1.0.0-rc.1+build.42");
    expect(SemverSchema.safeParse("1.2").success).toBe(false);
  });

  it("TknRef requires kind=tkn, type, and uuid id", () => {
    expect(
      TknRefSchema.parse({
        kind: "tkn",
        type: "BusinessGoal",
        id: "11111111-1111-4111-8111-111111111111",
      }).type,
    ).toBe("BusinessGoal");
    expect(
      TknRefSchema.safeParse({
        kind: "tkn",
        type: "BusinessGoal",
        id: "not-a-uuid",
      }).success,
    ).toBe(false);
  });
});
