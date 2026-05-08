// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

// Integration tests for API key expiry / revocation enforcement.
//
// HTTP semantics used here (and in the middleware):
//   403 — key is present but invalid (expired, revoked, or unrecognised)
//   401 — key is absent AND enforcement is enabled (LSDS_API_KEY_AUTH_ENABLED=true)
//
// The middleware is registered once for all /v1/* and /agent/* routes, so
// verifying enforcement on a representative sample of routes is sufficient.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { app } from "../src/app.js";
import { sql } from "../src/db/client.js";
import { cleanTenant } from "./test-helpers.js";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

async function createKey(name = "expiry-test-key"): Promise<{ id: string; key: string }> {
  const res = await app.request("/v1/tenant/api-keys/rotate", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ name }),
  });
  return (await res.json() as { data: { id: string; key: string } }).data;
}

async function expireKey(id: string): Promise<void> {
  const past = new Date(Date.now() - 1000).toISOString();
  const res = await app.request(`/v1/tenant/api-keys/${id}`, {
    method: "PATCH",
    headers: h(),
    body: JSON.stringify({ expiresAt: past }),
  });
  expect(res.status).toBe(200);
}

async function revokeKey(id: string): Promise<void> {
  const res = await app.request(`/v1/api-keys/${id}`, { method: "DELETE", headers: h() });
  expect(res.status).toBe(200);
}

beforeEach(() => { tid = randomUUID(); });
afterEach(async () => { await cleanTenant(sql, tid); });

// ── Expired key → 403 on every sampled protected route ───────────────────────

describe("Expired key is rejected (403) on protected routes", () => {
  it("GET /v1/api-keys — expired key returns 403", async () => {
    const { id, key } = await createKey("e-api-keys");
    await expireKey(id);
    const res = await app.request("/v1/api-keys", { headers: { "X-Api-Key": key } });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toBe("forbidden");
  });

  it("GET /v1/nodes — expired key returns 403", async () => {
    const { id, key } = await createKey("e-nodes");
    await expireKey(id);
    const res = await app.request("/v1/nodes", { headers: { "X-Api-Key": key } });
    expect(res.status).toBe(403);
  });

  it("GET /v1/layers — expired key returns 403", async () => {
    const { id, key } = await createKey("e-layers");
    await expireKey(id);
    const res = await app.request("/v1/layers", { headers: { "X-Api-Key": key } });
    expect(res.status).toBe(403);
  });

  it("GET /v1/guardrails — expired key returns 403", async () => {
    const { id, key } = await createKey("e-guardrails");
    await expireKey(id);
    const res = await app.request("/v1/guardrails", { headers: { "X-Api-Key": key } });
    expect(res.status).toBe(403);
  });

  it("GET /v1/snapshots — expired key returns 403", async () => {
    const { id, key } = await createKey("e-snapshots");
    await expireKey(id);
    const res = await app.request("/v1/snapshots", { headers: { "X-Api-Key": key } });
    expect(res.status).toBe(403);
  });
});

// ── Revoked key → 403 on protected routes ────────────────────────────────────

describe("Revoked key is rejected (403) on protected routes", () => {
  it("GET /v1/api-keys — revoked key returns 403", async () => {
    const { id, key } = await createKey("r-api-keys");
    await revokeKey(id);
    const res = await app.request("/v1/api-keys", { headers: { "X-Api-Key": key } });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toBe("forbidden");
  });

  it("GET /v1/nodes — revoked key returns 403", async () => {
    const { id, key } = await createKey("r-nodes");
    await revokeKey(id);
    const res = await app.request("/v1/nodes", { headers: { "X-Api-Key": key } });
    expect(res.status).toBe(403);
  });

  it("GET /v1/layers — revoked key returns 403", async () => {
    const { id, key } = await createKey("r-layers");
    await revokeKey(id);
    const res = await app.request("/v1/layers", { headers: { "X-Api-Key": key } });
    expect(res.status).toBe(403);
  });

  it("GET /v1/guardrails — revoked key returns 403", async () => {
    const { id, key } = await createKey("r-guardrails");
    await revokeKey(id);
    const res = await app.request("/v1/guardrails", { headers: { "X-Api-Key": key } });
    expect(res.status).toBe(403);
  });
});

// ── Key with future expiresAt → 200 (still valid) ────────────────────────────

describe("Key with future expiresAt still authenticates (200)", () => {
  async function setFutureExpiry(id: string): Promise<void> {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const res = await app.request(`/v1/tenant/api-keys/${id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ expiresAt: future }),
    });
    expect(res.status).toBe(200);
  }

  it("GET /v1/api-keys — future-expiry key returns 200", async () => {
    const { id, key } = await createKey("f-api-keys");
    await setFutureExpiry(id);
    const res = await app.request("/v1/api-keys", { headers: { "X-Api-Key": key } });
    expect(res.status).toBe(200);
  });

  it("GET /v1/nodes — future-expiry key returns 200", async () => {
    const { id, key } = await createKey("f-nodes");
    await setFutureExpiry(id);
    const res = await app.request("/v1/nodes", { headers: { "X-Api-Key": key } });
    expect(res.status).toBe(200);
  });

  it("GET /v1/layers — future-expiry key returns 200", async () => {
    const { id, key } = await createKey("f-layers");
    await setFutureExpiry(id);
    const res = await app.request("/v1/layers", { headers: { "X-Api-Key": key } });
    expect(res.status).toBe(200);
  });
});

// ── Valid key (no expiry set) → 200 ──────────────────────────────────────────

describe("Valid active key (no expiry) authenticates (200)", () => {
  it("GET /v1/api-keys — valid key returns 200", async () => {
    const { key } = await createKey("v-api-keys");
    const res = await app.request("/v1/api-keys", { headers: { "X-Api-Key": key } });
    expect(res.status).toBe(200);
  });

  it("GET /v1/nodes — valid key returns 200", async () => {
    const { key } = await createKey("v-nodes");
    const res = await app.request("/v1/nodes", { headers: { "X-Api-Key": key } });
    expect(res.status).toBe(200);
  });

  it("GET /v1/layers — valid key returns 200", async () => {
    const { key } = await createKey("v-layers");
    const res = await app.request("/v1/layers", { headers: { "X-Api-Key": key } });
    expect(res.status).toBe(200);
  });

  it("GET /v1/guardrails — valid key returns 200", async () => {
    const { key } = await createKey("v-guardrails");
    const res = await app.request("/v1/guardrails", { headers: { "X-Api-Key": key } });
    expect(res.status).toBe(200);
  });
});

// ── Missing key → 401 when enforcement enabled (real DB) ─────────────────────

describe("Missing X-Api-Key → 401 when LSDS_API_KEY_AUTH_ENABLED=true", () => {
  it("returns 401 on a protected route when the header is absent", async () => {
    process.env["LSDS_API_KEY_AUTH_ENABLED"] = "true";
    vi.resetModules();
    try {
      const { apiKeyMiddleware } = await import("../src/auth/api-key.js");
      const testApp = new Hono();
      testApp.use("/v1/*", apiKeyMiddleware(sql));
      testApp.get("/v1/ping", (c) => c.json({ ok: true }));

      const res = await testApp.request("/v1/ping");
      expect(res.status).toBe(401);
      expect((await res.json() as { error: string }).error).toBe("unauthorized");
    } finally {
      process.env["LSDS_API_KEY_AUTH_ENABLED"] = "";
      vi.resetModules();
    }
  });

  it("valid key still passes when enforcement is enabled", async () => {
    const { key } = await createKey("auth-enabled-valid");

    process.env["LSDS_API_KEY_AUTH_ENABLED"] = "true";
    vi.resetModules();
    try {
      const { apiKeyMiddleware } = await import("../src/auth/api-key.js");
      const testApp = new Hono();
      testApp.use("/v1/*", apiKeyMiddleware(sql));
      testApp.get("/v1/ping", (c) => c.json({ ok: true }));

      const res = await testApp.request("/v1/ping", { headers: { "X-Api-Key": key } });
      expect(res.status).toBe(200);
    } finally {
      process.env["LSDS_API_KEY_AUTH_ENABLED"] = "";
      vi.resetModules();
    }
  });
});
