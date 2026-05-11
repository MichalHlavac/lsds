// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import { FRAMEWORK_SCHEMA_VERSION } from "../src/version.js";
import * as frameworkRoot from "../src/index.js";
import { SemverSchema } from "../src/shared/refs.js";

describe("FRAMEWORK_SCHEMA_VERSION", () => {
  it("matches the strict three-part semver shape", () => {
    expect(FRAMEWORK_SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("is parseable by the framework's own SemverSchema", () => {
    expect(SemverSchema.parse(FRAMEWORK_SCHEMA_VERSION)).toBe(FRAMEWORK_SCHEMA_VERSION);
  });

  it("is re-exported from the package root", () => {
    expect((frameworkRoot as { FRAMEWORK_SCHEMA_VERSION: string }).FRAMEWORK_SCHEMA_VERSION).toBe(
      FRAMEWORK_SCHEMA_VERSION,
    );
  });

  // Drift guard: the constant is a contract surface — refactors that
  // accidentally blank, downgrade below 1.0.0, or replace it with a
  // non-string must fail loudly. Bumping this assertion is the *intended*
  // way to change the framework schema version.
  it("equals the currently pinned value (drift guard)", () => {
    expect(FRAMEWORK_SCHEMA_VERSION).toBe("1.0.0");
    expect(typeof FRAMEWORK_SCHEMA_VERSION).toBe("string");
  });
});
