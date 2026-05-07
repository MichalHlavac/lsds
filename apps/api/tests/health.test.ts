// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it, vi } from "vitest";
import { app } from "../src/app";

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

describe("GET /health/ready", () => {
  it("returns 200 when DB is reachable and migrations are current", async () => {
    const res = await app.request("/health/ready");
    expect(res.status).toBe(200);
  });

  it("returns { status: 'ready', migrations: 'current' } with pool stats", async () => {
    const res = await app.request("/health/ready");
    const body = await res.json() as {
      status: string;
      db: { poolSize: number; idleCount: number; waitingCount: number };
      migrations: string;
      ts: string;
    };
    expect(body.status).toBe("ready");
    expect(body.migrations).toBe("current");
    expect(typeof body.db.poolSize).toBe("number");
    expect(typeof body.db.idleCount).toBe("number");
    expect(typeof body.db.waitingCount).toBe("number");
    expect(typeof body.ts).toBe("string");
  });

  it("returns JSON content-type", async () => {
    const res = await app.request("/health/ready");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("returns 503 when DB is unreachable", async () => {
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
    const body = await res.json() as { status: string; db: string };
    expect(body.status).toBe("not_ready");
    expect(body.db).toBe("unreachable");
    vi.doUnmock("../src/db/client.js");
    vi.resetModules();
  });

  it("returns 503 when migrations are pending", async () => {
    vi.resetModules();
    vi.doMock("../src/db/client.js", () => {
      const mockSql = Object.assign(
        async function mockQuery(strings: TemplateStringsArray) {
          const q = strings[0] ?? "";
          if (q.trim().startsWith("SELECT 1")) return [{}];
          if (q.includes("_migrations")) return []; // empty = no migrations applied
          // pg_stat_activity
          return [{ idle: "3", waiting: "0" }];
        },
        { end: async () => {} }
      );
      return { sql: mockSql, DB_POOL_MAX: 10, poolStats: { size: 10, open: 3 } };
    });
    const { app: pendingApp } = await import("../src/app.js");
    const res = await pendingApp.request("/health/ready");
    expect(res.status).toBe(503);
    const body = await res.json() as { status: string; migrations: string };
    expect(body.status).toBe("not_ready");
    expect(body.migrations).toBe("pending");
    vi.doUnmock("../src/db/client.js");
    vi.resetModules();
  });
});

describe("GET /health (combined alias)", () => {
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
      DB_POOL_MAX: 10,
      poolStats: { size: 10, open: 0 },
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
