// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

// Unit tests for InMemoryTokenBucketStore + integration tests for the full
// rate-limiting middleware (per-API-key + per-tenant token bucket).
//
// Integration tests use a real PostgreSQL DB (no mocks). Each suite creates a
// fresh InMemoryTokenBucketStore so buckets don't carry over between tests.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "../src/db/client.js";
import { cleanTenant } from "./test-helpers.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function insertTenant(
  tid: string,
  rpm: number,
  burst: number,
): Promise<void> {
  await sql`
    INSERT INTO tenants (id, name, plan, retention_days, rate_limit_rpm, rate_limit_burst)
    VALUES (${tid}, 'rl-test', 'standard', 730, ${rpm}, ${burst})
    ON CONFLICT (id) DO UPDATE
      SET rate_limit_rpm = ${rpm}, rate_limit_burst = ${burst}
  `;
}

async function insertApiKey(
  tid: string,
  rpm: number | null,
  burst: number | null,
): Promise<{ id: string; key: string }> {
  const { generateApiKey, sha256hex } = await import("../src/auth/api-key.js");
  const raw = generateApiKey();
  const hash = await sha256hex(raw);
  const prefix = raw.slice(0, 8);

  const [keyRow] = await sql<[{ id: string }]>`
    INSERT INTO api_keys
      (tenant_id, name, key_hash, key_prefix, rate_limit_rpm, rate_limit_burst)
    VALUES (${tid}, 'rl-key', ${hash}, ${prefix}, ${rpm}, ${burst})
    RETURNING id
  `;
  return { id: keyRow.id, key: raw };
}

/** Build a minimal Hono app wired with apiKeyMiddleware + a fresh-store rateLimitMiddleware. */
async function makeApp(enabled = true) {
  process.env["LSDS_RATE_LIMIT_ENABLED"] = enabled ? "true" : "";
  vi.resetModules();

  const { apiKeyMiddleware } = await import("../src/auth/api-key.js");
  const { rateLimitMiddleware, InMemoryTokenBucketStore } = await import(
    "../src/middleware/rate-limit.js"
  );

  const store = new InMemoryTokenBucketStore();
  const app = new Hono();
  app.use("/v1/*", apiKeyMiddleware(sql));
  app.use("/v1/*", rateLimitMiddleware(sql, store));
  app.get("/v1/ping", (c) => c.json({ ok: true }));

  return { app, store };
}

async function cleanupTenant(tid: string) {
  await cleanTenant(sql, tid);
  await sql`DELETE FROM tenants WHERE id = ${tid}`;
}

// ── Unit: InMemoryTokenBucketStore ───────────────────────────────────────────

describe("InMemoryTokenBucketStore — token bucket mechanics", async () => {
  const { InMemoryTokenBucketStore } = await import("../src/middleware/rate-limit.js");

  it("allows the first request (bucket starts full)", () => {
    const store = new InMemoryTokenBucketStore();
    const r = store.consume("k", { rpm: 60, burst: 1 });
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(0);
    expect(r.retryAfter).toBe(0);
  });

  it("rejects the second immediate request when burst=1", () => {
    const store = new InMemoryTokenBucketStore();
    store.consume("k", { rpm: 60, burst: 1 });
    const r = store.consume("k", { rpm: 60, burst: 1 });
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.retryAfter).toBeGreaterThan(0);
  });

  it("allows exactly burst requests before exhausting", () => {
    const store = new InMemoryTokenBucketStore();
    let allowed = 0;
    for (let i = 0; i < 7; i++) {
      if (store.consume("k", { rpm: 600, burst: 5 }).allowed) allowed++;
    }
    expect(allowed).toBe(5);
  });

  it("different keys maintain independent buckets", () => {
    const store = new InMemoryTokenBucketStore();
    store.consume("a", { rpm: 60, burst: 1 });
    const r = store.consume("b", { rpm: 60, burst: 1 });
    expect(r.allowed).toBe(true);
  });

  it("retryAfter is positive when rejected", () => {
    const store = new InMemoryTokenBucketStore();
    store.consume("k", { rpm: 60, burst: 1 });
    const r = store.consume("k", { rpm: 60, burst: 1 });
    expect(r.retryAfter).toBeGreaterThan(0);
  });
});

// ── Integration: rate limiting disabled ─────────────────────────────────────

describe("Rate limit middleware — disabled (LSDS_RATE_LIMIT_ENABLED not set)", () => {
  let tid: string;

  beforeEach(async () => {
    tid = randomUUID();
    await insertTenant(tid, 1, 1); // very tight limits — should be irrelevant
  });

  afterEach(async () => { await cleanupTenant(tid); vi.resetModules(); });

  it("passes all requests through regardless of count", async () => {
    const { app } = await makeApp(false);
    for (let i = 0; i < 5; i++) {
      const r = await app.request("/v1/ping", { headers: { "x-tenant-id": tid } });
      expect(r.status).toBe(200);
    }
  });
});

// ── Integration: no tenant context → pass through ────────────────────────────

describe("Rate limit middleware — no tenant ID skips limiting", () => {
  afterEach(() => { vi.resetModules(); });

  it("passes through when neither header nor context tenant is present", async () => {
    const { app } = await makeApp(true);
    for (let i = 0; i < 3; i++) {
      const r = await app.request("/v1/ping");
      expect(r.status).toBe(200);
    }
  });
});

// ── Integration: single-bucket exhaust ──────────────────────────────────────

describe("Rate limit — tenant bucket exhaust (burst=1)", () => {
  let tid: string;
  let app: Hono;

  beforeEach(async () => {
    tid = randomUUID();
    await insertTenant(tid, 60, 1);
    ({ app } = await makeApp(true));
  });

  afterEach(async () => { await cleanupTenant(tid); vi.resetModules(); });

  it("first request returns 200 with X-RateLimit headers", async () => {
    const r = await app.request("/v1/ping", { headers: { "x-tenant-id": tid } });
    expect(r.status).toBe(200);
    expect(r.headers.get("X-RateLimit-Limit")).toBe("1");
    expect(r.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(Number(r.headers.get("X-RateLimit-Reset"))).toBeGreaterThan(
      Math.floor(Date.now() / 1000),
    );
  });

  it("second request returns 429 with Retry-After + X-RateLimit headers", async () => {
    await app.request("/v1/ping", { headers: { "x-tenant-id": tid } });
    const r = await app.request("/v1/ping", { headers: { "x-tenant-id": tid } });
    expect(r.status).toBe(429);
    const body = await r.json() as { error: string };
    expect(body.error).toBe("too many requests");
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(r.headers.get("X-RateLimit-Limit")).toBe("1");
    expect(r.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  it("different tenants have independent buckets", async () => {
    const tid2 = randomUUID();
    await insertTenant(tid2, 60, 1);
    try {
      // Exhaust tid
      await app.request("/v1/ping", { headers: { "x-tenant-id": tid } });
      await app.request("/v1/ping", { headers: { "x-tenant-id": tid } }); // 429

      // tid2 still has tokens
      const r = await app.request("/v1/ping", { headers: { "x-tenant-id": tid2 } });
      expect(r.status).toBe(200);
    } finally {
      await cleanupTenant(tid2);
    }
  });
});

// ── Integration: tighter-bucket-wins — per-key limit tighter ─────────────────

describe("Rate limit — per-key burst=1 beats tenant burst=100 (key wins)", () => {
  let tid: string;
  let apiKey: string;
  let app: Hono;

  beforeEach(async () => {
    tid = randomUUID();
    await insertTenant(tid, 600, 100); // generous tenant
    const k = await insertApiKey(tid, 60, 1); // tight key
    apiKey = k.key;
    ({ app } = await makeApp(true));
  });

  afterEach(async () => { await cleanupTenant(tid); vi.resetModules(); });

  it("first request shows limit=1 (tighter key burst)", async () => {
    const r = await app.request("/v1/ping", { headers: { "X-Api-Key": apiKey } });
    expect(r.status).toBe(200);
    expect(r.headers.get("X-RateLimit-Limit")).toBe("1");
  });

  it("second request 429 — key bucket exhausted even though tenant has capacity", async () => {
    await app.request("/v1/ping", { headers: { "X-Api-Key": apiKey } });
    const r = await app.request("/v1/ping", { headers: { "X-Api-Key": apiKey } });
    expect(r.status).toBe(429);
  });
});

// ── Integration: tighter-bucket-wins — tenant limit tighter ──────────────────

describe("Rate limit — tenant burst=1 beats per-key burst=100 (tenant wins)", () => {
  let tid: string;
  let apiKey: string;
  let app: Hono;

  beforeEach(async () => {
    tid = randomUUID();
    await insertTenant(tid, 60, 1); // tight tenant
    const k = await insertApiKey(tid, 600, 100); // generous key
    apiKey = k.key;
    ({ app } = await makeApp(true));
  });

  afterEach(async () => { await cleanupTenant(tid); vi.resetModules(); });

  it("second request 429 — tenant bucket exhausted", async () => {
    await app.request("/v1/ping", { headers: { "X-Api-Key": apiKey } });
    const r = await app.request("/v1/ping", { headers: { "X-Api-Key": apiKey } });
    expect(r.status).toBe(429);
  });
});

// ── Integration: audit log emission on 429 ───────────────────────────────────

describe("Rate limit — rate_limit_hit audit event on 429", () => {
  let tid: string;
  let apiKeyId: string;
  let apiKey: string;
  let app: Hono;

  beforeEach(async () => {
    tid = randomUUID();
    await insertTenant(tid, 60, 1);
    const k = await insertApiKey(tid, null, null);
    apiKey = k.key;
    apiKeyId = k.id;
    ({ app } = await makeApp(true));
  });

  afterEach(async () => { await cleanupTenant(tid); vi.resetModules(); });

  it("writes rate_limit_hit to audit_log on 429 (verified API key)", async () => {
    await app.request("/v1/ping", { headers: { "X-Api-Key": apiKey } });
    const r = await app.request("/v1/ping", { headers: { "X-Api-Key": apiKey } });
    expect(r.status).toBe(429);

    const [row] = await sql<
      [{ operation: string; tenantId: string; apiKeyId: string }]
    >`
      SELECT operation, tenant_id, api_key_id
      FROM audit_log
      WHERE tenant_id = ${tid} AND operation = 'rate_limit_hit'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    expect(row).toBeDefined();
    expect(row.operation).toBe("rate_limit_hit");
    expect(row.tenantId).toBe(tid);
    expect(row.apiKeyId).toBe(apiKeyId);
  });

  it("no audit_log write for X-Tenant-Id header flow (unverified tenant)", async () => {
    const tid2 = randomUUID();
    await insertTenant(tid2, 60, 1);
    try {
      // Use header-only flow (no API key)
      await app.request("/v1/ping", { headers: { "x-tenant-id": tid2 } });
      await app.request("/v1/ping", { headers: { "x-tenant-id": tid2 } }); // 429

      const rows = await sql<{ id: string }[]>`
        SELECT id FROM audit_log
        WHERE tenant_id = ${tid2} AND operation = 'rate_limit_hit'
      `;
      expect(rows.length).toBe(0);
    } finally {
      await cleanupTenant(tid2);
    }
  });
});

// ── Unit: ipWriteRateLimitMiddleware ─────────────────────────────────────────

describe("ipWriteRateLimitMiddleware — unit: write-only, per-IP", () => {
  async function makeIpApp(rpm: number) {
    process.env["RATE_LIMIT_WRITE_RPM"] = String(rpm);
    vi.resetModules();
    const { InMemoryTokenBucketStore, ipWriteRateLimitMiddleware } = await import(
      "../src/middleware/rate-limit.js"
    );
    const store = new InMemoryTokenBucketStore();
    const app = new Hono();
    app.use("/v1/*", ipWriteRateLimitMiddleware(store));
    app.get("/v1/items", (c) => c.json({ ok: true }));
    app.post("/v1/items", (c) => c.json({ ok: true }, 201));
    app.patch("/v1/items/1", (c) => c.json({ ok: true }));
    app.delete("/v1/items/1", (c) => c.json({ ok: true }));
    return { app, store };
  }

  afterEach(() => { vi.resetModules(); delete process.env["RATE_LIMIT_WRITE_RPM"]; });

  it("GET is not rate-limited even when IP bucket is exhausted", async () => {
    // rpm=1 → burst=1; exhaust with POST, then GET should still pass
    const { app } = await makeIpApp(1);
    const ip = "10.0.0.1";
    await app.request("/v1/items", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
    });
    // Second POST should 429
    const post2 = await app.request("/v1/items", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
    });
    expect(post2.status).toBe(429);
    // But GET is unaffected
    const get = await app.request("/v1/items", {
      method: "GET",
      headers: { "x-forwarded-for": ip },
    });
    expect(get.status).toBe(200);
  });

  it("exceeding limit returns 429 with Retry-After header", async () => {
    const { app } = await makeIpApp(1);
    const ip = "10.0.0.2";
    await app.request("/v1/items", { method: "POST", headers: { "x-forwarded-for": ip } });
    const r = await app.request("/v1/items", { method: "POST", headers: { "x-forwarded-for": ip } });
    expect(r.status).toBe(429);
    const body = await r.json() as { error: string };
    expect(body.error).toBe("too many requests");
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("PATCH and DELETE are also rate-limited", async () => {
    const { app } = await makeIpApp(1);
    const ip = "10.0.0.3";
    await app.request("/v1/items/1", { method: "PATCH", headers: { "x-forwarded-for": ip } });
    const r = await app.request("/v1/items/1", { method: "DELETE", headers: { "x-forwarded-for": ip } });
    expect(r.status).toBe(429);
  });

  it("different IPs have independent buckets", async () => {
    const { app } = await makeIpApp(1);
    await app.request("/v1/items", { method: "POST", headers: { "x-forwarded-for": "10.1.1.1" } });
    await app.request("/v1/items", { method: "POST", headers: { "x-forwarded-for": "10.1.1.1" } }); // exhausted
    // Different IP still has capacity
    const r = await app.request("/v1/items", { method: "POST", headers: { "x-forwarded-for": "10.1.1.2" } });
    expect(r.status).toBe(201);
  });

  it("uses first IP from comma-separated X-Forwarded-For", async () => {
    const { app } = await makeIpApp(1);
    await app.request("/v1/items", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1, 172.16.0.1" },
    });
    // Second request from same real client IP (first in chain)
    const r = await app.request("/v1/items", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.99" },
    });
    expect(r.status).toBe(429);
  });
});

// ── Integration: ipWriteRateLimitMiddleware via main app ─────────────────────

describe("ipWriteRateLimitMiddleware — integration: N+1 write returns 429", () => {
  let tid: string;

  beforeEach(async () => {
    tid = randomUUID();
    await sql`
      INSERT INTO tenants (id, name, plan, retention_days)
      VALUES (${tid}, 'ip-rl-test', 'standard', 730)
      ON CONFLICT (id) DO NOTHING
    `;
    process.env["RATE_LIMIT_WRITE_RPM"] = "2";
    vi.resetModules();
  });

  afterEach(async () => {
    await cleanTenant(sql, tid);
    await sql`DELETE FROM tenants WHERE id = ${tid}`;
    delete process.env["RATE_LIMIT_WRITE_RPM"];
    vi.resetModules();
  });

  it("third POST to a write endpoint returns 429, GET is unaffected", async () => {
    const { app: mainApp } = await import("../src/app.js");
    const ip = "192.0.2.10";
    const headers = {
      "Content-Type": "application/json",
      "x-tenant-id": tid,
      "x-forwarded-for": ip,
    };

    // Two writes succeed (burst = rpm = 2)
    const r1 = await mainApp.request("/v1/nodes", {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "service", layer: "L3", name: "svc-a" }),
    });
    expect(r1.status).toBe(201);

    const r2 = await mainApp.request("/v1/nodes", {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "service", layer: "L3", name: "svc-b" }),
    });
    expect(r2.status).toBe(201);

    // Third write is blocked
    const r3 = await mainApp.request("/v1/nodes", {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "service", layer: "L3", name: "svc-c" }),
    });
    expect(r3.status).toBe(429);
    expect(Number(r3.headers.get("Retry-After"))).toBeGreaterThan(0);

    // GET is not affected by the write limit
    const getRes = await mainApp.request("/v1/nodes", { method: "GET", headers });
    expect(getRes.status).toBe(200);
  });
});

// ── Integration: per-key rate limits at create + patch time ──────────────────

describe("Admin API — per-key rate limit fields", () => {
  let tid: string;

  beforeEach(async () => { tid = randomUUID(); });
  afterEach(async () => {
    await cleanupTenant(tid);
    vi.resetModules();
  });

  it("POST /v1/api-keys stores and returns rateLimitRpm + rateLimitBurst", async () => {
    vi.resetModules();
    const { app: mainApp } = await import("../src/app.js");
    const r = await mainApp.request("/v1/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tenant-id": tid },
      body: JSON.stringify({ name: "my-key", rateLimitRpm: 120, rateLimitBurst: 10 }),
    });
    expect(r.status).toBe(201);
    const body = await r.json() as { data: { rateLimitRpm: number; rateLimitBurst: number } };
    expect(body.data.rateLimitRpm).toBe(120);
    expect(body.data.rateLimitBurst).toBe(10);
  });

  it("PATCH /v1/tenant/api-keys/:id updates per-key rate limits", async () => {
    vi.resetModules();
    const { app: mainApp } = await import("../src/app.js");

    const createRes = await mainApp.request("/v1/tenant/api-keys/rotate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tenant-id": tid },
      body: JSON.stringify({}),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as { data: { id: string } };

    const patchRes = await mainApp.request(
      `/v1/tenant/api-keys/${created.data.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-tenant-id": tid },
        body: JSON.stringify({ rateLimitRpm: 50, rateLimitBurst: 5 }),
      },
    );
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json() as {
      data: { rateLimitRpm: number; rateLimitBurst: number };
    };
    expect(patched.data.rateLimitRpm).toBe(50);
    expect(patched.data.rateLimitBurst).toBe(5);
  });
});
