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

// ── POST /v1/api-keys ─────────────────────────────────────────────────────────

describe("POST /v1/api-keys", () => {
  it("creates a key and returns 201 with raw key and prefix", async () => {
    const res = await app.request("/v1/api-keys", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "design-partner-key" }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json() as { data: Record<string, unknown> };
    expect(data.key).toMatch(/^lsds_[0-9a-f]{32}$/);
    expect(data.keyPrefix).toBe((data.key as string).slice(0, 8));
    expect(data.name).toBe("design-partner-key");
    expect(data.revokedAt).toBeNull();
    // hash must never be exposed
    expect(data.keyHash).toBeUndefined();
  });

  it("returns 400 when name is missing", async () => {
    const res = await app.request("/v1/api-keys", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe("validation error");
  });

  it("returns 400 when name is empty string", async () => {
    const res = await app.request("/v1/api-keys", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when x-tenant-id header is missing", async () => {
    const res = await app.request("/v1/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "k" }),
    });
    expect(res.status).toBe(400);
  });
});

// ── GET /v1/api-keys ──────────────────────────────────────────────────────────

describe("GET /v1/api-keys", () => {
  it("lists keys for the tenant (no hash exposed)", async () => {
    await app.request("/v1/api-keys", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "key-a" }),
    });
    await app.request("/v1/api-keys", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "key-b" }),
    });

    const res = await app.request("/v1/api-keys", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: Record<string, unknown>[] };
    expect(data.length).toBe(2);
    for (const row of data) {
      expect(row.keyHash).toBeUndefined();
      expect(typeof row.keyPrefix).toBe("string");
    }
  });

  it("returns empty array when tenant has no keys", async () => {
    const res = await app.request("/v1/api-keys", { headers: h() });
    expect(res.status).toBe(200);
    expect((await res.json() as { data: unknown[] }).data).toEqual([]);
  });

  it("does not include keys from a different tenant", async () => {
    const otherTid = randomUUID();
    try {
      await app.request("/v1/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json", "x-tenant-id": otherTid },
        body: JSON.stringify({ name: "other-tenant-key" }),
      });

      const res = await app.request("/v1/api-keys", { headers: h() });
      expect((await res.json() as { data: unknown[] }).data).toEqual([]);
    } finally {
      await cleanTenant(sql, otherTid);
    }
  });
});

// ── DELETE /v1/api-keys/:id ───────────────────────────────────────────────────

describe("DELETE /v1/api-keys/:id", () => {
  it("revokes an existing key (sets revoked_at)", async () => {
    const createRes = await app.request("/v1/api-keys", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "to-revoke" }),
    });
    const { data: created } = await createRes.json() as { data: { id: string } };

    const delRes = await app.request(`/v1/api-keys/${created.id}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(delRes.status).toBe(200);
    expect((await delRes.json() as { data: { id: string } }).data.id).toBe(created.id);

    // After revocation the key should appear in the list with revoked_at set
    const listRes = await app.request("/v1/api-keys", { headers: h() });
    const { data } = await listRes.json() as { data: { id: string; revokedAt: unknown }[] };
    const revoked = data.find((k) => k.id === created.id);
    expect(revoked?.revokedAt).not.toBeNull();
  });

  it("returns 404 for a non-existent key id", async () => {
    const res = await app.request(`/v1/api-keys/${randomUUID()}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when revoking an already-revoked key", async () => {
    const createRes = await app.request("/v1/api-keys", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "double-revoke" }),
    });
    const { data: created } = await createRes.json() as { data: { id: string } };

    await app.request(`/v1/api-keys/${created.id}`, { method: "DELETE", headers: h() });
    const res2 = await app.request(`/v1/api-keys/${created.id}`, { method: "DELETE", headers: h() });
    expect(res2.status).toBe(404);
  });
});

// ── Full lifecycle: create → use as auth → revoke → rejected ─────────────────

describe("API key full lifecycle (integration)", () => {
  it("key authenticates requests and is rejected after revocation", async () => {
    // 1. Create key
    const createRes = await app.request("/v1/api-keys", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "lifecycle-key" }),
    });
    expect(createRes.status).toBe(201);
    const { data } = await createRes.json() as { data: { id: string; key: string } };
    const { id, key } = data;

    // 2. Use the key to authenticate (reads api-keys list using key header instead of x-tenant-id)
    const authedRes = await app.request("/v1/api-keys", {
      headers: { "X-Api-Key": key },
    });
    expect(authedRes.status).toBe(200);

    // 3. Revoke the key
    const revokeRes = await app.request(`/v1/api-keys/${id}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(revokeRes.status).toBe(200);

    // 4. Revoked key must be rejected with 403
    const rejectedRes = await app.request("/v1/api-keys", {
      headers: { "X-Api-Key": key },
    });
    expect(rejectedRes.status).toBe(403);
  });
});
