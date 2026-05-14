// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import { parsePaginationLimit, toHttpError } from "../src/routes/util.js";

describe("toHttpError", () => {
  it("returns 400 with domain message for a plain Error", () => {
    const [body, status] = toHttpError(new Error("node already archived"));
    expect(status).toBe(400);
    expect(body.error).toBe("node already archived");
  });

  it("returns 500 generic for a postgres-pattern error message", () => {
    const [body, status] = toHttpError(new Error("connection refused (postgres)"));
    expect(status).toBe(500);
    expect(body.error).toBe("internal server error");
  });

  it("returns 500 generic for 'pg' in the message", () => {
    const [body, status] = toHttpError(new Error("pg pool exhausted"));
    expect(status).toBe(500);
    expect(body.error).toBe("internal server error");
  });

  it("returns 500 generic for 'sql' in the message", () => {
    const [body, status] = toHttpError(new Error("sql syntax error"));
    expect(status).toBe(500);
    expect(body.error).toBe("internal server error");
  });

  it("returns 500 generic for 'timeout' in the message", () => {
    const [body, status] = toHttpError(new Error("query timeout exceeded"));
    expect(status).toBe(500);
    expect(body.error).toBe("internal server error");
  });

  it("returns 500 generic for a null throw", () => {
    const [body, status] = toHttpError(null);
    expect(status).toBe(500);
    expect(body.error).toBe("internal server error");
  });

  it("returns 500 generic for a non-Error object throw", () => {
    const [body, status] = toHttpError({ code: 42 });
    expect(status).toBe(500);
    expect(body.error).toBe("internal server error");
  });

  it("returns 500 generic for an Error with an empty message", () => {
    const [body, status] = toHttpError(new Error(""));
    expect(status).toBe(500);
    expect(body.error).toBe("internal server error");
  });

  it("never exposes DB internals in the response body", () => {
    const dbError = new Error("ERROR: duplicate key value violates unique constraint pg_users_pkey");
    const [body] = toHttpError(dbError);
    expect(body.error).not.toContain("pg_users");
    expect(body.error).not.toContain("duplicate key");
  });
});

describe("parsePaginationLimit", () => {
  // undefined → defaultVal
  it("returns defaultVal when raw is undefined", () => {
    expect(parsePaginationLimit(undefined, 50, 500)).toBe(50);
  });

  // NaN guard
  it("returns defaultVal when raw is a non-numeric string", () => {
    expect(parsePaginationLimit("abc", 50, 500)).toBe(50);
  });

  it("clamps to 1 for empty string (Number('') = 0)", () => {
    // Number("") === 0, so max(1, 0) clamps to 1 rather than falling back to defaultVal
    expect(parsePaginationLimit("", 50, 500)).toBe(1);
  });

  it("clamps to 1 for whitespace string (Number('   ') = 0)", () => {
    // Number("   ") === 0, treated the same as "0" — clamps to 1
    expect(parsePaginationLimit("   ", 50, 500)).toBe(1);
  });

  // min(1) clamp
  it("clamps to 1 when raw is '0'", () => {
    expect(parsePaginationLimit("0", 50, 500)).toBe(1);
  });

  it("clamps to 1 when raw is a negative number string", () => {
    expect(parsePaginationLimit("-5", 50, 500)).toBe(1);
  });

  it("clamps to 1 when raw is '-1000'", () => {
    expect(parsePaginationLimit("-1000", 50, 500)).toBe(1);
  });

  // max clamp
  it("clamps to max when raw exceeds max", () => {
    expect(parsePaginationLimit("999", 50, 200)).toBe(200);
  });

  it("clamps to max when raw equals max + 1", () => {
    expect(parsePaginationLimit("501", 50, 500)).toBe(500);
  });

  // valid integer strings
  it("parses a valid integer string within bounds", () => {
    expect(parsePaginationLimit("25", 50, 500)).toBe(25);
  });

  it("parses the exact max value", () => {
    expect(parsePaginationLimit("500", 50, 500)).toBe(500);
  });

  it("parses the minimum valid value of 1", () => {
    expect(parsePaginationLimit("1", 50, 500)).toBe(1);
  });

  // defaultVal is itself subject to max clamp (not a NaN case)
  it("clamps defaultVal to max when defaultVal exceeds max", () => {
    expect(parsePaginationLimit(undefined, 999, 200)).toBe(200);
  });

  // defaultVal lower-bounds via max(1)
  it("clamps defaultVal to 1 when defaultVal is 0", () => {
    expect(parsePaginationLimit(undefined, 0, 500)).toBe(1);
  });
});
