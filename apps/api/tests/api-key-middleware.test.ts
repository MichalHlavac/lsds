// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { ApiKeyRow } from "../src/db/types.js";
import type { Sql } from "../src/db/client.js";
import { sha256hex, generateApiKey } from "../src/auth/api-key.js";

// Build a minimal mock Sql tagged-template function that returns preset rows.
function makeMockSql(rows: unknown[]): Sql {
  const fn = async (_strings: TemplateStringsArray, ..._values: unknown[]) => rows;
  fn.json = () => ({});
  return fn as unknown as Sql;
}

async function makeTestApp(rows: unknown[], apiKeyAuthEnabled = false) {
  process.env["LSDS_API_KEY_AUTH_ENABLED"] = apiKeyAuthEnabled ? "true" : "";

  vi.resetModules();
  const { apiKeyMiddleware } = await import("../src/auth/api-key.js");

  const testApp = new Hono();
  testApp.use("/v1/*", apiKeyMiddleware(makeMockSql(rows)));
  testApp.get("/v1/ping", (c) => c.json({ ok: true, tenant: c.get("tenantId") }));

  return testApp;
}

const ACTIVE_ROW: ApiKeyRow = {
  id: "key-id-1",
  tenantId: "tenant-abc",
  name: "test-key",
  keyHash: "placeholder",
  keyPrefix: "lsds_xx",
  createdAt: new Date(),
  revokedAt: null,
};

// ── sha256hex ─────────────────────────────────────────────────────────────────

describe("sha256hex", () => {
  it("produces a 64-char lowercase hex string", async () => {
    const h = await sha256hex("hello");
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic for the same input", async () => {
    expect(await sha256hex("abc")).toBe(await sha256hex("abc"));
  });

  it("produces different hashes for different inputs", async () => {
    expect(await sha256hex("a")).not.toBe(await sha256hex("b"));
  });
});

// ── generateApiKey ────────────────────────────────────────────────────────────

describe("generateApiKey", () => {
  it("returns a string matching lsds_<32 hex chars>", () => {
    const key = generateApiKey();
    expect(key).toMatch(/^lsds_[0-9a-f]{32}$/);
  });

  it("generates unique keys", () => {
    const keys = new Set(Array.from({ length: 20 }, generateApiKey));
    expect(keys.size).toBe(20);
  });
});

// ── middleware — auth disabled (LSDS_API_KEY_AUTH_ENABLED not set) ────────────

describe("apiKeyMiddleware — auth enforcement disabled", () => {
  it("passes through when no X-Api-Key header is provided", async () => {
    const app = await makeTestApp([], false);
    const res = await app.request("/v1/ping");
    expect(res.status).toBe(200);
  });

  it("returns 403 when an unrecognised key is provided", async () => {
    const app = await makeTestApp([], false); // DB returns no row
    const res = await app.request("/v1/ping", { headers: { "X-Api-Key": "lsds_bad" } });
    expect(res.status).toBe(403);
  });

  it("returns 403 when a revoked key is provided", async () => {
    // revoked_at IS NULL filter in SQL means DB returns no row for revoked keys
    const app = await makeTestApp([], false);
    const res = await app.request("/v1/ping", { headers: { "X-Api-Key": "lsds_whatever" } });
    expect(res.status).toBe(403);
  });

  it("injects tenant_id into context for a valid key", async () => {
    const app = await makeTestApp([ACTIVE_ROW], false);
    const res = await app.request("/v1/ping", { headers: { "X-Api-Key": "lsds_whatever" } });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; tenant: string };
    expect(body.tenant).toBe("tenant-abc");
  });
});

// ── middleware — auth enforcement enabled ─────────────────────────────────────

describe("apiKeyMiddleware — auth enforcement enabled", () => {
  it("returns 401 when no X-Api-Key header is provided", async () => {
    const app = await makeTestApp([], true);
    const res = await app.request("/v1/ping");
    expect(res.status).toBe(401);
  });

  it("returns 403 when an invalid key is provided", async () => {
    const app = await makeTestApp([], true);
    const res = await app.request("/v1/ping", { headers: { "X-Api-Key": "lsds_unknown" } });
    expect(res.status).toBe(403);
  });

  it("allows a valid key through and sets tenant in context", async () => {
    const app = await makeTestApp([ACTIVE_ROW], true);
    const res = await app.request("/v1/ping", { headers: { "X-Api-Key": "lsds_whatever" } });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; tenant: string };
    expect(body.tenant).toBe("tenant-abc");
  });
});
