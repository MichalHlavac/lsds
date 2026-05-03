// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it, vi } from "vitest";
import { app } from "../src/app";

describe("GET /health", () => {
  it("returns 200", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("returns { status: 'ok' }", async () => {
    const res = await app.request("/health");
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok" });
  });

  it("returns JSON content-type", async () => {
    const res = await app.request("/health");
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

describe("GET /health — DB liveness", () => {
  it("includes db: ok when DB is reachable", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; db: string };
    expect(body.db).toBe("ok");
  });

  it("returns 503 with db: unreachable when DB throws", async () => {
    vi.resetModules();
    vi.doMock("../src/db/client.js", () => ({
      sql: Object.assign(
        async function () { throw new Error("connection refused"); },
        { end: async () => {} }
      ),
    }));
    const { app: brokenApp } = await import("../src/app.js");
    const res = await brokenApp.request("/health");
    expect(res.status).toBe(503);
    const body = await res.json() as { status: string; db: string };
    expect(body.status).toBe("error");
    expect(body.db).toBe("unreachable");
    vi.doUnmock("../src/db/client.js");
    vi.resetModules();
  });
});

describe("unknown routes", () => {
  it("returns 404", async () => {
    const res = await app.request("/nonexistent");
    expect(res.status).toBe(404);
  });
});
