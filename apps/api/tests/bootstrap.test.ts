// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app.js";
import { sql } from "../src/db/client.js";
import { bootstrap, run } from "../src/bootstrap-cli.js";
import { cleanTenant } from "./test-helpers.js";

// Routes app.request() through the Hono app so bootstrap() can be tested
// without a real HTTP server.
function makeTestFetcher(tenantId: string) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const path = url.startsWith("http") ? new URL(url).pathname : url;
    // Inject tenant header so requests are scoped to the test tenant
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

// ── bootstrap: fresh tenant ───────────────────────────────────────────────────

describe("bootstrap — fresh tenant", () => {
  it("creates admin user and issues API key", async () => {
    const tenantId = freshTenant();
    const result = await bootstrap(
      { apiUrl: "http://test", tenantId, tenantName: "acme", adminEmail: "admin@test.example" },
      makeTestFetcher(tenantId),
    );

    expect(result.alreadyProvisioned).toBe(false);
    expect(result.apiKey).toMatch(/^lsds_[0-9a-f]{32}$/);
  });

  it("POST /v1/nodes succeeds with the issued API key", async () => {
    const tenantId = freshTenant();
    const { apiKey } = await bootstrap(
      { apiUrl: "http://test", tenantId, tenantName: "acme", adminEmail: "admin@test.example" },
      makeTestFetcher(tenantId),
    );

    const res = await app.request("/v1/nodes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Api-Key": apiKey!,
      },
      body: JSON.stringify({ type: "BusinessGoal", layer: "L1", name: "first-node" }),
    });

    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { name: string; tenantId: string } };
    expect(data.name).toBe("first-node");
    expect(data.tenantId).toBe(tenantId);
  });

  it("health check passes after provisioning", async () => {
    const tenantId = freshTenant();
    await bootstrap(
      { apiUrl: "http://test", tenantId, tenantName: "acme", adminEmail: "admin@test.example" },
      makeTestFetcher(tenantId),
    );

    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; db: string };
    expect(body.status).toBe("ok");
    expect(body.db).toBe("ok");
  });
});

// ── bootstrap: idempotency ────────────────────────────────────────────────────

describe("bootstrap — idempotency", () => {
  it("second run returns alreadyProvisioned:true and no key", async () => {
    const tenantId = freshTenant();
    const fetcher = makeTestFetcher(tenantId);
    const opts = { apiUrl: "http://test", tenantId, tenantName: "acme", adminEmail: "admin@test.example" };

    const first = await bootstrap(opts, fetcher);
    expect(first.alreadyProvisioned).toBe(false);

    const second = await bootstrap(opts, fetcher);
    expect(second.alreadyProvisioned).toBe(true);
    expect(second.apiKey).toBeUndefined();
  });

  it("original API key still works after second bootstrap attempt", async () => {
    const tenantId = freshTenant();
    const fetcher = makeTestFetcher(tenantId);
    const opts = { apiUrl: "http://test", tenantId, tenantName: "acme", adminEmail: "admin@test.example" };

    const { apiKey } = await bootstrap(opts, fetcher);
    await bootstrap(opts, fetcher); // second run — no-op

    const res = await app.request("/v1/nodes", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Api-Key": apiKey! },
      body: JSON.stringify({ type: "BusinessGoal", layer: "L1", name: "idempotency-check" }),
    });
    expect(res.status).toBe(201);
  });
});

// ── bootstrap: admin user record ──────────────────────────────────────────────

describe("bootstrap — admin user", () => {
  it("creates user with role=admin and matching email", async () => {
    const tenantId = freshTenant();
    await bootstrap(
      { apiUrl: "http://test", tenantId, tenantName: "acme", adminEmail: "admin@test.example" },
      makeTestFetcher(tenantId),
    );

    const res = await app.request("/v1/users", {
      headers: { "x-tenant-id": tenantId },
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { email: string; role: string }[];
    };
    const admin = data.find((u) => u.email === "admin@test.example");
    expect(admin).toBeDefined();
    expect(admin!.role).toBe("admin");
  });
});

// ── run: DB unreachable ───────────────────────────────────────────────────────

describe("run — DB unreachable", () => {
  it("exits with code 1 when health check returns 503", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number): never => {
      throw new Error(`process.exit(${_code})`);
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const mockFetcher = async (url: string): Promise<Response> => {
      if (url.includes("/health")) {
        return new Response(JSON.stringify({ status: "error", db: "unreachable" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch call to ${url}`);
    };

    try {
      await expect(
        run(mockFetcher, { API_URL: "http://localhost:3001", ADMIN_EMAIL: "admin@test.example" }),
      ).rejects.toThrow("process.exit(1)");
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("health check failed"),
      );
    } finally {
      exitSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });
});

// ── bootstrap: partial-failure idempotency ────────────────────────────────────

describe("bootstrap — partial-failure idempotency", () => {
  it("issues key when admin user already exists (simulates user-created-but-key-failed)", async () => {
    const tenantId = freshTenant();
    const fetcher = makeTestFetcher(tenantId);
    const opts = {
      apiUrl: "http://test",
      tenantId,
      tenantName: "acme",
      adminEmail: "admin@test.example",
    };

    // Pre-create the admin user (simulates partial run: user created, key creation crashed)
    const userRes = await fetcher(`${opts.apiUrl}/v1/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        externalId: opts.adminEmail,
        displayName: opts.adminEmail,
        email: opts.adminEmail,
        role: "admin",
      }),
    });
    expect(userRes.status).toBe(201);

    // Bootstrap must recover: upsert user (non-fatal) and issue key
    const result = await bootstrap(opts, fetcher);
    expect(result.alreadyProvisioned).toBe(false);
    expect(result.apiKey).toMatch(/^lsds_[0-9a-f]{32}$/);
  });
});
