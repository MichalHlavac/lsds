// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it, vi } from "vitest";

const ALLOWED_ORIGIN = "http://localhost:3000";
const EVIL_ORIGIN = "http://evil.example.com";

async function makeApp(corsOrigin?: string) {
  if (corsOrigin !== undefined) {
    process.env["CORS_ORIGIN"] = corsOrigin;
  } else {
    delete process.env["CORS_ORIGIN"];
  }
  vi.resetModules();
  const { app } = await import("../src/app.js");
  return app;
}

const PREFLIGHT_HEADERS = {
  Origin: ALLOWED_ORIGIN,
  "Access-Control-Request-Method": "GET",
  "Access-Control-Request-Headers": "Authorization",
};

describe("CORS middleware — allowed origin preflight", () => {
  it("OPTIONS /health returns a success status", async () => {
    const app = await makeApp(undefined);
    const res = await app.request("/health", { method: "OPTIONS", headers: PREFLIGHT_HEADERS });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });

  it("OPTIONS /health reflects allowed origin in Access-Control-Allow-Origin", async () => {
    const app = await makeApp(undefined);
    const res = await app.request("/health", { method: "OPTIONS", headers: PREFLIGHT_HEADERS });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
  });

  it("OPTIONS /health response includes Authorization in Access-Control-Allow-Headers", async () => {
    const app = await makeApp(undefined);
    const res = await app.request("/health", { method: "OPTIONS", headers: PREFLIGHT_HEADERS });
    const allowHeaders = res.headers.get("Access-Control-Allow-Headers") ?? "";
    expect(allowHeaders.toLowerCase()).toContain("authorization");
  });

  it("OPTIONS /health response includes Vary header", async () => {
    const app = await makeApp(undefined);
    const res = await app.request("/health", { method: "OPTIONS", headers: PREFLIGHT_HEADERS });
    expect(res.headers.get("Vary")).toBeTruthy();
  });
});

describe("CORS middleware — disallowed origin", () => {
  it("GET /health from evil origin does not reflect evil origin in Access-Control-Allow-Origin", async () => {
    const app = await makeApp(undefined);
    const res = await app.request("/health", {
      method: "GET",
      headers: { Origin: EVIL_ORIGIN },
    });
    const acao = res.headers.get("Access-Control-Allow-Origin");
    expect(acao).not.toBe(EVIL_ORIGIN);
  });
});
