// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

// Build a minimal test app that wires oidcMiddleware so we can test it
// without importing the full app (which needs a live DB connection).
// vi.resetModules() is required before each import so env-driven module-level
// constants (ISSUER, oidcEnabled) are re-evaluated with the current env.
async function makeTestApp(issuer?: string) {
  if (issuer !== undefined) {
    process.env["OIDC_ISSUER"] = issuer;
  } else {
    delete process.env["OIDC_ISSUER"];
  }

  vi.resetModules();
  const { oidcMiddleware, oidcEnabled } = await import("../src/auth/oidc.js");

  const testApp = new Hono();
  testApp.use("/protected/*", oidcMiddleware);
  testApp.get("/protected/ping", (c) => c.json({ ok: true }));
  testApp.get("/public/ping", (c) => c.json({ ok: true }));

  return { testApp, oidcEnabled };
}

describe("OIDC middleware — OIDC_ISSUER not set (disabled)", () => {
  it("allows unauthenticated requests through", async () => {
    const { testApp } = await makeTestApp(undefined);
    const res = await testApp.request("/protected/ping");
    expect(res.status).toBe(200);
  });

  it("oidcEnabled is false", async () => {
    const { oidcEnabled } = await makeTestApp(undefined);
    expect(oidcEnabled).toBe(false);
  });
});

describe("OIDC middleware — OIDC_ISSUER set (enabled)", () => {
  it("returns 401 when no Authorization header", async () => {
    const { testApp } = await makeTestApp("https://idp.example.com");
    const res = await testApp.request("/protected/ping");
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header is not Bearer", async () => {
    const { testApp } = await makeTestApp("https://idp.example.com");
    const res = await testApp.request("/protected/ping", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when Bearer token is invalid", async () => {
    const { testApp } = await makeTestApp("https://idp.example.com");
    const res = await testApp.request("/protected/ping", {
      headers: { Authorization: "Bearer not-a-valid-jwt" },
    });
    expect(res.status).toBe(401);
  });

  it("oidcEnabled is true", async () => {
    const { oidcEnabled } = await makeTestApp("https://idp.example.com");
    expect(oidcEnabled).toBe(true);
  });
});

describe("/health is always public", () => {
  it("health returns { status: ok } without auth", async () => {
    delete process.env["OIDC_ISSUER"];
    vi.resetModules();
    const { app } = await import("../src/app.js");
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; uptime: number };
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
  });
});
