// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect } from "vitest";
import { assertMigrationCount } from "./global-setup";

const TEST_URL = "postgres://lsds:lsds@localhost:5432/lsds";
const TOTAL = 25;
const MINIMUM = Math.ceil(TOTAL * 0.8); // 20

describe("assertMigrationCount — positive cases", () => {
  it("does not throw when count equals the minimum", () => {
    expect(() => assertMigrationCount(MINIMUM, MINIMUM, TOTAL, TEST_URL)).not.toThrow();
  });

  it("does not throw when count exceeds the minimum", () => {
    expect(() => assertMigrationCount(TOTAL, MINIMUM, TOTAL, TEST_URL)).not.toThrow();
    expect(() => assertMigrationCount(MINIMUM + 1, MINIMUM, TOTAL, TEST_URL)).not.toThrow();
  });
});

describe("assertMigrationCount — negative cases", () => {
  it("throws when count is zero (wrong or empty DB)", () => {
    expect(() => assertMigrationCount(0, MINIMUM, TOTAL, TEST_URL)).toThrow(
      /Startup assertion failed/,
    );
  });

  it("throws when count is just below the minimum", () => {
    expect(() => assertMigrationCount(MINIMUM - 1, MINIMUM, TOTAL, TEST_URL)).toThrow(
      /Startup assertion failed/,
    );
  });

  it("error message includes the DATABASE_URL so the operator can identify the wrong instance", () => {
    let caught: Error | undefined;
    try {
      assertMigrationCount(0, MINIMUM, TOTAL, TEST_URL);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain(TEST_URL);
  });

  it("error message hints at DB_PORT so the operator knows where to look", () => {
    let caught: Error | undefined;
    try {
      assertMigrationCount(0, MINIMUM, TOTAL, TEST_URL);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain("DB_PORT");
  });

  it("error message states the observed and expected counts", () => {
    let caught: Error | undefined;
    try {
      assertMigrationCount(3, MINIMUM, TOTAL, TEST_URL);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toContain("3 row(s)");
    expect(caught!.message).toContain(`>= ${MINIMUM}`);
  });
});
