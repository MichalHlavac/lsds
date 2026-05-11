// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect } from "vitest";
import { MAX_ATTEMPTS, BACKOFF_SECONDS } from "../src/webhooks/db.js";

// Product invariant: 6 retry attempts spread over ~53 minutes.
// Changing these constants is a product decision, not a typo — this test
// forces that change to be intentional.

const EXPECTED_ATTEMPTS = 6;
const EXPECTED_TOTAL_SECS = 53 * 60; // 3180s
const TOLERANCE_SECS = 5 * 60;       // ±5 min

describe("webhook retry schedule contract", () => {
  it("defines exactly 6 retry attempts", () => {
    expect(MAX_ATTEMPTS).toBe(EXPECTED_ATTEMPTS);
    expect(BACKOFF_SECONDS).toHaveLength(EXPECTED_ATTEMPTS);
  });

  it("cumulative delay is within ~53 min ± 5 min", () => {
    const totalSecs = BACKOFF_SECONDS.reduce((sum, s) => sum + s, 0);
    expect(totalSecs).toBeGreaterThanOrEqual(EXPECTED_TOTAL_SECS - TOLERANCE_SECS);
    expect(totalSecs).toBeLessThanOrEqual(EXPECTED_TOTAL_SECS + TOLERANCE_SECS);
  });

  it("backoff delays are non-negative and non-decreasing", () => {
    for (let i = 0; i < BACKOFF_SECONDS.length; i++) {
      expect(BACKOFF_SECONDS[i]).toBeGreaterThanOrEqual(0);
      if (i > 0) {
        expect(BACKOFF_SECONDS[i]).toBeGreaterThanOrEqual(BACKOFF_SECONDS[i - 1]!);
      }
    }
  });

  // ── Negative: adding an attempt breaks the invariant ──────────────────────

  it("negative: array with 7 entries violates the 6-attempt invariant", () => {
    const mutated = [...BACKOFF_SECONDS, 3600];
    expect(mutated).not.toHaveLength(EXPECTED_ATTEMPTS);
  });

  it("negative: removing an attempt violates the 6-attempt invariant", () => {
    const mutated = BACKOFF_SECONDS.slice(0, -1);
    expect(mutated).not.toHaveLength(EXPECTED_ATTEMPTS);
  });

  it("negative: shifting last delay to 7200s exceeds the ±5 min tolerance", () => {
    const mutated = [...BACKOFF_SECONDS.slice(0, -1), 7200] as number[];
    const totalSecs = mutated.reduce((sum, s) => sum + s, 0);
    expect(totalSecs).toBeGreaterThan(EXPECTED_TOTAL_SECS + TOLERANCE_SECS);
  });

  it("negative: zeroing all delays falls below the lower tolerance bound", () => {
    const mutated = BACKOFF_SECONDS.map(() => 0);
    const totalSecs = mutated.reduce((sum, s) => sum + s, 0);
    expect(totalSecs).toBeLessThan(EXPECTED_TOTAL_SECS - TOLERANCE_SECS);
  });
});
