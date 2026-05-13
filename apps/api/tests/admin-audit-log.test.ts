// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Integration tests for GET /api/admin/audit-log.
// All DB assertions hit real Postgres — no database mocks (ADR A6).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app.js";
import { sql } from "../src/db/client.js";
import { rateLimitWindows } from "../src/middleware/admin-auth.js";
import { createTestTenant } from "./test-helpers.js";

const TEST_SECRET = "test-admin-secret";

function adminHeaders(): Record<string, string> {
  return { authorization: `Bearer ${TEST_SECRET}` };
}

// Seed an admin_audit_log row directly, bypassing the middleware.
async function seedLog(
  operation: string,
  targetTenantId: string | null,
  payload: Record<string, unknown> = {},
): Promise<string> {
  const [row] = await sql<[{ id: string }]>`
    INSERT INTO admin_audit_log (operation, target_tenant_id, payload)
    VALUES (${operation}, ${targetTenantId}, ${sql.json(payload as Parameters<typeof sql.json>[0])})
    RETURNING id
  `;
  return row!.id;
}

const trackedTenantIds: string[] = [];
const trackedLogIds: string[] = [];

beforeEach(async () => {
  rateLimitWindows.clear();
});

afterEach(async () => {
  if (trackedLogIds.length) {
    await sql`DELETE FROM admin_audit_log WHERE id = ANY(${trackedLogIds}::uuid[])`;
    trackedLogIds.splice(0);
  }
  for (const tid of trackedTenantIds.splice(0)) {
    await sql`DELETE FROM admin_audit_log WHERE target_tenant_id = ${tid}`;
    await sql`DELETE FROM tenants WHERE id = ${tid}`;
  }
  rateLimitWindows.clear();
});

// ── Auth ──────────────────────────────────────────────────────────────────────

describe("GET /api/admin/audit-log — auth", () => {
  it("returns 401 when Authorization header is absent", async () => {
    const res = await app.request("/api/admin/audit-log");
    expect(res.status).toBe(401);
  });

  it("returns 401 for a wrong Bearer token", async () => {
    const res = await app.request("/api/admin/audit-log", {
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });
});

// ── Basic response shape ──────────────────────────────────────────────────────

describe("GET /api/admin/audit-log — basic", () => {
  it("returns 200 with data array and meta", async () => {
    const tenantId = randomUUID();
    await createTestTenant(sql, tenantId);
    trackedTenantIds.push(tenantId);

    const id = await seedLog("tenant.create", tenantId, { name: "Acme" });
    trackedLogIds.push(id);

    const res = await app.request(`/api/admin/audit-log?tenantId=${tenantId}`, {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      data: Array<{ id: string; operation: string; targetTenantId: string | null; payload: Record<string, unknown>; createdAt: string }>;
      meta: { count: number; hasMore: boolean; nextBefore: string | null };
    };

    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.meta).toMatchObject({ count: expect.any(Number), hasMore: false });
    const entry = body.data.find((e) => e.id === id);
    expect(entry).toBeDefined();
    expect(entry!.operation).toBe("tenant.create");
    expect(entry!.targetTenantId).toBe(tenantId);
    expect(entry!.payload).toMatchObject({ name: "Acme" });
    expect(typeof entry!.createdAt).toBe("string");
  });

  it("entries are ordered created_at DESC", async () => {
    const tenantId = randomUUID();
    await createTestTenant(sql, tenantId);
    trackedTenantIds.push(tenantId);

    // Insert with explicit timestamps in ascending order
    await sql`
      INSERT INTO admin_audit_log (operation, target_tenant_id, payload, created_at)
      VALUES
        ('tenant.create',            ${tenantId}, '{}', now() - interval '3 seconds'),
        ('tenant.update_rate_limits', ${tenantId}, '{}', now() - interval '2 seconds'),
        ('tenant.rotate_api_key',    ${tenantId}, '{}', now() - interval '1 second')
    `;

    const res = await app.request(`/api/admin/audit-log?tenantId=${tenantId}`, {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Array<{ operation: string; createdAt: string }> };

    // newest first
    expect(data[0]!.operation).toBe("tenant.rotate_api_key");
    expect(data[1]!.operation).toBe("tenant.update_rate_limits");
    expect(data[2]!.operation).toBe("tenant.create");
  });
});

// ── tenantId filter ───────────────────────────────────────────────────────────

describe("GET /api/admin/audit-log — tenantId filter", () => {
  it("returns only entries for the specified tenant", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    await createTestTenant(sql, tenantA);
    await createTestTenant(sql, tenantB);
    trackedTenantIds.push(tenantA, tenantB);

    const idA = await seedLog("tenant.create", tenantA);
    const idB = await seedLog("tenant.create", tenantB);
    trackedLogIds.push(idA, idB);

    const res = await app.request(`/api/admin/audit-log?tenantId=${tenantA}`, {
      headers: adminHeaders(),
    });
    const { data } = (await res.json()) as { data: Array<{ id: string }> };
    const ids = data.map((e) => e.id);
    expect(ids).toContain(idA);
    expect(ids).not.toContain(idB);
  });

  it("returns 400 for an invalid UUID as tenantId", async () => {
    const res = await app.request("/api/admin/audit-log?tenantId=not-a-uuid", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(400);
  });
});

// ── operation filter ──────────────────────────────────────────────────────────

describe("GET /api/admin/audit-log — operation filter", () => {
  it("returns only entries matching the given operation", async () => {
    const tenantId = randomUUID();
    await createTestTenant(sql, tenantId);
    trackedTenantIds.push(tenantId);

    const idCreate = await seedLog("tenant.create", tenantId);
    const idRotate = await seedLog("tenant.rotate_api_key", tenantId);
    trackedLogIds.push(idCreate, idRotate);

    const res = await app.request(
      `/api/admin/audit-log?tenantId=${tenantId}&operation=tenant.create`,
      { headers: adminHeaders() },
    );
    const { data } = (await res.json()) as { data: Array<{ id: string }> };
    const ids = data.map((e) => e.id);
    expect(ids).toContain(idCreate);
    expect(ids).not.toContain(idRotate);
  });
});

// ── limit validation ──────────────────────────────────────────────────────────

describe("GET /api/admin/audit-log — limit validation", () => {
  it("returns 400 when limit exceeds 200", async () => {
    const res = await app.request("/api/admin/audit-log?limit=201", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when limit is 0", async () => {
    const res = await app.request("/api/admin/audit-log?limit=0", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(400);
  });

  it("accepts limit=200", async () => {
    const res = await app.request("/api/admin/audit-log?limit=200", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
  });
});

// ── before cursor pagination ──────────────────────────────────────────────────

describe("GET /api/admin/audit-log — before cursor pagination", () => {
  it("paginates through all entries using nextBefore cursor", async () => {
    const tenantId = randomUUID();
    await createTestTenant(sql, tenantId);
    trackedTenantIds.push(tenantId);

    // Insert 5 rows with distinct timestamps
    for (let i = 0; i < 5; i++) {
      await sql`
        INSERT INTO admin_audit_log (operation, target_tenant_id, payload, created_at)
        VALUES ('tenant.create', ${tenantId}, '{}', now() - ${`${5 - i} seconds`}::interval)
      `;
    }

    // Page 1: limit=3
    const page1Res = await app.request(
      `/api/admin/audit-log?tenantId=${tenantId}&limit=3`,
      { headers: adminHeaders() },
    );
    expect(page1Res.status).toBe(200);
    const page1 = (await page1Res.json()) as {
      data: Array<{ id: string }>;
      meta: { hasMore: boolean; nextBefore: string | null };
    };
    expect(page1.data).toHaveLength(3);
    expect(page1.meta.hasMore).toBe(true);
    expect(page1.meta.nextBefore).not.toBeNull();

    // Page 2: use nextBefore from page 1
    const page2Res = await app.request(
      `/api/admin/audit-log?tenantId=${tenantId}&limit=3&before=${encodeURIComponent(page1.meta.nextBefore!)}`,
      { headers: adminHeaders() },
    );
    expect(page2Res.status).toBe(200);
    const page2 = (await page2Res.json()) as {
      data: Array<{ id: string }>;
      meta: { hasMore: boolean };
    };
    expect(page2.data).toHaveLength(2);
    expect(page2.meta.hasMore).toBe(false);

    // IDs from pages 1 and 2 must be disjoint and collectively cover all 5 rows
    const allIds = new Set([...page1.data.map((e) => e.id), ...page2.data.map((e) => e.id)]);
    expect(allIds.size).toBe(5);
  });

  it("returns 400 for an invalid before timestamp", async () => {
    const res = await app.request("/api/admin/audit-log?before=not-a-date", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(400);
  });
});
