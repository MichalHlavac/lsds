// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Integration tests for POST /api/admin/tenants and PATCH /api/admin/tenants/:id/api-keys.
// All DB assertions hit real Postgres — no database mocks (ADR A6).

import { describe, it, expect, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app.js";
import { sql } from "../src/db/client.js";
import { sha256hex } from "../src/auth/api-key.js";
import { cleanTenant } from "./test-helpers.js";
import { rateLimitWindows } from "../src/middleware/admin-auth.js";

const TEST_SECRET = "test-admin-secret";

function adminHeaders(ip?: string): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${TEST_SECRET}`,
  };
  if (ip) h["x-forwarded-for"] = ip;
  return h;
}

function uniqueSlug(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const createdTenantIds: string[] = [];

afterEach(async () => {
  for (const tid of createdTenantIds.splice(0)) {
    await cleanTenant(sql, tid);
    await sql`DELETE FROM tenants WHERE id = ${tid}`;
  }
  vi.unstubAllEnvs();
  rateLimitWindows.clear();
});

// ── POST /api/admin/tenants ───────────────────────────────────────────────────

describe("POST /api/admin/tenants", () => {
  it("creates tenant and returns 201 with plaintext apiKey", async () => {
    const slug = uniqueSlug();
    const res = await app.request("/api/admin/tenants", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ name: "Acme Corp", slug, plan: "trial" }),
    });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { tenant: { id: string; slug: string }; apiKey: { key: string; keyHash?: unknown } } };
    expect(data.tenant.slug).toBe(slug);
    expect(data.apiKey.key).toMatch(/^lsds_[0-9a-f]{32}$/);
    // hash must never be exposed in the response
    expect(data.apiKey.keyHash).toBeUndefined();
    createdTenantIds.push(data.tenant.id);
  });

  it("returns 409 when slug already exists", async () => {
    const slug = uniqueSlug();
    const first = await app.request("/api/admin/tenants", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ name: "Acme Corp", slug, plan: "trial" }),
    });
    expect(first.status).toBe(201);
    const { data: d } = (await first.json()) as { data: { tenant: { id: string } } };
    createdTenantIds.push(d.tenant.id);

    const second = await app.request("/api/admin/tenants", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ name: "Acme Corp 2", slug, plan: "partner" }),
    });
    expect(second.status).toBe(409);
  });

  it("returns 401 when LSDS_ADMIN_SECRET is not configured", async () => {
    // Stub the env var to empty to simulate a deploy without admin secret set.
    // config.adminSecret is a dynamic getter so vi.stubEnv takes effect immediately.
    vi.stubEnv("LSDS_ADMIN_SECRET", "");
    const res = await app.request("/api/admin/tenants", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ name: "Acme Corp", slug: uniqueSlug(), plan: "trial" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 for invalid Bearer token", async () => {
    const res = await app.request("/api/admin/tenants", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer wrong-token-value",
      },
      body: JSON.stringify({ name: "Acme Corp", slug: uniqueSlug(), plan: "trial" }),
    });
    expect(res.status).toBe(401);
  });

  // ── Zod body validation contract ──────────────────────────────────────────

  describe("body validation (Zod schema contract)", () => {
    // Use isolated IPs so these tests don't consume the shared rate-limit bucket
    // used by the rest of the suite (which relies on the default "unknown" IP).
    function validationIp(): string {
      return `10.88.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
    }

    it("returns 400 when name field is missing", async () => {
      const res = await app.request("/api/admin/tenants", {
        method: "POST",
        headers: adminHeaders(validationIp()),
        body: JSON.stringify({ slug: uniqueSlug(), plan: "trial" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; issues: Array<{ path: string[] }> };
      expect(body.error).toBe("validation error");
      expect(body.issues.some((i) => i.path.includes("name"))).toBe(true);
    });

    it("returns 400 when name is a number (non-string)", async () => {
      const res = await app.request("/api/admin/tenants", {
        method: "POST",
        headers: adminHeaders(validationIp()),
        body: JSON.stringify({ name: 42, slug: uniqueSlug(), plan: "trial" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; issues: Array<{ path: string[] }> };
      expect(body.error).toBe("validation error");
      expect(body.issues.some((i) => i.path.includes("name"))).toBe(true);
    });

    it("silently drops unknown extra fields and returns 201 (schema uses z.object, not .strict)", async () => {
      // CreateTenantSchema is z.object() — Zod strips unrecognised keys rather than rejecting them.
      const slug = uniqueSlug();
      const res = await app.request("/api/admin/tenants", {
        method: "POST",
        headers: adminHeaders(validationIp()),
        body: JSON.stringify({ name: "Extra Corp", slug, plan: "trial", unknownField: "ignored" }),
      });
      expect(res.status).toBe(201);
      const { data } = (await res.json()) as { data: { tenant: { id: string } } };
      createdTenantIds.push(data.tenant.id);
    });

    it("returns 201 for a valid request (regression guard)", async () => {
      const slug = uniqueSlug();
      const res = await app.request("/api/admin/tenants", {
        method: "POST",
        headers: adminHeaders(validationIp()),
        body: JSON.stringify({ name: "Valid Corp", slug, plan: "trial" }),
      });
      expect(res.status).toBe(201);
      const { data } = (await res.json()) as { data: { tenant: { id: string } } };
      createdTenantIds.push(data.tenant.id);
    });
  });

  it("returns 429 after the 11th request from the same IP within one minute", async () => {
    // Use a unique IP so this test's rate-limit window doesn't bleed into others.
    const ip = `10.99.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;

    for (let i = 0; i < 10; i++) {
      const res = await app.request("/api/admin/tenants", {
        method: "POST",
        headers: adminHeaders(ip),
        body: JSON.stringify({ name: `Rate Tenant ${i}`, slug: uniqueSlug(), plan: "trial" }),
      });
      // Each of the 10 allowed requests should succeed (201) or hit a slug conflict (409) —
      // neither is a rate-limit response.
      expect(res.status).not.toBe(429);
      if (res.status === 201) {
        const { data } = (await res.json()) as { data: { tenant: { id: string } } };
        createdTenantIds.push(data.tenant.id);
      }
    }

    // 11th request from the same IP must be rate-limited.
    const limited = await app.request("/api/admin/tenants", {
      method: "POST",
      headers: adminHeaders(ip),
      body: JSON.stringify({ name: "Over Limit", slug: uniqueSlug(), plan: "trial" }),
    });
    expect(limited.status).toBe(429);
  });
});

// ── PATCH /api/admin/tenants/:tenantId/api-keys ───────────────────────────────

describe("PATCH /api/admin/tenants/:tenantId/api-keys", () => {
  it("rotates API key: returns new plaintext key and revokes old key in DB", async () => {
    const slug = uniqueSlug();
    const createRes = await app.request("/api/admin/tenants", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ name: "Rotate Corp", slug, plan: "partner" }),
    });
    expect(createRes.status).toBe(201);
    const { data: created } = (await createRes.json()) as {
      data: { tenant: { id: string }; apiKey: { key: string } };
    };
    const tenantId = created.tenant.id;
    const oldKey = created.apiKey.key;
    createdTenantIds.push(tenantId);

    const rotateRes = await app.request(`/api/admin/tenants/${tenantId}/api-keys`, {
      method: "PATCH",
      headers: adminHeaders(),
    });
    expect(rotateRes.status).toBe(200);
    const { data: newKey } = (await rotateRes.json()) as { data: { key: string } };
    expect(newKey.key).toMatch(/^lsds_[0-9a-f]{32}$/);
    expect(newKey.key).not.toBe(oldKey);

    // Verify the old key hash is now revoked in the DB.
    const oldHash = await sha256hex(oldKey);
    const [oldRow] = await sql<[{ revoked_at: Date | null } | undefined]>`
      SELECT revoked_at FROM api_keys WHERE key_hash = ${oldHash}
    `;
    expect(oldRow?.revoked_at).not.toBeNull();
  });

  it("returns 404 for a non-existent tenantId", async () => {
    const res = await app.request(`/api/admin/tenants/${randomUUID()}/api-keys`, {
      method: "PATCH",
      headers: adminHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("creates audit row with operation=tenant.rotate_api_key after rotation", async () => {
    const slug = uniqueSlug();
    const createRes = await app.request("/api/admin/tenants", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ name: "AuditRotate Corp", slug, plan: "trial" }),
    });
    expect(createRes.status).toBe(201);
    const { data: created } = (await createRes.json()) as { data: { tenant: { id: string } } };
    const tenantId = created.tenant.id;
    createdTenantIds.push(tenantId);

    const rotateRes = await app.request(`/api/admin/tenants/${tenantId}/api-keys`, {
      method: "PATCH",
      headers: adminHeaders(),
    });
    expect(rotateRes.status).toBe(200);

    const [logRow] = await sql<[{ operation: string; targetTenantId: string } | undefined]>`
      SELECT operation, target_tenant_id FROM admin_audit_log
      WHERE target_tenant_id = ${tenantId} AND operation = 'tenant.rotate_api_key'
    `;
    expect(logRow).toBeDefined();
    expect(logRow!.operation).toBe("tenant.rotate_api_key");
  });

  it("rejects the old key on tenant routes after rotation", async () => {
    const slug = uniqueSlug();
    const createRes = await app.request("/api/admin/tenants", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ name: "Isolation Corp", slug, plan: "trial" }),
    });
    expect(createRes.status).toBe(201);
    const { data: created } = (await createRes.json()) as {
      data: { tenant: { id: string }; apiKey: { key: string } };
    };
    const tenantId = created.tenant.id;
    const oldKey = created.apiKey.key;
    createdTenantIds.push(tenantId);

    // Confirm old key authenticates before rotation.
    const beforeRotate = await app.request("/v1/nodes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": oldKey },
      body: JSON.stringify({ type: "BusinessGoal", layer: "L1", name: "pre-rotate-node" }),
    });
    expect(beforeRotate.status).toBe(201);

    // Rotate the key.
    await app.request(`/api/admin/tenants/${tenantId}/api-keys`, {
      method: "PATCH",
      headers: adminHeaders(),
    });

    // Old key must now be rejected with 403.
    const afterRotate = await app.request("/v1/nodes", {
      headers: { "x-api-key": oldKey },
    });
    expect(afterRotate.status).toBe(403);
  });
});

// ── admin_audit_log ───────────────────────────────────────────────────────────

describe("admin_audit_log", () => {
  it("tenant.create: audit row created after POST /api/admin/tenants", async () => {
    const slug = uniqueSlug();
    const res = await app.request("/api/admin/tenants", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ name: "AuditCreate Corp", slug, plan: "trial" }),
    });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { tenant: { id: string } } };
    const tenantId = data.tenant.id;
    createdTenantIds.push(tenantId);

    const rows = await sql<{ operation: string }[]>`
      SELECT operation FROM admin_audit_log
      WHERE target_tenant_id = ${tenantId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.operation).toBe("tenant.create");
  });

  it("tenant.update_rate_limits: audit row created after PATCH /api/admin/tenants/:id", async () => {
    const slug = uniqueSlug();
    const createRes = await app.request("/api/admin/tenants", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ name: "AuditRL Corp", slug, plan: "partner" }),
    });
    expect(createRes.status).toBe(201);
    const { data: created } = (await createRes.json()) as { data: { tenant: { id: string } } };
    const tenantId = created.tenant.id;
    createdTenantIds.push(tenantId);

    // Clear the create audit row so we can count cleanly
    await sql`DELETE FROM admin_audit_log WHERE target_tenant_id = ${tenantId}`;

    const patchRes = await app.request(`/api/admin/tenants/${tenantId}`, {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({ rateLimitRpm: 500 }),
    });
    expect(patchRes.status).toBe(200);

    const rows = await sql<{ operation: string }[]>`
      SELECT operation FROM admin_audit_log
      WHERE target_tenant_id = ${tenantId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.operation).toBe("tenant.update_rate_limits");
  });

  it("failed admin request creates NO audit row", async () => {
    const nonExistentId = randomUUID();
    const res = await app.request(`/api/admin/tenants/${nonExistentId}`, {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({ rateLimitRpm: 100 }),
    });
    expect(res.status).toBe(404);

    const rows = await sql<{ id: string }[]>`
      SELECT id FROM admin_audit_log WHERE target_tenant_id = ${nonExistentId}
    `;
    expect(rows).toHaveLength(0);
  });
});
