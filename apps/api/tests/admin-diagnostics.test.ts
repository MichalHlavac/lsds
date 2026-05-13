// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Integration tests for GET /api/admin/diagnostics.
// All DB assertions hit real Postgres — no database mocks (ADR A6).

import { describe, it, expect, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app.js";
import { sql } from "../src/db/client.js";
import { rateLimitWindows } from "../src/middleware/admin-auth.js";

const TEST_SECRET = "test-admin-secret";

function adminHeaders(ip?: string): Record<string, string> {
  const h: Record<string, string> = {
    authorization: `Bearer ${TEST_SECRET}`,
  };
  if (ip) h["x-forwarded-for"] = ip;
  return h;
}

const createdTenantIds: string[] = [];

afterEach(async () => {
  for (const tid of createdTenantIds.splice(0)) {
    await sql`DELETE FROM api_keys WHERE tenant_id = ${tid}`;
    await sql`DELETE FROM nodes WHERE tenant_id = ${tid}`;
    await sql`DELETE FROM edges WHERE tenant_id = ${tid}`;
    await sql`DELETE FROM tenants WHERE id = ${tid}`;
  }
  vi.unstubAllEnvs();
  rateLimitWindows.clear();
});

async function createTenantWithData(): Promise<{ tenantId: string }> {
  const tenantId = randomUUID();
  await sql`INSERT INTO tenants (id, name, plan, retention_days) VALUES (${tenantId}, 'Test', 'trial', 730)`;
  createdTenantIds.push(tenantId);
  return { tenantId };
}

// ── GET /api/admin/diagnostics ────────────────────────────────────────────────

describe("GET /api/admin/diagnostics", () => {
  it("returns 200 with the correct payload shape", async () => {
    const res = await app.request("/api/admin/diagnostics", {
      headers: adminHeaders(`10.77.${Math.floor(Math.random() * 256)}.1`),
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Record<string, unknown> };

    expect(typeof data["appVersion"]).toBe("string");
    expect(typeof data["nodeVersion"]).toBe("string");
    expect((data["nodeVersion"] as string).startsWith("v")).toBe(true);
    expect(typeof data["uptime"]).toBe("number");
    expect((data["uptime"] as number)).toBeGreaterThanOrEqual(0);

    const mem = data["memory"] as Record<string, unknown>;
    expect(typeof mem["rss"]).toBe("number");
    expect(typeof mem["heapTotal"]).toBe("number");
    expect(typeof mem["heapUsed"]).toBe("number");
    expect(typeof mem["external"]).toBe("number");

    expect(typeof data["dbConnected"]).toBe("boolean");
    expect(data["dbConnected"]).toBe(true);
    expect(typeof data["dbPoolSize"]).toBe("number");

    expect(typeof data["totalTenants"]).toBe("number");
    expect(typeof data["totalActiveApiKeys"]).toBe("number");
    expect(typeof data["totalNodes"]).toBe("number");
    expect(typeof data["totalEdges"]).toBe("number");
    expect(typeof data["generatedAt"]).toBe("string");
    expect(() => new Date(data["generatedAt"] as string).toISOString()).not.toThrow();
  });

  it("reflects tenant and api-key counts correctly", async () => {
    const baseRes = await app.request("/api/admin/diagnostics", {
      headers: adminHeaders(`10.77.${Math.floor(Math.random() * 256)}.2`),
    });
    expect(baseRes.status).toBe(200);
    const { data: base } = (await baseRes.json()) as { data: { totalTenants: number; totalActiveApiKeys: number; totalNodes: number; totalEdges: number } };

    // Create a tenant + active api key + node + edge
    const { tenantId } = await createTenantWithData();
    const nodeId1 = randomUUID();
    const nodeId2 = randomUUID();
    await sql`INSERT INTO nodes (id, tenant_id, type, layer, name, version, lifecycle_status, attributes) VALUES (${nodeId1}, ${tenantId}, 'Service', 'L4', 'n1', '0.1.0', 'ACTIVE', '{}')`;
    await sql`INSERT INTO nodes (id, tenant_id, type, layer, name, version, lifecycle_status, attributes) VALUES (${nodeId2}, ${tenantId}, 'Database', 'L4', 'n2', '0.1.0', 'ACTIVE', '{}')`;
    await sql`INSERT INTO edges (id, tenant_id, source_id, target_id, type, layer, traversal_weight, lifecycle_status, attributes) VALUES (${randomUUID()}, ${tenantId}, ${nodeId1}, ${nodeId2}, 'depends-on', 'L4', 1.0, 'ACTIVE', '{}')`;
    const keyHash = `hash_${tenantId}`;
    await sql`INSERT INTO api_keys (id, tenant_id, name, key_hash, key_prefix) VALUES (${randomUUID()}, ${tenantId}, 'test', ${keyHash}, 'lsds_tst')`;

    // Cache TTL is 30s — bypass by using a fresh isolated import
    vi.resetModules();
    const { app: freshApp } = await import("../src/app.js");

    const afterRes = await freshApp.request("/api/admin/diagnostics", {
      headers: adminHeaders(`10.77.${Math.floor(Math.random() * 256)}.3`),
    });
    expect(afterRes.status).toBe(200);
    const { data: after } = (await afterRes.json()) as { data: { totalTenants: number; totalActiveApiKeys: number; totalNodes: number; totalEdges: number } };

    expect(after.totalTenants).toBeGreaterThanOrEqual(base.totalTenants + 1);
    expect(after.totalActiveApiKeys).toBeGreaterThanOrEqual(base.totalActiveApiKeys + 1);
    expect(after.totalNodes).toBeGreaterThanOrEqual(base.totalNodes + 2);
    expect(after.totalEdges).toBeGreaterThanOrEqual(base.totalEdges + 1);

    vi.resetModules();
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await app.request("/api/admin/diagnostics");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("returns 401 when Authorization header has invalid token", async () => {
    const res = await app.request("/api/admin/diagnostics", {
      headers: { authorization: "Bearer wrong-secret" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("returns 401 when LSDS_ADMIN_SECRET is not configured", async () => {
    vi.stubEnv("LSDS_ADMIN_SECRET", "");
    const res = await app.request("/api/admin/diagnostics", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 with dbConnected: false when DB is down", async () => {
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

    const res = await brokenApp.request("/api/admin/diagnostics", {
      headers: adminHeaders(`10.77.${Math.floor(Math.random() * 256)}.99`),
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { dbConnected: boolean; totalTenants: number; totalNodes: number; totalEdges: number; totalActiveApiKeys: number } };
    expect(data.dbConnected).toBe(false);
    expect(data.totalTenants).toBe(0);
    expect(data.totalNodes).toBe(0);
    expect(data.totalEdges).toBe(0);
    expect(data.totalActiveApiKeys).toBe(0);

    vi.doUnmock("../src/db/client.js");
    vi.resetModules();
  });
});
