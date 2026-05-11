// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect } from "vitest";
import { dbSeverityToFramework } from "../src/db/severity";

describe("dbSeverityToFramework", () => {
  it("maps ERROR → ERROR", () => {
    expect(dbSeverityToFramework("ERROR")).toBe("ERROR");
  });

  it("maps WARN → WARNING", () => {
    expect(dbSeverityToFramework("WARN")).toBe("WARNING");
  });

  it("maps INFO → INFO", () => {
    expect(dbSeverityToFramework("INFO")).toBe("INFO");
  });

  it("throws on unknown DB severity value", () => {
    expect(() => dbSeverityToFramework("CRITICAL")).toThrow(
      'Unmapped DB severity value: "CRITICAL"'
    );
  });

  it("throws on empty string", () => {
    expect(() => dbSeverityToFramework("")).toThrow("Unmapped DB severity value");
  });
});
