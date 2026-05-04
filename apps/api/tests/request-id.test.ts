// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it, beforeAll } from "vitest";
import { app } from "../src/app.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("request-id middleware", () => {
  it("adds X-Request-Id to response when no header sent", async () => {
    const res = await app.request("/health");
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
  });

  it("generated X-Request-Id is a valid UUID v4", async () => {
    const res = await app.request("/health");
    expect(res.headers.get("X-Request-Id")).toMatch(UUID_RE);
  });

  it("echoes back a client-supplied X-Request-Id", async () => {
    const clientId = "test-id-1234";
    const res = await app.request("/health", { headers: { "X-Request-Id": clientId } });
    expect(res.headers.get("X-Request-Id")).toBe(clientId);
  });

  it("different requests without X-Request-Id get distinct IDs", async () => {
    const [res1, res2] = await Promise.all([
      app.request("/health"),
      app.request("/health"),
    ]);
    const id1 = res1.headers.get("X-Request-Id");
    const id2 = res2.headers.get("X-Request-Id");
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
  });
});

describe("request-id CORS exposure", () => {
  it("OPTIONS /health includes X-Request-Id in Access-Control-Allow-Headers", async () => {
    const res = await app.request("/health", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "X-Request-Id",
      },
    });
    const allowHeaders = res.headers.get("Access-Control-Allow-Headers") ?? "";
    expect(allowHeaders.toLowerCase()).toContain("x-request-id");
  });
});
