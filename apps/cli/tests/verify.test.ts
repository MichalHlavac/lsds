// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runVerify } from "../src/commands/verify.js";

describe("runVerify", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ready=true on HTTP 200", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "ready" }), { status: 200 })
    );

    const result = await runVerify({ apiUrl: "http://localhost:3000", apiKey: "k" });

    expect(result.ready).toBe(true);
    expect(result.status).toBe(200);
  });

  it("returns ready=false on HTTP 503", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "not_ready" }), { status: 503 })
    );

    const result = await runVerify({ apiUrl: "http://localhost:3000", apiKey: "k" });

    expect(result.ready).toBe(false);
    expect(result.status).toBe(503);
  });

  it("calls GET /health/ready with Authorization header", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response("{}", { status: 200 })
    );
    vi.stubGlobal("fetch", mockFetch);

    await runVerify({ apiUrl: "http://api.example.com", apiKey: "secret" });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.example.com/health/ready");
    expect((init.headers as Record<string, string>)["X-Api-Key"]).toBe("secret");
  });

  it("never logs the API key", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("{}", { status: 200 })
    );
    const consoleSpy = vi.spyOn(console, "log");
    const stderrSpy = vi.spyOn(process.stderr, "write");

    await runVerify({ apiUrl: "http://localhost:3000", apiKey: "super-secret-key" });

    for (const call of consoleSpy.mock.calls) {
      expect(String(call[0])).not.toContain("super-secret-key");
    }
    for (const call of stderrSpy.mock.calls) {
      expect(String(call[0])).not.toContain("super-secret-key");
    }
  });
});
