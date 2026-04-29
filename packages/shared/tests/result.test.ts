// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, expectTypeOf, it } from "vitest";
import type { Result } from "../src/index";

describe("Result<T, E> — ok variant", () => {
  it("holds value when ok is true", () => {
    const r: Result<number> = { ok: true, value: 42 };
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe(42);
    }
  });

  it("does not carry an error property", () => {
    const r: Result<string> = { ok: true, value: "hello" };
    expect("error" in r).toBe(false);
  });

  it("value type matches the type parameter", () => {
    const r: Result<string> = { ok: true, value: "hello" };
    if (r.ok) {
      expectTypeOf(r.value).toBeString();
    }
  });
});

describe("Result<T, E> — error variant", () => {
  it("holds error when ok is false", () => {
    const err = new Error("something went wrong");
    const r: Result<number> = { ok: false, error: err };
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(err);
    }
  });

  it("does not carry a value property", () => {
    const r: Result<number> = { ok: false, error: new Error() };
    expect("value" in r).toBe(false);
  });

  it("defaults error type to Error", () => {
    const r: Result<number> = { ok: false, error: new Error("fail") };
    if (!r.ok) {
      expectTypeOf(r.error).toEqualTypeOf<Error>();
    }
  });

  it("accepts a custom error type", () => {
    const r: Result<number, string> = { ok: false, error: "custom" };
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("custom");
      expectTypeOf(r.error).toBeString();
    }
  });
});

describe("Result<T, E> — discriminant exhaustiveness", () => {
  it("covers both branches via ok discriminant", () => {
    function unwrap<T>(r: Result<T>): T {
      if (r.ok) return r.value;
      throw r.error;
    }

    expect(unwrap({ ok: true, value: 99 })).toBe(99);
    expect(() => unwrap({ ok: false, error: new Error("boom") })).toThrow("boom");
  });
});
