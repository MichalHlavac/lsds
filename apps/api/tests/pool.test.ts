// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import { app } from "../src/app";
import { sql, DB_POOL_MAX, poolStats } from "../src/db/client";

describe("connection pool — /health metrics shape", () => {
  it("exposes pool object with size, active, idle, waiting", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.pool).toBeDefined();
    const pool = body.pool as Record<string, unknown>;
    expect(typeof pool.size).toBe("number");
    expect(typeof pool.active).toBe("number");
    expect(typeof pool.idle).toBe("number");
    expect(typeof pool.waiting).toBe("number");
  });

  it("pool.size matches DB_POOL_MAX", async () => {
    const res = await app.request("/health");
    const body = await res.json() as { pool: { size: number } };
    expect(body.pool.size).toBe(DB_POOL_MAX);
  });

  it("pool.active + pool.idle >= 0", async () => {
    const res = await app.request("/health");
    const body = await res.json() as { pool: { active: number; idle: number } };
    expect(body.pool.active).toBeGreaterThanOrEqual(0);
    expect(body.pool.idle).toBeGreaterThanOrEqual(0);
  });
});

describe("connection pool — concurrent request handling", () => {
  it("handles 20 concurrent /health requests without errors", async () => {
    const N = 20;
    const results = await Promise.all(
      Array.from({ length: N }, () => app.request("/health"))
    );
    for (const res of results) {
      expect(res.status).toBe(200);
      const body = await res.json() as { status: string };
      expect(body.status).toBe("ok");
    }
  });

  it("no connection leaks: tracked open connections stay within DB_POOL_MAX", async () => {
    const N = 15;
    // Fire concurrent queries and wait for all to settle.
    await Promise.all(
      Array.from({ length: N }, () => sql`SELECT pg_sleep(0)`)
    );
    // poolStats.open tracks connections opened by THIS pool instance via debug/onclose.
    expect(poolStats.open).toBeLessThanOrEqual(DB_POOL_MAX);
  });
});

describe("connection pool — error path does not leak connections", () => {
  it("connections are released after a DB error; subsequent queries succeed", async () => {
    // Trigger a DB error (query a non-existent table).
    await sql`SELECT 1 FROM nonexistent_table_lsds_test_xyz`.catch(() => {});

    // The connection must have been released — a follow-up query should succeed.
    const [row] = await sql<[{ one: number }]>`SELECT 1 AS one`;
    expect(row.one).toBe(1);

    // Tracked open connections stay within max.
    expect(poolStats.open).toBeLessThanOrEqual(DB_POOL_MAX);
  });
});
