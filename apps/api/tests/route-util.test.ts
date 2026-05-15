// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, parsePaginationLimit, toHttpError } from "../src/routes/util.js";

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

describe("encodeCursor / decodeCursor", () => {
  it("round-trips: decodeCursor(encodeCursor(v, id)) returns original values", () => {
    expect(decodeCursor(encodeCursor("1.0", "abc-123"))).toEqual({ v: "1.0", id: "abc-123" });
  });

  it("round-trips with values that contain base64url-unsafe characters", () => {
    expect(decodeCursor(encodeCursor("node:v2", "id/with+chars="))).toEqual({
      v: "node:v2",
      id: "id/with+chars=",
    });
  });

  it("encodeCursor produces a base64url string (no +, /, or = padding)", () => {
    const cursor = encodeCursor("v1", "some-id");
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("decodeCursor returns null for empty string", () => {
    expect(decodeCursor("")).toBeNull();
  });

  it("decodeCursor returns null for non-base64url garbage characters", () => {
    expect(decodeCursor("!!!not-base64!!!")).toBeNull();
  });

  it("decodeCursor returns null for valid base64url encoding of non-JSON bytes", () => {
    const raw = Buffer.from("not json at all", "utf8").toString("base64url");
    expect(decodeCursor(raw)).toBeNull();
  });

  it("decodeCursor returns null for valid JSON string (not an object)", () => {
    const raw = Buffer.from(JSON.stringify("just-a-string"), "utf8").toString("base64url");
    expect(decodeCursor(raw)).toBeNull();
  });

  it("decodeCursor returns null for JSON null", () => {
    const raw = Buffer.from(JSON.stringify(null), "utf8").toString("base64url");
    expect(decodeCursor(raw)).toBeNull();
  });

  it("decodeCursor returns null for empty JSON object (missing both fields)", () => {
    const raw = Buffer.from(JSON.stringify({}), "utf8").toString("base64url");
    expect(decodeCursor(raw)).toBeNull();
  });

  it("decodeCursor returns null when v field is missing", () => {
    const raw = Buffer.from(JSON.stringify({ id: "abc" }), "utf8").toString("base64url");
    expect(decodeCursor(raw)).toBeNull();
  });

  it("decodeCursor returns null when id field is missing", () => {
    const raw = Buffer.from(JSON.stringify({ v: "1.0" }), "utf8").toString("base64url");
    expect(decodeCursor(raw)).toBeNull();
  });

  it("decodeCursor returns null when v is a number, not a string", () => {
    const raw = Buffer.from(JSON.stringify({ v: 1, id: "abc" }), "utf8").toString("base64url");
    expect(decodeCursor(raw)).toBeNull();
  });

  it("decodeCursor returns null when id is a number, not a string", () => {
    const raw = Buffer.from(JSON.stringify({ v: "1.0", id: 42 }), "utf8").toString("base64url");
    expect(decodeCursor(raw)).toBeNull();
  });

  it("decodeCursor returns null when both fields are null", () => {
    const raw = Buffer.from(JSON.stringify({ v: null, id: null }), "utf8").toString("base64url");
    expect(decodeCursor(raw)).toBeNull();
  });
});
