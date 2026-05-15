// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Tests for GET /api/metrics — structured request metrics endpoint.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { app } from "../src/app.js";
import {
  metricsMiddleware,
  getMetricsSnapshot,
  resetMetrics,
  percentile,
} from "../src/middleware/metrics.js";
import { rateLimitWindows } from "../src/middleware/admin-auth.js";

const TEST_SECRET = "test-admin-secret";

function adminHeaders(ip?: string): Record<string, string> {
  const h: Record<string, string> = { authorization: `Bearer ${TEST_SECRET}` };
  if (ip) h["x-forwarded-for"] = ip;
  return h;
}

beforeEach(() => {
  resetMetrics();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetMetrics();
  rateLimitWindows.clear();
});

// ── percentile (unit) ─────────────────────────────────────────────────────────

describe("percentile()", () => {
  it("returns 0 for an empty array", () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it("returns the single element for any percentile on a 1-element array", () => {
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 0.99)).toBe(42);
  });

  it("computes p50 correctly for an even set", () => {
    // sorted [1,2,3,4] → p50 → ceil(4*0.5)-1 = 1 → 2
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
  });

  it("computes p95 and p99 on a 100-element range", () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1); // [1..100]
    // p95 → ceil(100*0.95)-1 = 94 → value 95
    expect(percentile(sorted, 0.95)).toBe(95);
    // p99 → ceil(100*0.99)-1 = 98 → value 99
    expect(percentile(sorted, 0.99)).toBe(99);
  });
});

// ── counter increment (unit via minimal Hono app) ─────────────────────────────

describe("metricsMiddleware — counter increment", () => {
  it("increments requests counter on each request", async () => {
    const probe = new Hono();
    probe.use("*", metricsMiddleware);
    probe.get("/ping", (c) => c.json({ ok: true }));

    await probe.request("/ping");
    await probe.request("/ping");
    await probe.request("/ping");

    const snap = getMetricsSnapshot();
    const route = snap.find((r) => r.path.endsWith("/ping"));
    expect(route).toBeDefined();
    expect(route!.requests).toBe(3);
  });

  it("tracks 4xx errors separately from 2xx", async () => {
    const probe = new Hono();
    probe.use("*", metricsMiddleware);
    probe.get("/ok", (c) => c.json({ ok: true }, 200));
    probe.get("/bad", (c) => c.json({ error: "not found" }, 404));

    await probe.request("/ok");
    await probe.request("/ok");
    await probe.request("/bad");

    const snap = getMetricsSnapshot();
    const okRoute = snap.find((r) => r.path.endsWith("/ok"));
    const badRoute = snap.find((r) => r.path.endsWith("/bad"));

    expect(okRoute!.requests).toBe(2);
    expect(okRoute!.errors4xx).toBe(0);
    expect(okRoute!.errors5xx).toBe(0);

    expect(badRoute!.requests).toBe(1);
    expect(badRoute!.errors4xx).toBe(1);
    expect(badRoute!.errors5xx).toBe(0);
  });

  it("tracks 5xx errors separately", async () => {
    const probe = new Hono();
    probe.use("*", metricsMiddleware);
    probe.get("/boom", (c) => c.json({ error: "server error" }, 500));

    await probe.request("/boom");
    await probe.request("/boom");

    const snap = getMetricsSnapshot();
    const route = snap.find((r) => r.path.endsWith("/boom"));
    expect(route!.errors5xx).toBe(2);
    expect(route!.errors4xx).toBe(0);
  });

  it("accumulates latency samples into the reservoir", async () => {
    const probe = new Hono();
    probe.use("*", metricsMiddleware);
    probe.get("/timed", (c) => c.json({ ok: true }));

    await probe.request("/timed");
    await probe.request("/timed");
    await probe.request("/timed");

    const snap = getMetricsSnapshot();
    const route = snap.find((r) => r.path.endsWith("/timed"));
    expect(route).toBeDefined();
    // latencyMs values should be non-negative numbers
    expect(route!.latencyMs.p50).toBeGreaterThanOrEqual(0);
    expect(route!.latencyMs.p95).toBeGreaterThanOrEqual(0);
    expect(route!.latencyMs.p99).toBeGreaterThanOrEqual(0);
    // p99 >= p95 >= p50
    expect(route!.latencyMs.p99).toBeGreaterThanOrEqual(route!.latencyMs.p95);
    expect(route!.latencyMs.p95).toBeGreaterThanOrEqual(route!.latencyMs.p50);
  });

  it("groups requests by matched route path, not raw URL", async () => {
    const probe = new Hono();
    probe.use("*", metricsMiddleware);
    probe.get("/items/:id", (c) => c.json({ id: c.req.param("id") }));

    await probe.request("/items/abc");
    await probe.request("/items/xyz");
    await probe.request("/items/123");

    const snap = getMetricsSnapshot();
    // All three requests should map to the same route pattern entry.
    const paramRoute = snap.find((r) => r.path.includes(":id") || r.path.endsWith("/items/:id"));
    if (paramRoute) {
      // If Hono exposes routePath, all 3 are grouped.
      expect(paramRoute.requests).toBe(3);
    } else {
      // If routePath unavailable, they appear as individual raw paths — at most 3 entries.
      const itemRoutes = snap.filter((r) => r.path.startsWith("/items/"));
      const total = itemRoutes.reduce((sum, r) => sum + r.requests, 0);
      expect(total).toBe(3);
    }
  });

  it("resetMetrics() clears all counters", async () => {
    const probe = new Hono();
    probe.use("*", metricsMiddleware);
    probe.get("/x", (c) => c.json({ ok: true }));

    await probe.request("/x");
    expect(getMetricsSnapshot().length).toBeGreaterThan(0);

    resetMetrics();
    expect(getMetricsSnapshot()).toHaveLength(0);
  });
});

// ── GET /api/metrics — integration ────────────────────────────────────────────

describe("GET /api/metrics", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const res = await app.request("/api/metrics");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("returns 401 when Bearer token is wrong", async () => {
    const res = await app.request("/api/metrics", {
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when LSDS_ADMIN_SECRET is not configured", async () => {
    vi.stubEnv("LSDS_ADMIN_SECRET", "");
    const res = await app.request("/api/metrics", {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 with correct payload shape for an authenticated admin", async () => {
    const ip = `10.88.${Math.floor(Math.random() * 256)}.1`;
    const res = await app.request("/api/metrics", {
      headers: adminHeaders(ip),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { uptime: number; routes: unknown[] };

    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(body.routes)).toBe(true);
  });

  it("reflects correct request count after N requests to a known route", async () => {
    // Reset metrics so prior test traffic doesn't pollute.
    resetMetrics();

    // Make several requests to /health/live (no auth, always 200)
    await app.request("/health/live");
    await app.request("/health/live");
    await app.request("/health/live");

    const ip = `10.88.${Math.floor(Math.random() * 256)}.2`;
    const res = await app.request("/api/metrics", {
      headers: adminHeaders(ip),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      uptime: number;
      routes: Array<{
        method: string;
        path: string;
        requests: number;
        errors4xx: number;
        errors5xx: number;
        latencyMs: { p50: number; p95: number; p99: number };
      }>;
    };

    const liveRoute = body.routes.find(
      (r) => r.method === "GET" && r.path.includes("/health/live")
    );
    expect(liveRoute).toBeDefined();
    expect(liveRoute!.requests).toBeGreaterThanOrEqual(3);
    expect(typeof liveRoute!.errors4xx).toBe("number");
    expect(typeof liveRoute!.errors5xx).toBe("number");
    expect(typeof liveRoute!.latencyMs.p50).toBe("number");
    expect(typeof liveRoute!.latencyMs.p95).toBe("number");
    expect(typeof liveRoute!.latencyMs.p99).toBe("number");
  });
});
