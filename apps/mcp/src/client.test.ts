// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLsdsClient, getConfigFromEnv } from "./client.js";

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

  it("transitionNodeLifecycle sends PATCH /v1/nodes/:id/lifecycle with to in body", async () => {
    const nodePayload = { id: "n1", lifecycleStatus: "DEPRECATED" };
    const fetch = mockFetch({ data: nodePayload });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    const result = await client.transitionNodeLifecycle(
      "00000000-0000-0000-0000-000000000003",
      "DEPRECATED"
    );

    expect(result).toEqual(nodePayload);
    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:3001/v1/nodes/00000000-0000-0000-0000-000000000003/lifecycle"
    );
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body as string)).toEqual({ to: "DEPRECATED" });
  });

  it("transitionNodeLifecycle with ARCHIVED target sends correct body", async () => {
    const fetch = mockFetch({ data: { id: "n2", lifecycleStatus: "ARCHIVED" } });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    await client.transitionNodeLifecycle("00000000-0000-0000-0000-000000000004", "ARCHIVED");

    const [, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toEqual({ to: "ARCHIVED" });
  });

  it("transitionEdgeLifecycle sends PATCH /v1/edges/:id/lifecycle with to in body", async () => {
    const edgePayload = { id: "e1", lifecycleStatus: "DEPRECATED" };
    const fetch = mockFetch({ data: edgePayload });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    const result = await client.transitionEdgeLifecycle(
      "00000000-0000-0000-0000-000000000005",
      "DEPRECATED"
    );

    expect(result).toEqual(edgePayload);
    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:3001/v1/edges/00000000-0000-0000-0000-000000000005/lifecycle"
    );
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body as string)).toEqual({ to: "DEPRECATED" });
  });

  it("transitionEdgeLifecycle with ARCHIVED target sends correct body", async () => {
    const fetch = mockFetch({ data: { id: "e2", lifecycleStatus: "ARCHIVED" } });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    await client.transitionEdgeLifecycle("00000000-0000-0000-0000-000000000006", "ARCHIVED");

    const [, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toEqual({ to: "ARCHIVED" });
  });

  it("transitionNodeLifecycle throws with 422 message on invalid transition", async () => {
    const fetch = mockFetch(
      { error: "invalid lifecycle transition: PURGE → DEPRECATED", from: "PURGE", to: "DEPRECATED" },
      422
    );
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    await expect(
      client.transitionNodeLifecycle("00000000-0000-0000-0000-000000000007", "DEPRECATED")
    ).rejects.toThrow("422");
  });

  it("transitionEdgeLifecycle throws with 422 message on invalid transition", async () => {
    const fetch = mockFetch(
      { error: "invalid lifecycle transition: PURGE → ACTIVE", from: "PURGE", to: "ACTIVE" },
      422
    );
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    await expect(
      client.transitionEdgeLifecycle("00000000-0000-0000-0000-000000000008", "ACTIVE")
    ).rejects.toThrow("422");
  });
});
