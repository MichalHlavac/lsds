// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app.js";
import { sql } from "../src/db/client.js";
import { cleanTenant } from "./test-helpers.js";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

beforeEach(() => { tid = randomUUID(); });
afterEach(async () => { await cleanTenant(sql, tid); });

// ── GET /v1/tenant/api-keys ───────────────────────────────────────────────────

describe("GET /v1/tenant/api-keys", () => {
  async function createKey(name = "test-key"): Promise<{ id: string; key: string }> {
    const res = await app.request("/v1/tenant/api-keys/rotate", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name }),
    });
    return (await res.json() as { data: { id: string; key: string } }).data;
  }

  it("returns 200 with empty array when tenant has no keys", async () => {
    const res = await app.request("/v1/tenant/api-keys", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: unknown[] };
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });

  it("returns active keys with expected fields and no key_hash", async () => {
    await createKey("listed-key");
    const res = await app.request("/v1/tenant/api-keys", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: Record<string, unknown>[] };
    expect(data).toHaveLength(1);
    const key = data[0];
    expect(key).toHaveProperty("id");
    expect(key).toHaveProperty("name", "listed-key");
    expect(key).toHaveProperty("keyPrefix");
    expect(key).toHaveProperty("createdAt");
    expect(key).toHaveProperty("expiresAt");
    expect(key).toHaveProperty("rateLimitRpm");
    expect(key).toHaveProperty("rateLimitBurst");
    expect(key).not.toHaveProperty("keyHash");
  });

  it("excludes revoked keys", async () => {
    const { id: activeId } = await createKey("active-key");
    // Create a second key via /v1/api-keys and immediately revoke it
    const createRes = await app.request("/v1/api-keys", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "will-be-revoked" }),
    });
    const { data: toRevoke } = await createRes.json() as { data: { id: string } };
    await app.request(`/v1/api-keys/${toRevoke.id}`, { method: "DELETE", headers: h() });

    const res = await app.request("/v1/tenant/api-keys", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: { id: string }[] };
    const ids = data.map((k) => k.id);
    expect(ids).toContain(activeId);
    expect(ids).not.toContain(toRevoke.id);
  });

  it("does not return keys belonging to another tenant", async () => {
    const otherTid = randomUUID();
    try {
      await app.request("/v1/tenant/api-keys/rotate", {
        method: "POST",
        headers: { "content-type": "application/json", "x-tenant-id": otherTid },
      });

      const res = await app.request("/v1/tenant/api-keys", { headers: h() });
      expect(res.status).toBe(200);
      const { data } = await res.json() as { data: unknown[] };
      expect(data).toHaveLength(0);
    } finally {
      await cleanTenant(sql, otherTid);
    }
  });
});

// ── POST /v1/tenant/api-keys/rotate ──────────────────────────────────────────

describe("POST /v1/tenant/api-keys/rotate", () => {
  it("returns 201 with new raw key and prefix", async () => {
    const res = await app.request("/v1/tenant/api-keys/rotate", {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json() as { data: Record<string, unknown> };
    expect(data.key).toMatch(/^lsds_[0-9a-f]{32}$/);
    expect(data.keyPrefix).toBe((data.key as string).slice(0, 8));
    expect(data.revokedAt).toBeNull();
    expect(data.keyHash).toBeUndefined();
  });

  it("accepts optional name in body", async () => {
    const res = await app.request("/v1/tenant/api-keys/rotate", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "my-design-partner-key" }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json() as { data: Record<string, unknown> };
    expect(data.name).toBe("my-design-partner-key");
  });

  it("uses default name when no body is sent", async () => {
    const res = await app.request("/v1/tenant/api-keys/rotate", {
      method: "POST",
      headers: { "x-tenant-id": tid },
    });
    expect(res.status).toBe(201);
    const { data } = await res.json() as { data: Record<string, unknown> };
    expect(typeof data.name).toBe("string");
    expect((data.name as string).length).toBeGreaterThan(0);
  });

  it("revokes all previously active keys on rotation", async () => {
    // Create two keys the normal way
    await app.request("/v1/api-keys", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "old-key-1" }),
    });
    await app.request("/v1/api-keys", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "old-key-2" }),
    });

    // Rotate — should revoke both
    const rotateRes = await app.request("/v1/tenant/api-keys/rotate", {
      method: "POST",
      headers: h(),
    });
    expect(rotateRes.status).toBe(201);

    // List all keys — old ones must be revoked
    const listRes = await app.request("/v1/api-keys", { headers: h() });
    const { data } = await listRes.json() as { data: { name: string; revokedAt: unknown }[] };
    const active = data.filter((k) => k.revokedAt === null);
    expect(active).toHaveLength(1);
    const revoked = data.filter((k) => k.revokedAt !== null);
    expect(revoked).toHaveLength(2);
    expect(revoked.map((k) => k.name).sort()).toEqual(["old-key-1", "old-key-2"]);
  });

  it("succeeds even when no existing keys are present", async () => {
    const res = await app.request("/v1/tenant/api-keys/rotate", {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json() as { data: Record<string, unknown> };
    expect(data.key).toMatch(/^lsds_[0-9a-f]{32}$/);
  });

  it("double-rotation: second rotate revokes key from first rotate", async () => {
    const res1 = await app.request("/v1/tenant/api-keys/rotate", {
      method: "POST",
      headers: h(),
    });
    const { data: data1 } = await res1.json() as { data: { id: string; key: string } };

    const res2 = await app.request("/v1/tenant/api-keys/rotate", {
      method: "POST",
      headers: h(),
    });
    expect(res2.status).toBe(201);
    const { data: data2 } = await res2.json() as { data: { id: string; key: string } };

    // First key must be rejected
    const rejected = await app.request("/v1/api-keys", {
      headers: { "X-Api-Key": data1.key },
    });
    expect(rejected.status).toBe(403);

    // Second key must authenticate
    const authed = await app.request("/v1/api-keys", {
      headers: { "X-Api-Key": data2.key },
    });
    expect(authed.status).toBe(200);
  });

  it("returns 400 when name is too long", async () => {
    const res = await app.request("/v1/tenant/api-keys/rotate", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "x".repeat(201) }),
    });
    expect(res.status).toBe(400);
  });
});

// ── PATCH /v1/tenant/api-keys/:keyId ─────────────────────────────────────────

describe("PATCH /v1/tenant/api-keys/:keyId", () => {
  async function createKey(name = "test-key"): Promise<{ id: string; key: string }> {
    const res = await app.request("/v1/tenant/api-keys/rotate", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name }),
    });
    return (await res.json() as { data: { id: string; key: string } }).data;
  }

  it("sets expiresAt on an active key", async () => {
    const { id } = await createKey();
    const future = new Date(Date.now() + 3_600_000).toISOString();

    const res = await app.request(`/v1/tenant/api-keys/${id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ expiresAt: future }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: Record<string, unknown> };
    expect(data.expiresAt).toBeTruthy();
    expect(data.id).toBe(id);
  });

  it("clears expiresAt when null is sent", async () => {
    const { id } = await createKey();
    const future = new Date(Date.now() + 3_600_000).toISOString();

    // Set expiry
    await app.request(`/v1/tenant/api-keys/${id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ expiresAt: future }),
    });

    // Clear it
    const res = await app.request(`/v1/tenant/api-keys/${id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ expiresAt: null }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: Record<string, unknown> };
    expect(data.expiresAt).toBeNull();
  });

  it("expired key is rejected by auth middleware (403)", async () => {
    const { id, key } = await createKey();

    // Expire immediately (in the past)
    const past = new Date(Date.now() - 1000).toISOString();
    const patchRes = await app.request(`/v1/tenant/api-keys/${id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ expiresAt: past }),
    });
    expect(patchRes.status).toBe(200);

    // Key must now be rejected
    const rejected = await app.request("/v1/api-keys", {
      headers: { "X-Api-Key": key },
    });
    expect(rejected.status).toBe(403);
  });

  it("key with future expiresAt still authenticates", async () => {
    const { id, key } = await createKey();
    const future = new Date(Date.now() + 3_600_000).toISOString();

    await app.request(`/v1/tenant/api-keys/${id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ expiresAt: future }),
    });

    const authed = await app.request("/v1/api-keys", {
      headers: { "X-Api-Key": key },
    });
    expect(authed.status).toBe(200);
  });

  it("returns 404 for a non-existent key id", async () => {
    const res = await app.request(`/v1/tenant/api-keys/${randomUUID()}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ expiresAt: null }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for a revoked key", async () => {
    const { id } = await createKey();

    // Revoke via delete
    await app.request(`/v1/api-keys/${id}`, { method: "DELETE", headers: h() });

    const res = await app.request(`/v1/tenant/api-keys/${id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ expiresAt: null }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when patching another tenant's key", async () => {
    const otherTid = randomUUID();
    try {
      // Create key for other tenant
      const createRes = await app.request("/v1/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json", "x-tenant-id": otherTid },
        body: JSON.stringify({ name: "other-key" }),
      });
      const { data: other } = await createRes.json() as { data: { id: string } };

      // Try to patch it as our tenant
      const res = await app.request(`/v1/tenant/api-keys/${other.id}`, {
        method: "PATCH",
        headers: h(),
        body: JSON.stringify({ expiresAt: null }),
      });
      expect(res.status).toBe(404);
    } finally {
      await cleanTenant(sql, otherTid);
    }
  });

  it("returns 400 for invalid expiresAt format", async () => {
    const { id } = await createKey();
    const res = await app.request(`/v1/tenant/api-keys/${id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ expiresAt: "not-a-date" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for unknown fields (strict schema)", async () => {
    const { id } = await createKey();
    const res = await app.request(`/v1/tenant/api-keys/${id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ expiresAt: null, unknownField: true }),
    });
    expect(res.status).toBe(400);
  });
});

// ── DELETE /v1/tenant/api-keys/:keyId ────────────────────────────────────────

describe("DELETE /v1/tenant/api-keys/:keyId", () => {
  async function createKey(name = "revoke-test-key"): Promise<{ id: string; key: string }> {
    const res = await app.request("/v1/tenant/api-keys/rotate", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name }),
    });
    return (await res.json() as { data: { id: string; key: string } }).data;
  }

  it("revokes the key and returns 204", async () => {
    const { id } = await createKey();
    const res = await app.request(`/v1/tenant/api-keys/${id}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(204);
  });

  it("revoked key is rejected by auth middleware (403)", async () => {
    const { id, key } = await createKey();

    const del = await app.request(`/v1/tenant/api-keys/${id}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(del.status).toBe(204);

    const authed = await app.request("/v1/api-keys", {
      headers: { "X-Api-Key": key },
    });
    expect(authed.status).toBe(403);
  });

  it("returns 404 for a non-existent key id", async () => {
    const res = await app.request(`/v1/tenant/api-keys/${randomUUID()}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when revoking an already-revoked key", async () => {
    const { id } = await createKey();

    await app.request(`/v1/tenant/api-keys/${id}`, { method: "DELETE", headers: h() });

    const res = await app.request(`/v1/tenant/api-keys/${id}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when revoking another tenant's key", async () => {
    const otherTid = randomUUID();
    try {
      const createRes = await app.request("/v1/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json", "x-tenant-id": otherTid },
        body: JSON.stringify({ name: "other-key" }),
      });
      const { data: other } = await createRes.json() as { data: { id: string } };

      const res = await app.request(`/v1/tenant/api-keys/${other.id}`, {
        method: "DELETE",
        headers: h(),
      });
      expect(res.status).toBe(404);
    } finally {
      await cleanTenant(sql, otherTid);
    }
  });

  it("POST /rotate still works after selective revocation (no regression)", async () => {
    const { id } = await createKey("key-to-revoke");

    await app.request(`/v1/tenant/api-keys/${id}`, { method: "DELETE", headers: h() });

    const rotateRes = await app.request("/v1/tenant/api-keys/rotate", {
      method: "POST",
      headers: h(),
    });
    expect(rotateRes.status).toBe(201);
    const { data } = await rotateRes.json() as { data: Record<string, unknown> };
    expect(data.key).toMatch(/^lsds_[0-9a-f]{32}$/);
  });

  it("writes an audit log entry on revocation", async () => {
    const { id } = await createKey();
    await app.request(`/v1/tenant/api-keys/${id}`, { method: "DELETE", headers: h() });

    const [entry] = await sql<[{ operation: string; entityId: string }?]>`
      SELECT operation, entity_id FROM audit_log
      WHERE tenant_id = ${tid} AND operation = 'api_key.revoked'
      ORDER BY created_at DESC LIMIT 1
    `;
    expect(entry).toBeDefined();
    expect(entry!.operation).toBe("api_key.revoked");
    expect(entry!.entityId).toBe(id);
  });
});
