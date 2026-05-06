// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { Hono } from "hono";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { app } from "../src/app.js";
import { logger } from "../src/logger.js";
import type { Logger } from "../src/logger.js";
import { requestLoggerMiddleware } from "../src/middleware/request-logger.js";

describe("request-logger middleware", () => {
  let logged: Array<{ obj: Record<string, unknown>; msg: string }>;
  let childSpy: ReturnType<typeof vi.spyOn<Logger, "child">>;

  beforeEach(() => {
    logged = [];
    const mockLogger: Logger = {
      info: vi.fn((obj, msg) => { logged.push({ obj, msg }); }),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(() => mockLogger),
    };
    childSpy = vi.spyOn(logger, "child").mockReturnValue(mockLogger);
  });

  afterEach(() => {
    childSpy.mockRestore();
  });

  it("logs method, path, status, and duration_ms for a successful request", async () => {
    await app.request("/health");
    const entry = logged.find((l) => l.msg === "request");
    expect(entry).toBeDefined();
    expect(entry!.obj.method).toBe("GET");
    expect(entry!.obj.path).toBe("/health");
    expect(entry!.obj.status).toBe(200);
    expect(typeof entry!.obj.duration_ms).toBe("number");
    expect(entry!.obj.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("includes tenantId when X-Tenant-Id header is present", async () => {
    await app.request("/health", {
      headers: { "X-Tenant-Id": "tenant-abc" },
    });
    const entry = logged.find((l) => l.msg === "request");
    expect(entry).toBeDefined();
    expect(entry!.obj.tenantId).toBe("tenant-abc");
  });

  it("omits tenantId when X-Tenant-Id header is absent", async () => {
    await app.request("/health");
    const entry = logged.find((l) => l.msg === "request");
    expect(entry).toBeDefined();
    expect(entry!.obj).not.toHaveProperty("tenantId");
  });

  it("logs 404 status for unknown routes", async () => {
    await app.request("/v1/does-not-exist-xyz");
    const entry = logged.find((l) => l.msg === "request");
    expect(entry).toBeDefined();
    expect(entry!.obj.status).toBe(404);
  });

  it("emits exactly one request log entry per request", async () => {
    await app.request("/health");
    const entries = logged.filter((l) => l.msg === "request");
    expect(entries).toHaveLength(1);
  });

  it("logs correct method for POST requests", async () => {
    await app.request("/health", { method: "POST" });
    const entry = logged.find((l) => l.msg === "request");
    expect(entry).toBeDefined();
    expect(entry!.obj.method).toBe("POST");
  });

  it("includes tenantId from context when X-Tenant-Id header is absent (API-key-authed path)", async () => {
    const testApp = new Hono();
    testApp.use(async (c, next) => {
      c.set("log", logger.child({ requestId: "test-rid" }));
      await next();
    });
    testApp.use(requestLoggerMiddleware);
    testApp.use(async (c, next) => {
      c.set("tenantId", "context-tenant-xyz");
      await next();
    });
    testApp.get("/probe", (c) => c.json({ ok: true }));

    await testApp.request("/probe");

    const entry = logged.find((l) => l.msg === "request");
    expect(entry).toBeDefined();
    expect(entry!.obj.tenantId).toBe("context-tenant-xyz");
  });
});
