// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  MINOR_PROPAGATING_RELATIONSHIPS,
  propagatesOver,
  propagationFor,
} from "../../src/change";

describe("propagationFor — kap. 2.7", () => {
  it("MAJOR → ERROR + ALL_RELATIONSHIPS", () => {
    const p = propagationFor("MAJOR");
    expect(p.staleSeverity).toBe("ERROR");
    expect(p.mode).toBe("ALL_RELATIONSHIPS");
    expect(p.selectedRelationships).toEqual([]);
  });

  it("MINOR → WARNING + SELECTED (realizes/implements/traces-to)", () => {
    const p = propagationFor("MINOR");
    expect(p.staleSeverity).toBe("WARNING");
    expect(p.mode).toBe("SELECTED_RELATIONSHIPS");
    expect([...p.selectedRelationships].sort()).toEqual([
      "implements",
      "realizes",
      "traces-to",
    ]);
  });

  it("PATCH → INFO + DIRECT_PARENTS (no traversal)", () => {
    const p = propagationFor("PATCH");
    expect(p.staleSeverity).toBe("INFO");
    expect(p.mode).toBe("DIRECT_PARENTS");
    expect(p.selectedRelationships).toEqual([]);
  });
});

describe("propagatesOver", () => {
  it("MAJOR propagates over any relationship", () => {
    expect(propagatesOver("MAJOR", "realizes")).toBe(true);
    expect(propagatesOver("MAJOR", "part-of")).toBe(true);
    expect(propagatesOver("MAJOR", "depends-on")).toBe(true);
    expect(propagatesOver("MAJOR", "anything-custom")).toBe(true);
  });

  it("MINOR only propagates over realizes/implements/traces-to", () => {
    for (const rel of MINOR_PROPAGATING_RELATIONSHIPS) {
      expect(propagatesOver("MINOR", rel)).toBe(true);
    }
    expect(propagatesOver("MINOR", "part-of")).toBe(false);
    expect(propagatesOver("MINOR", "depends-on")).toBe(false);
    expect(propagatesOver("MINOR", "owns")).toBe(false);
  });

  it("PATCH never propagates traversally", () => {
    expect(propagatesOver("PATCH", "realizes")).toBe(false);
    expect(propagatesOver("PATCH", "implements")).toBe(false);
    expect(propagatesOver("PATCH", "part-of")).toBe(false);
    expect(propagatesOver("PATCH", "anything")).toBe(false);
  });
});
