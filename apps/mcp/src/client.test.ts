// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLsdsClient, getConfigFromEnv, LifecycleTransitionApiError } from "./client.js";

const mockConfig = { baseUrl: "http://localhost:3001", tenantId: "test-tenant" };

function mockFetch(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

describe("getConfigFromEnv", () => {
  it("returns defaults when env vars absent", () => {
    const cfg = getConfigFromEnv();
    expect(cfg.baseUrl).toBe("http://localhost:3001");
    expect(cfg.tenantId).toBe("default");
  });

  it("reads LSDS_API_URL and LSDS_TENANT_ID", () => {
    vi.stubEnv("LSDS_API_URL", "http://api:4000");
    vi.stubEnv("LSDS_TENANT_ID", "acme");
    const cfg = getConfigFromEnv();
    expect(cfg.baseUrl).toBe("http://api:4000");
    expect(cfg.tenantId).toBe("acme");
    vi.unstubAllEnvs();
  });
});

describe("createLsdsClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("getContext sends GET with correct path and tenant header", async () => {
    const fetch = mockFetch({ data: { node: { id: "abc" } } });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    await client.getContext("00000000-0000-0000-0000-000000000001", 2);

    expect(fetch).toHaveBeenCalledOnce();
    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:3001/agent/v1/context/00000000-0000-0000-0000-000000000001?depth=2"
    );
    expect((opts.headers as Record<string, string>)["x-tenant-id"]).toBe(
      "test-tenant"
    );
  });

  it("searchNodes sends POST to /agent/v1/search", async () => {
    const fetch = mockFetch({ data: [] });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    await client.searchNodes({ query: "auth", layer: "L3" });

    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/agent/v1/search");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ query: "auth", layer: "L3" });
  });

  it("createNode sends POST to /v1/nodes", async () => {
    const nodePayload = { id: "xyz", type: "Service", layer: "L4", name: "auth-svc" };
    const fetch = mockFetch({ data: nodePayload }, 201);
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    const result = await client.createNode({
      type: "Service",
      layer: "L4",
      name: "auth-svc",
    });

    expect(result).toEqual(nodePayload);
    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/v1/nodes");
    expect(opts.method).toBe("POST");
  });

  it("throws on non-ok response", async () => {
    const fetch = mockFetch({ error: "not found" }, 404);
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    await expect(
      client.getContext("00000000-0000-0000-0000-000000000001")
    ).rejects.toThrow("404");
  });

  it("throws with status code when error response body is not valid JSON", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new SyntaxError("Unexpected token '<'")),
    });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    await expect(
      client.getContext("00000000-0000-0000-0000-000000000001")
    ).rejects.toThrow("502");
  });

  it("deprecateNode sends POST to lifecycle endpoint", async () => {
    const fetch = mockFetch({ data: { id: "abc", lifecycleStatus: "DEPRECATED" } });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    await client.deprecateNode("00000000-0000-0000-0000-000000000002");

    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:3001/v1/lifecycle/nodes/00000000-0000-0000-0000-000000000002/deprecate"
    );
    expect(opts.method).toBe("POST");
  });

  it.each(["deprecate", "archive", "purge"] as const)(
    "transitionNodeLifecycle — %s — sends PATCH to /v1/nodes/:id/lifecycle",
    async (transition) => {
      const nodeId = "00000000-0000-0000-0000-000000000010";
      const fetch = mockFetch({ data: { id: nodeId, lifecycleStatus: "DEPRECATED" } });
      vi.stubGlobal("fetch", fetch);

      const client = createLsdsClient(mockConfig);
      await client.transitionNodeLifecycle(nodeId, transition);

      const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`http://localhost:3001/v1/nodes/${nodeId}/lifecycle`);
      expect(opts.method).toBe("PATCH");
      expect(JSON.parse(opts.body as string)).toEqual({ transition });
    }
  );

  it.each(["deprecate", "archive", "purge"] as const)(
    "transitionEdgeLifecycle — %s — sends PATCH to /v1/edges/:id/lifecycle",
    async (transition) => {
      const edgeId = "00000000-0000-0000-0000-000000000020";
      const fetch = mockFetch({ data: { id: edgeId, lifecycleStatus: "ARCHIVED" } });
      vi.stubGlobal("fetch", fetch);

      const client = createLsdsClient(mockConfig);
      await client.transitionEdgeLifecycle(edgeId, transition);

      const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`http://localhost:3001/v1/edges/${edgeId}/lifecycle`);
      expect(opts.method).toBe("PATCH");
      expect(JSON.parse(opts.body as string)).toEqual({ transition });
    }
  );

  it("transitionNodeLifecycle — 422 — throws LifecycleTransitionApiError with structured fields", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: () =>
        Promise.resolve({
          error: "invalid lifecycle transition",
          currentStatus: "ACTIVE",
          requestedTransition: "purge",
          allowed: ["deprecate"],
        }),
    });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    const err = await client
      .transitionNodeLifecycle("00000000-0000-0000-0000-000000000011", "purge")
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LifecycleTransitionApiError);
    const lcErr = err as LifecycleTransitionApiError;
    expect(lcErr.currentStatus).toBe("ACTIVE");
    expect(lcErr.requestedTransition).toBe("purge");
    expect(lcErr.allowed).toEqual(["deprecate"]);
  });

  it("transitionEdgeLifecycle — 404 — throws with 'not found'", async () => {
    const fetch = mockFetch({ error: "not found" }, 404);
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    await expect(
      client.transitionEdgeLifecycle("00000000-0000-0000-0000-000000000021", "archive")
    ).rejects.toThrow("not found");
  });
});
