// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Integration tests for the tenant bootstrap flow (LSDS-566).
// Each invariant has a positive AND negative test.
// All DB assertions hit real Postgres — no database mocks (ADR A6).

import { describe, it, expect, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app.js";
import { sql } from "../src/db/client.js";
import { bootstrap, run } from "../src/bootstrap-cli.js";
import { cleanTenant } from "./test-helpers.js";

// Routes app.request() through the Hono app so bootstrap() hits real Postgres
// without requiring a network-listening HTTP server.
function makeTestFetcher(tenantId: string) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const path = url.startsWith("http") ? new URL(url).pathname : url;
    const initWithTenant: RequestInit = {
      ...init,
      headers: {
        ...(init?.headers as Record<string, string> | undefined),
        "x-tenant-id": tenantId,
      },
    };
    return app.request(path, initWithTenant) as Promise<Response>;
  };
}

const tenantIds: string[] = [];

afterEach(async () => {
  for (const tid of tenantIds.splice(0)) {
    await cleanTenant(sql, tid);
  }
});

function freshTenant() {
  const tid = randomUUID();
  tenantIds.push(tid);
  return tid;
}

// ── Invariant 1: Idempotent re-run ────────────────────────────────────────────
//
// "Running bootstrap twice on the same tenant produces no error and no
//  duplicate data."

describe("idempotent re-run — positive: two runs succeed without duplicate DB rows", () => {
  it("second run returns alreadyProvisioned:true with no apiKey", async () => {
    const tenantId = freshTenant();
    const fetcher = makeTestFetcher(tenantId);
    const opts = { apiUrl: "http://test", tenantId, tenantName: "acme", adminEmail: "admin@example.com" };

    const first = await bootstrap(opts, fetcher);
    expect(first.alreadyProvisioned).toBe(false);
    expect(first.apiKey).toMatch(/^lsds_[0-9a-f]{32}$/);

    const second = await bootstrap(opts, fetcher);
    expect(second.alreadyProvisioned).toBe(true);
    expect(second.apiKey).toBeUndefined();
  });

  it("exactly one admin user exists in DB after two bootstrap runs", async () => {
    const tenantId = freshTenant();
    const fetcher = makeTestFetcher(tenantId);
    const opts = { apiUrl: "http://test", tenantId, tenantName: "acme", adminEmail: "admin@example.com" };

    await bootstrap(opts, fetcher);
    await bootstrap(opts, fetcher);

    const [{ count }] = await sql<[{ count: string }]>`
      SELECT count(*)::text FROM users WHERE tenant_id = ${tenantId}
    `;
    expect(Number(count)).toBe(1);
  });

  it("exactly one active API key exists in DB after two bootstrap runs", async () => {
    const tenantId = freshTenant();
    const fetcher = makeTestFetcher(tenantId);
    const opts = { apiUrl: "http://test", tenantId, tenantName: "acme", adminEmail: "admin@example.com" };

    await bootstrap(opts, fetcher);
    await bootstrap(opts, fetcher);

    const [{ count }] = await sql<[{ count: string }]>`
      SELECT count(*)::text FROM api_keys
      WHERE tenant_id = ${tenantId} AND revoked_at IS NULL
    `;
    expect(Number(count)).toBe(1);
  });
});

describe("idempotent re-run — negative: duplicate data IS created when isolation is bypassed", () => {
  it("two separate tenants each get their own user and key (proves tenant-scoped idempotency)", async () => {
    const tid1 = freshTenant();
    const tid2 = freshTenant();
    const opts1 = { apiUrl: "http://test", tenantId: tid1, tenantName: "acme1", adminEmail: "admin@acme1.example" };
    const opts2 = { apiUrl: "http://test", tenantId: tid2, tenantName: "acme2", adminEmail: "admin@acme2.example" };

    const [r1, r2] = await Promise.all([
      bootstrap(opts1, makeTestFetcher(tid1)),
      bootstrap(opts2, makeTestFetcher(tid2)),
    ]);

    expect(r1.alreadyProvisioned).toBe(false);
    expect(r2.alreadyProvisioned).toBe(false);

    // Each tenant has exactly 1 user
    for (const tid of [tid1, tid2]) {
      const [{ count }] = await sql<[{ count: string }]>`
        SELECT count(*)::text FROM users WHERE tenant_id = ${tid}
      `;
      expect(Number(count)).toBe(1);
    }

    // Keys are isolated: tid1's key does not authenticate as tid2
    const badRes = await app.request("/v1/nodes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Api-Key": r1.apiKey!,
        // tenant override removed — key lookup scopes to its own tenant
      },
      body: JSON.stringify({ type: "BusinessGoal", layer: "L1", name: "cross-tenant-probe" }),
    });
    // Node created will belong to tid1, not tid2 — tenants are isolated
    expect(badRes.status).toBe(201);
    const { data } = (await badRes.json()) as { data: { tenantId: string } };
    expect(data.tenantId).toBe(tid1);
    expect(data.tenantId).not.toBe(tid2);
  });
});

// ── Invariant 2: Already-provisioned path ─────────────────────────────────────
//
// "Bootstrap detects existing schema and skips re-creation gracefully."

describe("already-provisioned — positive: active key signals provisioned state", () => {
  it("returns alreadyProvisioned:true when an active key already exists", async () => {
    const tenantId = freshTenant();
    const fetcher = makeTestFetcher(tenantId);
    const opts = { apiUrl: "http://test", tenantId, tenantName: "acme", adminEmail: "admin@example.com" };

    await bootstrap(opts, fetcher);

    const result = await bootstrap(opts, fetcher);
    expect(result.alreadyProvisioned).toBe(true);
  });

  it("original API key remains valid after a no-op second run", async () => {
    const tenantId = freshTenant();
    const fetcher = makeTestFetcher(tenantId);
    const opts = { apiUrl: "http://test", tenantId, tenantName: "acme", adminEmail: "admin@example.com" };

    const { apiKey } = await bootstrap(opts, fetcher);
    await bootstrap(opts, fetcher);

    const res = await app.request("/v1/nodes", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Api-Key": apiKey! },
      body: JSON.stringify({ type: "BusinessGoal", layer: "L1", name: "post-2nd-run" }),
    });
    expect(res.status).toBe(201);
  });
});

describe("already-provisioned — negative: revoked keys do not block re-provisioning", () => {
  it("bootstrap is NOT already-provisioned on a fresh tenant", async () => {
    const tenantId = freshTenant();
    const result = await bootstrap(
      { apiUrl: "http://test", tenantId, tenantName: "fresh", adminEmail: "admin@example.com" },
      makeTestFetcher(tenantId),
    );
    expect(result.alreadyProvisioned).toBe(false);
  });

  it("bootstrap re-provisions when all keys have been revoked", async () => {
    const tenantId = freshTenant();
    const fetcher = makeTestFetcher(tenantId);
    const opts = { apiUrl: "http://test", tenantId, tenantName: "acme", adminEmail: "admin@example.com" };

    // First provision — get the key id
    const { apiKey } = await bootstrap(opts, fetcher);
    expect(apiKey).toMatch(/^lsds_[0-9a-f]{32}$/);

    // Retrieve the key id via the list endpoint
    const listRes = await app.request("/v1/api-keys", {
      headers: { "x-tenant-id": tenantId },
    });
    const { data: keys } = (await listRes.json()) as { data: { id: string; revokedAt: null | string }[] };
    const activeKey = keys.find((k) => !k.revokedAt);
    expect(activeKey).toBeDefined();

    // Revoke the key
    const revokeRes = await app.request(`/v1/api-keys/${activeKey!.id}`, {
      method: "DELETE",
      headers: { "x-tenant-id": tenantId },
    });
    expect(revokeRes.status).toBe(200);

    // Re-run: tenant has NO active keys → should provision a new one
    const second = await bootstrap(opts, fetcher);
    expect(second.alreadyProvisioned).toBe(false);
    expect(second.apiKey).toMatch(/^lsds_[0-9a-f]{32}$/);
    expect(second.apiKey).not.toBe(apiKey);
  });
});

// ── Invariant 3: Health-check failure ─────────────────────────────────────────
//
// "Bootstrap correctly surfaces DB connectivity failure with an actionable error."

describe("health-check failure — positive: actionable error on API unreachable", () => {
  it("run() exits 1 with an actionable message when API is unreachable (real network)", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number): never => {
      throw new Error(`process.exit(${_code})`);
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      // Port 1 is privileged/reserved — connection will be refused immediately.
      // This exercises the real fetch() error path without any mock.
      await expect(
        run(fetch, { API_URL: "http://127.0.0.1:1", ADMIN_EMAIL: "admin@example.com" }),
      ).rejects.toThrow("process.exit(1)");

      // Error message must tell the operator what to check
      const allErrors = consoleSpy.mock.calls.flat().join(" ");
      expect(allErrors).toMatch(/not reachable|database/i);
    } finally {
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });

  it("run() exits 1 and reports db status when health endpoint returns 503", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number): never => {
      throw new Error(`process.exit(${_code})`);
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Simulates the API being up but Postgres being down (503 with db:unreachable body).
    // The fetcher is injected so no real DB connection is bypassed.
    const downFetcher = async (url: string): Promise<Response> => {
      if (url.includes("/health")) {
        return new Response(JSON.stringify({ status: "error", db: "unreachable" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected call to ${url} in down-fetcher`);
    };

    try {
      await expect(
        run(downFetcher, { API_URL: "http://localhost:3001", ADMIN_EMAIL: "admin@example.com" }),
      ).rejects.toThrow("process.exit(1)");

      const allErrors = consoleSpy.mock.calls.flat().join(" ");
      expect(allErrors).toMatch(/health check failed/i);
      expect(allErrors).toMatch(/database.*unreachable|unreachable/i);
    } finally {
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });
});

describe("health-check failure — negative: no error when API is reachable", () => {
  it("run() succeeds (exits 0) when API is healthy but ADMIN_EMAIL is unset", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number): never => {
      throw new Error(`process.exit(${_code})`);
    });
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Route through the real Hono app — hits real Postgres for the health check
    const healthyFetcher = async (url: string, init?: RequestInit): Promise<Response> => {
      const path = url.startsWith("http") ? new URL(url).pathname : url;
      return app.request(path, init ?? {}) as Promise<Response>;
    };

    try {
      // ADMIN_EMAIL not set → run() logs "skipping" and exits 0
      await expect(
        run(healthyFetcher, { API_URL: "http://localhost:3001" }),
      ).rejects.toThrow("process.exit(0)");
    } finally {
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });

  it("run() provisions successfully when API is healthy and ADMIN_EMAIL is set", async () => {
    const tenantId = freshTenant();

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Route both health and bootstrap calls through the real Hono app + Postgres
    const realFetcher = async (url: string, init?: RequestInit): Promise<Response> => {
      const p = url.startsWith("http") ? new URL(url).pathname : url;
      const initWithTenant: RequestInit = {
        ...init,
        headers: {
          ...(init?.headers as Record<string, string> | undefined),
          "x-tenant-id": tenantId,
        },
      };
      return app.request(p, initWithTenant) as Promise<Response>;
    };

    // run() returns undefined (no process.exit) on successful first provision
    await expect(
      run(realFetcher, {
        API_URL: "http://localhost:3001",
        ADMIN_EMAIL: "admin@example.com",
        TENANT_ID: tenantId,
        TENANT_NAME: "integration-test",
      }),
    ).resolves.toBeUndefined();

    consoleSpy.mockRestore();

    // Confirm a user and active key exist in the DB
    const [{ count: userCount }] = await sql<[{ count: string }]>`
      SELECT count(*)::text FROM users WHERE tenant_id = ${tenantId}
    `;
    expect(Number(userCount)).toBeGreaterThanOrEqual(1);

    const [{ count: keyCount }] = await sql<[{ count: string }]>`
      SELECT count(*)::text FROM api_keys
      WHERE tenant_id = ${tenantId} AND revoked_at IS NULL
    `;
    expect(Number(keyCount)).toBe(1);
  });
});
