import { describe, expect, it } from "vitest";
import {
  LIFECYCLES,
  LifecycleSchema,
  LifecycleTransitionError,
  assertLifecycleTransition,
  canTransitionLifecycle,
  isTerminalLifecycle,
  lifecycleSuccessors,
} from "../src/lifecycle";

describe("LifecycleSchema", () => {
  it.each(LIFECYCLES)("accepts %s", (state) => {
    expect(() => LifecycleSchema.parse(state)).not.toThrow();
  });

  it("rejects unknown lifecycle states", () => {
    expect(() => LifecycleSchema.parse("DRAFT")).toThrow();
  });
});

describe("canTransitionLifecycle", () => {
  it("walks the canonical path ACTIVE → DEPRECATED → ARCHIVED → PURGE", () => {
    expect(canTransitionLifecycle("ACTIVE", "DEPRECATED")).toBe(true);
    expect(canTransitionLifecycle("DEPRECATED", "ARCHIVED")).toBe(true);
    expect(canTransitionLifecycle("ARCHIVED", "PURGE")).toBe(true);
  });

  it("allows ACTIVE → ARCHIVED (skip deprecation when never released)", () => {
    expect(canTransitionLifecycle("ACTIVE", "ARCHIVED")).toBe(true);
  });

  it("allows DEPRECATED → ACTIVE (revert premature deprecation)", () => {
    expect(canTransitionLifecycle("DEPRECATED", "ACTIVE")).toBe(true);
  });

  it("forbids skipping straight to PURGE", () => {
    expect(canTransitionLifecycle("ACTIVE", "PURGE")).toBe(false);
    expect(canTransitionLifecycle("DEPRECATED", "PURGE")).toBe(false);
  });

  it("forbids resurrection from ARCHIVED or PURGE", () => {
    expect(canTransitionLifecycle("ARCHIVED", "ACTIVE")).toBe(false);
    expect(canTransitionLifecycle("ARCHIVED", "DEPRECATED")).toBe(false);
    expect(canTransitionLifecycle("PURGE", "ACTIVE")).toBe(false);
    expect(canTransitionLifecycle("PURGE", "ARCHIVED")).toBe(false);
  });

  it("forbids self-transitions", () => {
    for (const state of LIFECYCLES) {
      expect(canTransitionLifecycle(state, state)).toBe(false);
    }
  });
});

describe("assertLifecycleTransition", () => {
  it("throws LifecycleTransitionError on illegal transitions", () => {
    expect(() => assertLifecycleTransition("ACTIVE", "PURGE")).toThrow(
      LifecycleTransitionError,
    );
  });

  it("does not throw on legal transitions", () => {
    expect(() => assertLifecycleTransition("ACTIVE", "DEPRECATED")).not.toThrow();
  });
});

describe("lifecycleSuccessors", () => {
  it("returns terminal=[] for PURGE", () => {
    expect(lifecycleSuccessors("PURGE")).toEqual([]);
  });

  it("returns the legal forward set for ACTIVE", () => {
    expect([...lifecycleSuccessors("ACTIVE")].sort()).toEqual(
      ["ARCHIVED", "DEPRECATED"].sort(),
    );
  });
});

describe("isTerminalLifecycle", () => {
  it("flags only PURGE as terminal", () => {
    expect(isTerminalLifecycle("PURGE")).toBe(true);
    expect(isTerminalLifecycle("ARCHIVED")).toBe(false);
    expect(isTerminalLifecycle("DEPRECATED")).toBe(false);
    expect(isTerminalLifecycle("ACTIVE")).toBe(false);
  });
});
