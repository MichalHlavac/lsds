// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { app } from "../src/app.js";
import { logger } from "../src/logger.js";
import type { Logger } from "../src/logger.js";
import { requestTimeoutMiddleware } from "../src/middleware/request-timeout.js";

const TIMEOUT_MS = 60; // small value for fast tests
const HANDLER_DELAY_MS = 300; // must exceed TIMEOUT_MS

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe("requestTimeoutMiddleware — unit", () => {
  it("returns 503 with { error: 'request timeout' } when handler exceeds timeout", async () => {
    const testApp = new Hono();
    testApp.use(requestTimeoutMiddleware(TIMEOUT_MS));
    testApp.get("/slow", async (c) => {
      await sleep(HANDLER_DELAY_MS);
      return c.json({ ok: true });
    });

    const res = await testApp.request("/slow");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: "request timeout" });
  });

  it("sets Retry-After: 5 on timeout response", async () => {
    const testApp = new Hono();
    testApp.use(requestTimeoutMiddleware(TIMEOUT_MS));
    testApp.get("/slow", async (c) => {
      await sleep(HANDLER_DELAY_MS);
      return c.json({ ok: true });
    });

    const res = await testApp.request("/slow");
    expect(res.headers.get("Retry-After")).toBe("5");
  });

  it("passes through with correct status when handler completes within timeout", async () => {
    const testApp = new Hono();
    testApp.use(requestTimeoutMiddleware(500));
    testApp.get("/fast", (c) => c.json({ ok: true }));

    const res = await testApp.request("/fast");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("re-throws non-timeout errors from the handler", async () => {
    const testApp = new Hono();
    testApp.use(requestTimeoutMiddleware(500));
    testApp.get("/throws", async () => {
      throw new Error("boom");
    });
    testApp.onError((err, c) => {
      return c.json({ error: err.message }, 500);
    });

    const res = await testApp.request("/throws");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("boom");
  });

  it("does not time out /health/live", async () => {
    const res = await app.request("/health/live");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("alive");
  });

  it("does not time out /health/ready", async () => {
    const res = await app.request("/health/ready");
    // status may be 200 or 503 depending on DB state; must not be a timeout 503
    const body = await res.json();
    expect(body.error).not.toBe("request timeout");
  });
});

describe("requestTimeoutMiddleware — logging", () => {
  let warned: Array<{ obj: Record<string, unknown>; msg: string }>;
  let childSpy: ReturnType<typeof vi.spyOn<Logger, "child">>;

  beforeEach(() => {
    warned = [];
    const mockLogger: Logger = {
      info: vi.fn(),
      warn: vi.fn((obj, msg) => { warned.push({ obj, msg }); }),
      error: vi.fn(),
      child: vi.fn(() => mockLogger),
    };
    childSpy = vi.spyOn(logger, "child").mockReturnValue(mockLogger);
  });

  afterEach(() => {
    childSpy.mockRestore();
  });

  it("logs WARN with path, method, durationMs on timeout", async () => {
    const testApp = new Hono();
    testApp.use(async (c, next) => {
      c.set("log", logger.child({ requestId: "test-rid" }));
      await next();
    });
    testApp.use(requestTimeoutMiddleware(TIMEOUT_MS));
    testApp.get("/slow", async (c) => {
      await sleep(HANDLER_DELAY_MS);
      return c.json({ ok: true });
    });

    await testApp.request("/slow");

    const entry = warned.find((w) => w.msg === "request timeout");
    expect(entry).toBeDefined();
    expect(entry!.obj.path).toBe("/slow");
    expect(entry!.obj.method).toBe("GET");
    expect(typeof entry!.obj.durationMs).toBe("number");
    expect(entry!.obj.durationMs).toBeGreaterThanOrEqual(TIMEOUT_MS);
  });

  it("includes tenantId in WARN log when X-Tenant-Id header is present", async () => {
    const testApp = new Hono();
    testApp.use(async (c, next) => {
      c.set("log", logger.child({ requestId: "test-rid" }));
      await next();
    });
    testApp.use(requestTimeoutMiddleware(TIMEOUT_MS));
    testApp.get("/slow", async (c) => {
      await sleep(HANDLER_DELAY_MS);
      return c.json({ ok: true });
    });

    await testApp.request("/slow", { headers: { "X-Tenant-Id": "tenant-xyz" } });

    const entry = warned.find((w) => w.msg === "request timeout");
    expect(entry).toBeDefined();
    expect(entry!.obj.tenantId).toBe("tenant-xyz");
  });

  it("omits tenantId from WARN log when header is absent", async () => {
    const testApp = new Hono();
    testApp.use(async (c, next) => {
      c.set("log", logger.child({ requestId: "test-rid" }));
      await next();
    });
    testApp.use(requestTimeoutMiddleware(TIMEOUT_MS));
    testApp.get("/slow", async (c) => {
      await sleep(HANDLER_DELAY_MS);
      return c.json({ ok: true });
    });

    await testApp.request("/slow");

    const entry = warned.find((w) => w.msg === "request timeout");
    expect(entry).toBeDefined();
    expect(entry!.obj).not.toHaveProperty("tenantId");
  });
});

describe("requestTimeoutMiddleware — integration (full pipeline)", () => {
  let integrationApp: Hono;

  // Cold-load with DB pool init can take several seconds; give it room.
  beforeAll(async () => {
    process.env["REQUEST_TIMEOUT_MS"] = "50";
    vi.resetModules();
    const mod = await import("../src/app.js");
    integrationApp = mod.app;
    // Add test probe routes to the live app — they sit behind the full middleware chain.
    integrationApp.get("/_probe/slow", async (c) => {
      await sleep(HANDLER_DELAY_MS);
      return c.json({ ok: true });
    });
    integrationApp.get("/_probe/fast", (c) => c.json({ ok: true }));
  }, 15_000);

  afterAll(() => {
    delete process.env["REQUEST_TIMEOUT_MS"];
    vi.resetModules();
  });

  it("returns 503 when route exceeds REQUEST_TIMEOUT_MS (negative path)", async () => {
    const res = await integrationApp.request("/_probe/slow");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: "request timeout" });
  });

  it("sets Retry-After: 5 header on 503 timeout response", async () => {
    const res = await integrationApp.request("/_probe/slow");
    expect(res.headers.get("Retry-After")).toBe("5");
  });

  it("returns 200 when route completes under REQUEST_TIMEOUT_MS (positive path)", async () => {
    const res = await integrationApp.request("/_probe/fast");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("excluded path /health/live bypasses timeout enforcement", async () => {
    const res = await integrationApp.request("/health/live");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("alive");
    expect(body.error).toBeUndefined();
  });
});
