import { describe, expect, it } from "vitest";
import {
  CHANGE_POLICIES,
  LAYERS,
  LAYER_IDS,
  getChangePolicy,
  getLayer,
  getLayerOrdinal,
} from "../src/layer/index.js";

describe("layer table (kap. 3 + A4)", () => {
  it("exposes six layers L1..L6 in ordinal order", () => {
    expect(LAYER_IDS).toEqual(["L1", "L2", "L3", "L4", "L5", "L6"]);
    expect(LAYERS.map((l) => l.ordinal)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("encodes layer-dependent change policy from A4", () => {
    expect(getChangePolicy("L1")).toBe("REQUIRE_CONFIRMATION");
    expect(getChangePolicy("L2")).toBe("REQUIRE_CONFIRMATION");
    expect(getChangePolicy("L3")).toBe("AUTO_WITH_OVERRIDE");
    expect(getChangePolicy("L4")).toBe("AUTO_WITH_OVERRIDE");
    expect(getChangePolicy("L5")).toBe("AUTO");
    expect(getChangePolicy("L6")).toBe("AUTO");
  });

  it("only knows the three A4 policies", () => {
    expect([...CHANGE_POLICIES]).toEqual(["REQUIRE_CONFIRMATION", "AUTO_WITH_OVERRIDE", "AUTO"]);
  });

  it("getLayerOrdinal returns ordinal for known ids", () => {
    expect(getLayerOrdinal("L1")).toBe(1);
    expect(getLayerOrdinal("L6")).toBe(6);
  });

  it("getLayer rejects unknown ids", () => {
    expect(() => getLayer("L7" as never)).toThrow(/unknown layer/);
  });
});
