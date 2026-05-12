// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it, vi } from "vitest";
import { app } from "../src/app";

describe("GET /health", () => {
  it("returns 200 when DB is reachable", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("returns full status payload with pool, db, oidc, uptime, ts", async () => {
    const res = await app.request("/health");
    const body = await res.json() as {
      status: string; db: string; oidc: boolean;
      uptime: number; ts: string;
      pool: { size: number; active: number; idle: number; waiting: number };
    };
    expect(body.status).toBe("ok");
    expect(body.db).toBe("ok");
    expect(typeof body.oidc).toBe("boolean");
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof body.ts).toBe("string");
    expect(body.pool).toBeDefined();
    expect(typeof body.pool.size).toBe("number");
    expect(typeof body.pool.active).toBe("number");
    expect(typeof body.pool.idle).toBe("number");
    expect(typeof body.pool.waiting).toBe("number");
  });

  it("returns JSON content-type", async () => {
    const res = await app.request("/health");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("returns 503 with { status: error, db: unreachable } when DB is unreachable", async () => {
    vi.resetModules();
    vi.doMock("../src/db/client.js", () => ({
      sql: Object.assign(
        async function () { throw new Error("connection refused"); },
        { end: async () => {} }
      ),
      DB_POOL_MAX: 10,
      poolStats: { size: 10, open: 0 },
    }));
    const { app: isolatedApp } = await import("../src/app.js");
    const res = await isolatedApp.request("/health");
    expect(res.status).toBe(503);
    const body = await res.json() as { status: string; db: string };
    expect(body.status).toBe("error");
    expect(body.db).toBe("unreachable");
    vi.doUnmock("../src/db/client.js");
    vi.resetModules();
  });
});

describe("GET /health/live", () => {
  it("returns 200", async () => {
    const res = await app.request("/health/live");
    expect(res.status).toBe(200);
  });

  it("returns { status: 'alive' } with ts", async () => {
    const res = await app.request("/health/live");
    const body = await res.json() as { status: string; ts: string };
    expect(body.status).toBe("alive");
    expect(typeof body.ts).toBe("string");
  });

  it("returns JSON content-type", async () => {
    const res = await app.request("/health/live");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("returns 200 even when DB is down", async () => {
    vi.resetModules();
    vi.doMock("../src/db/client.js", () => ({
      sql: Object.assign(
        async function () { throw new Error("connection refused"); },
        { end: async () => {} }
      ),
      DB_POOL_MAX: 10,
      poolStats: { size: 10, open: 0 },
    }));
    const { app: isolatedApp } = await import("../src/app.js");
    const res = await isolatedApp.request("/health/live");
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe("alive");
    vi.doUnmock("../src/db/client.js");
    vi.resetModules();
  });
});

describe("GET /health/ready (readiness)", () => {
  it("returns 200 when DB is reachable", async () => {
    const res = await app.request("/health/ready");
    expect(res.status).toBe(200);
  });

  it("returns { status: 'ready' }", async () => {
    const res = await app.request("/health/ready");
    const body = await res.json() as { status: string };
    expect(body.status).toBe("ready");
  });

  it("returns JSON content-type", async () => {
    const res = await app.request("/health/ready");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("returns 503 with { status: 'unavailable', reason: 'db' } when DB is unreachable", async () => {
    vi.resetModules();
    vi.doMock("../src/db/client.js", () => ({
      sql: Object.assign(
        async function () { throw new Error("connection refused"); },
        { end: async () => {} }
      ),
      DB_POOL_MAX: 10,
      poolStats: { size: 10, open: 0 },
    }));
    const { app: brokenApp } = await import("../src/app.js");
    const res = await brokenApp.request("/health/ready");
    expect(res.status).toBe(503);
    const body = await res.json() as { status: string; reason: string };
    expect(body.status).toBe("unavailable");
    expect(body.reason).toBe("db");
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
