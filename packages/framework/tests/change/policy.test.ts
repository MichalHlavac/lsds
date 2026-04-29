// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import { CHANGE_POLICIES } from "../../src/layer/index";
import {
  LAYER_POLICY,
  layersByPolicy,
  OBJECT_LAYERS,
  policyForLayer,
} from "../../src/change";

describe("policyForLayer — ADR-004", () => {
  it("L1 and L2 require confirmation", () => {
    expect(policyForLayer("L1")).toBe("REQUIRE_CONFIRMATION");
    expect(policyForLayer("L2")).toBe("REQUIRE_CONFIRMATION");
  });

  it("L3 and L4 auto with override", () => {
    expect(policyForLayer("L3")).toBe("AUTO_WITH_OVERRIDE");
    expect(policyForLayer("L4")).toBe("AUTO_WITH_OVERRIDE");
  });

  it("L5 and L6 auto", () => {
    expect(policyForLayer("L5")).toBe("AUTO");
    expect(policyForLayer("L6")).toBe("AUTO");
  });

  it("covers every object layer", () => {
    for (const layer of OBJECT_LAYERS) {
      expect(LAYER_POLICY[layer]).toBeDefined();
    }
  });

  it("every declared policy is used", () => {
    const used = new Set(Object.values(LAYER_POLICY));
    for (const policy of CHANGE_POLICIES) {
      expect(used.has(policy)).toBe(true);
    }
  });
});

describe("layersByPolicy", () => {
  it("groups layers correctly", () => {
    expect(layersByPolicy("REQUIRE_CONFIRMATION")).toEqual(["L1", "L2"]);
    expect(layersByPolicy("AUTO_WITH_OVERRIDE")).toEqual(["L3", "L4"]);
    expect(layersByPolicy("AUTO")).toEqual(["L5", "L6"]);
  });
});
