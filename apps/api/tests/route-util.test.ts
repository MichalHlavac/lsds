// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import { toHttpError } from "../src/routes/util.js";

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
