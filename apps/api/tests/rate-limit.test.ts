// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

async function makeApp(opts: { enabled: string; rpm: string }) {
  process.env["LSDS_RATE_LIMIT_ENABLED"] = opts.enabled;
  process.env["LSDS_RATE_LIMIT_RPM"] = opts.rpm;
  vi.resetModules();
  const { rateLimitMiddleware } = await import("../src/middleware/rate-limit.js");
  const app = new Hono();
  app.use("/v1/*", rateLimitMiddleware);
  app.get("/v1/ping", (c) => c.json({ ok: true }));
  return app;
}

describe("rate-limit middleware — disabled", () => {
  it("passes through all requests regardless of count", async () => {
    const app = await makeApp({ enabled: "false", rpm: "2" });
    for (let i = 0; i < 5; i++) {
      const res = await app.request("/v1/ping", {
        headers: { "X-Tenant-Id": "tenant-1" },
      });
      expect(res.status).toBe(200);
    }
  });
});

describe("rate-limit middleware — enabled", () => {
  it("allows requests under the limit", async () => {
    const app = await makeApp({ enabled: "true", rpm: "3" });
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/v1/ping", {
        headers: { "X-Tenant-Id": "tenant-a" },
      });
      expect(res.status).toBe(200);
    }
  });

  it("returns 429 when limit is exceeded", async () => {
    const app = await makeApp({ enabled: "true", rpm: "3" });
    for (let i = 0; i < 3; i++) {
      await app.request("/v1/ping", { headers: { "X-Tenant-Id": "tenant-b" } });
    }
    const res = await app.request("/v1/ping", {
      headers: { "X-Tenant-Id": "tenant-b" },
    });
    expect(res.status).toBe(429);
  });

  it("includes Retry-After: 60 header on 429", async () => {
    const app = await makeApp({ enabled: "true", rpm: "3" });
    for (let i = 0; i < 3; i++) {
      await app.request("/v1/ping", { headers: { "X-Tenant-Id": "tenant-c" } });
    }
    const res = await app.request("/v1/ping", {
      headers: { "X-Tenant-Id": "tenant-c" },
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  it("tenants have independent rate limit windows", async () => {
    const app = await makeApp({ enabled: "true", rpm: "2" });
    for (let i = 0; i < 2; i++) {
      await app.request("/v1/ping", { headers: { "X-Tenant-Id": "tenant-x" } });
    }
    // tenant-x is now exhausted; tenant-y should still pass
    const res = await app.request("/v1/ping", {
      headers: { "X-Tenant-Id": "tenant-y" },
    });
    expect(res.status).toBe(200);
  });

  it("passes through when X-Tenant-Id header is absent", async () => {
    const app = await makeApp({ enabled: "true", rpm: "1" });
    // Even after exceeding rpm, no tenant-id means pass-through
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/v1/ping");
      expect(res.status).toBe(200);
    }
  });
});
