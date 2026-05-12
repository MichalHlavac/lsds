// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { afterEach, describe, expect, it, vi } from "vitest";

// LSDS-928 — registry.ts must parse every catalog rule via GuardrailRuleSchema
// inside its module-load IIFE so malformed rules fail at import time, mirroring
// relationship/registry.ts:415. This test injects an invalid rule via vi.doMock
// and asserts the dynamic import of the registry rejects.

describe("guardrail registry module-load validation", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../../src/guardrail/catalog.js");
  });

  it("throws at import time when the catalog contains an invalid rule", async () => {
    vi.resetModules();
    vi.doMock("../../src/guardrail/catalog.js", () => ({
      GUARDRAIL_CATALOG: Object.freeze([
        {
          // Malformed: rule_id layer prefix disagrees with `layer` field,
          // rationale/remediation too short — multiple schema violations.
          rule_id: "GR-L2-999",
          name: "broken sample",
          layer: "L1",
          origin: "STRUCTURAL",
          evaluation: "PRESCRIPTIVE",
          severity: "ERROR",
          scope: { object_type: "BusinessGoal", triggers: ["CREATE"] },
          condition: "true",
          rationale: "too short",
          remediation: "fix",
          propagation: "NONE",
        },
      ]),
    }));

    await expect(import("../../src/guardrail/registry.js")).rejects.toThrow();
  });

  it("loads cleanly when the catalog is valid (sanity)", async () => {
    vi.resetModules();
    // No mock — uses the real catalog.
    await expect(import("../../src/guardrail/registry.js")).resolves.toBeDefined();
  });
});
