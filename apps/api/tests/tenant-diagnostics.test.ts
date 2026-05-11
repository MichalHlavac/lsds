// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant } from "./test-helpers";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

async function createNode(type = "Service", layer = "L4") {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ type, layer, name: randomUUID() }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).data;
}

beforeEach(() => { tid = randomUUID(); });
afterEach(async () => {
  await cleanTenant(sql, tid);
  await sql`DELETE FROM tenants WHERE id = ${tid}`;
});

// ── GET /v1/tenant/diagnostics ────────────────────────────────────────────────

describe("GET /v1/tenant/diagnostics", () => {
  it("returns 200 with correct response shape on empty tenant", async () => {
    const res = await app.request("/v1/tenant/diagnostics", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(typeof data.appVersion).toBe("string");
    expect(typeof data.nodeCount).toBe("number");
    expect(typeof data.edgeCount).toBe("number");
    expect(typeof data.apiKeyCount).toBe("number");
    expect(typeof data.webhookEndpointCount).toBe("number");
    expect(typeof data.auditLogEntries).toBe("number");
    expect(data.lastMutationAt).toBeNull();
    expect(typeof data.dbConnected).toBe("boolean");
    expect(data.dbConnected).toBe(true);
  });

  it("returns zero counts for an empty tenant", async () => {
    const res = await app.request("/v1/tenant/diagnostics", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(data.nodeCount).toBe(0);
    expect(data.edgeCount).toBe(0);
    expect(data.apiKeyCount).toBe(0);
    expect(data.webhookEndpointCount).toBe(0);
    expect(data.auditLogEntries).toBe(0);
    expect(data.lastMutationAt).toBeNull();
  });

  it("reflects node and edge counts", async () => {
    const n1 = await createNode("Service", "L4");
    const n2 = await createNode("Database", "L4");

    await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: n1.id, targetId: n2.id, type: "depends-on", layer: "L4" }),
    });

    const res = await app.request("/v1/tenant/diagnostics", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(data.nodeCount).toBe(2);
    expect(data.edgeCount).toBe(1);
  });

  it("reflects active API key count", async () => {
    await sql`
      INSERT INTO api_keys (id, tenant_id, name, key_hash, key_prefix, expires_at)
      VALUES (${randomUUID()}, ${tid}, 'active', 'hash1', 'lsds_', NULL)
    `;
    await sql`
      INSERT INTO api_keys (id, tenant_id, name, key_hash, key_prefix, expires_at)
      VALUES (${randomUUID()}, ${tid}, 'expired', 'hash2', 'lsds_', now() - interval '1 day')
    `;
    await sql`
      INSERT INTO api_keys (id, tenant_id, name, key_hash, key_prefix, revoked_at)
      VALUES (${randomUUID()}, ${tid}, 'revoked', 'hash3', 'lsds_', now())
    `;

    const res = await app.request("/v1/tenant/diagnostics", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(data.apiKeyCount).toBe(1);
  });

  it("reflects active webhook endpoint count", async () => {
    const enc = Buffer.from("secret");
    await sql`
      INSERT INTO webhooks (id, tenant_id, url, event_types, secret_enc, is_active)
      VALUES (${randomUUID()}, ${tid}, 'https://example.com/hook1', ARRAY['node.create'], ${enc}, true)
    `;
    await sql`
      INSERT INTO webhooks (id, tenant_id, url, event_types, secret_enc, is_active)
      VALUES (${randomUUID()}, ${tid}, 'https://example.com/hook2', ARRAY['node.create'], ${enc}, false)
    `;

    const res = await app.request("/v1/tenant/diagnostics", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(data.webhookEndpointCount).toBe(1);
  });

  it("reflects audit log entry count", async () => {
    await createNode("Service", "L4");
    await createNode("Database", "L4");

    const res = await app.request("/v1/tenant/diagnostics", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(data.auditLogEntries).toBeGreaterThanOrEqual(2);
  });

  it("sets lastMutationAt after a node mutation", async () => {
    await createNode("Service", "L4");

    const res = await app.request("/v1/tenant/diagnostics", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();

    expect(data.lastMutationAt).not.toBeNull();
    expect(() => new Date(data.lastMutationAt).toISOString()).not.toThrow();
  });

  it("is tenant-scoped — cross-tenant isolation", async () => {
    await createNode("Service", "L4");
    await createNode("Database", "L4");

    const otherTid = randomUUID();
    try {
      const res = await app.request("/v1/tenant/diagnostics", {
        headers: { "content-type": "application/json", "x-tenant-id": otherTid },
      });
      expect(res.status).toBe(200);
      const { data } = await res.json();

      expect(data.nodeCount).toBe(0);
      expect(data.edgeCount).toBe(0);
      expect(data.lastMutationAt).toBeNull();
    } finally {
      await cleanTenant(sql, otherTid);
    }
  });

  // ── Auth enforcement tests (follow api-key-expiry-enforcement.test.ts pattern) ─

  it("returns 401 when LSDS_API_KEY_AUTH_ENABLED=true and X-Api-Key header is absent", async () => {
    process.env["LSDS_API_KEY_AUTH_ENABLED"] = "true";
    vi.resetModules();
    try {
      const { apiKeyMiddleware } = await import("../src/auth/api-key.js");
      const testApp = new Hono();
      testApp.use("/v1/*", apiKeyMiddleware(sql));
      testApp.get("/v1/tenant/diagnostics", (c) => c.json({ ok: true }));

      const res = await testApp.request("/v1/tenant/diagnostics");
      expect(res.status).toBe(401);
      expect((await res.json() as { error: string }).error).toBe("unauthorized");
    } finally {
      process.env["LSDS_API_KEY_AUTH_ENABLED"] = "";
      vi.resetModules();
    }
  });

  it("returns 403 when an unrecognized X-Api-Key is provided", async () => {
    const { apiKeyMiddleware } = await import("../src/auth/api-key.js");
    const testApp = new Hono();
    testApp.use("/v1/*", apiKeyMiddleware(sql));
    testApp.get("/v1/tenant/diagnostics", (c) => c.json({ ok: true }));

    const res = await testApp.request("/v1/tenant/diagnostics", {
      headers: { "X-Api-Key": "lsds_invalid_key_that_does_not_exist" },
    });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toBe("forbidden");
  });
});
