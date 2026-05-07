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
    await client.getContext("00000000-0000-0000-0000-000000000001");

    expect(fetch).toHaveBeenCalledOnce();
    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:3001/agent/v1/context/00000000-0000-0000-0000-000000000001"
    );
    expect((opts.headers as Record<string, string>)["x-tenant-id"]).toBe(
      "test-tenant"
    );
  });

  it("getContext forwards tokenBudget as ?tokenBudget query param", async () => {
    const fetch = mockFetch({ data: { root: { id: "abc" } } });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    await client.getContext("00000000-0000-0000-0000-000000000001", 8000, "ANALYTICAL");

    const [url] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:3001/agent/v1/context/00000000-0000-0000-0000-000000000001?tokenBudget=8000&profile=ANALYTICAL"
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

  it("getWriteGuidance sends GET to /agent/v1/write-guidance/:nodeType", async () => {
    const guidance = {
      nodeType: "Service",
      guardrails: [
        {
          ruleKey: "service.naming.kebab",
          severity: "ERROR",
          condition: "name matches /^[a-z][a-z0-9-]*$/",
          rationale: "kebab-case keeps service identifiers DNS-safe",
          remediation: "rename to kebab-case",
        },
      ],
      instruction: "For each rule above, verify…",
    };
    const fetch = mockFetch({ data: guidance });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    const result = await client.getWriteGuidance("Service");

    expect(result).toEqual(guidance);
    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/agent/v1/write-guidance/Service");
    expect(opts.method).toBe("GET");
    expect((opts.headers as Record<string, string>)["x-tenant-id"]).toBe(
      "test-tenant"
    );
  });

  it("getWriteGuidance URL-encodes the nodeType", async () => {
    const fetch = mockFetch({ data: { nodeType: "weird/type", guardrails: [], instruction: "" } });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    await client.getWriteGuidance("weird/type");

    const [url] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/agent/v1/write-guidance/weird%2Ftype");
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

  it("upsertNode sends PUT to /v1/nodes with body", async () => {
    const node = { id: "abc", type: "Service", layer: "L4", name: "auth-svc" };
    const fetch = mockFetch({ data: node }, 200);
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    const result = await client.upsertNode({ type: "Service", layer: "L4", name: "auth-svc" });

    expect(result).toEqual(node);
    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/v1/nodes");
    expect(opts.method).toBe("PUT");
    expect(JSON.parse(opts.body as string)).toMatchObject({ type: "Service", layer: "L4", name: "auth-svc" });
  });

  it("upsertEdge sends PUT to /v1/edges with body", async () => {
    const edge = { id: "e1", sourceId: "s1", targetId: "t1", type: "DEPENDS_ON" };
    const fetch = mockFetch({ data: edge }, 200);
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    const result = await client.upsertEdge({
      sourceId: "00000000-0000-0000-0000-000000000001",
      targetId: "00000000-0000-0000-0000-000000000002",
      type: "DEPENDS_ON",
      layer: "L4",
    });

    expect(result).toEqual(edge);
    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/v1/edges");
    expect(opts.method).toBe("PUT");
  });

  it("queryEdges sends GET to /v1/edges with sourceId query param", async () => {
    const fetch = mockFetch({ data: [] });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    await client.queryEdges({ sourceId: "00000000-0000-0000-0000-000000000001", type: "DEPENDS_ON" });

    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:3001/v1/edges?sourceId=00000000-0000-0000-0000-000000000001&type=DEPENDS_ON"
    );
    expect(opts.method).toBe("GET");
    expect((opts.headers as Record<string, string>)["x-tenant-id"]).toBe("test-tenant");
  });

  it("queryEdges sends GET to /v1/edges with no params", async () => {
    const fetch = mockFetch({ data: [] });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    await client.queryEdges({});

    const [url] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/v1/edges");
  });

  it("getViolations sends GET to /v1/violations with filters", async () => {
    const fetch = mockFetch({ data: [] });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    await client.getViolations({
      nodeId: "00000000-0000-0000-0000-000000000001",
      resolved: false,
      limit: 10,
    });

    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:3001/v1/violations?nodeId=00000000-0000-0000-0000-000000000001&resolved=false&limit=10"
    );
    expect(opts.method).toBe("GET");
  });

  it("getViolations sends GET to /v1/violations with no params", async () => {
    const fetch = mockFetch({ data: [] });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    await client.getViolations({});

    const [url] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/v1/violations");
  });

  it("architectAnalyze sends POST to /agent/v1/architect/analyze with body", async () => {
    const response = { scannedAt: "2026-01-01T00:00:00.000Z", summary: { totalViolations: 3 } };
    const fetch = mockFetch({ data: response });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    const result = await client.architectAnalyze({ persist: true, types: ["Service"], sampleLimit: 10 });

    expect(result).toEqual(response);
    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/agent/v1/architect/analyze");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toMatchObject({ persist: true, types: ["Service"], sampleLimit: 10 });
    expect((opts.headers as Record<string, string>)["x-tenant-id"]).toBe("test-tenant");
  });

  it("bulkImport sends POST to /v1/import/bulk with nodes and edges", async () => {
    const created = { nodes: ["id-1", "id-2"], edges: ["eid-1"] };
    const fetch = mockFetch({ data: { created, errors: [] } }, 201);
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    const result = await client.bulkImport({
      nodes: [
        { type: "Service", layer: "L4", name: "svc-a" },
        { type: "Service", layer: "L4", name: "svc-b" },
      ],
      edges: [
        {
          sourceId: "00000000-0000-0000-0000-000000000001",
          targetId: "00000000-0000-0000-0000-000000000002",
          type: "depends-on",
          layer: "L4",
        },
      ],
    });

    expect(result).toEqual({ created, errors: [] });
    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/v1/import/bulk");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string);
    expect(body.nodes).toHaveLength(2);
    expect(body.edges).toHaveLength(1);
    expect((opts.headers as Record<string, string>)["x-tenant-id"]).toBe("test-tenant");
  });

  it("bulkImport sends POST with nodes only (no edges)", async () => {
    const fetch = mockFetch({ data: { created: { nodes: ["id-1"], edges: [] }, errors: [] } }, 201);
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    await client.bulkImport({ nodes: [{ type: "Service", layer: "L4", name: "svc-a" }] });

    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/v1/import/bulk");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string);
    expect(body.nodes).toHaveLength(1);
    expect(body.edges).toBeUndefined();
  });

  it("bulkImport throws on 400 (oversized batch)", async () => {
    const fetch = mockFetch({ error: "validation error", issues: [] }, 400);
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    await expect(
      client.bulkImport({ nodes: [{ type: "Service", layer: "L4", name: "svc" }] })
    ).rejects.toThrow("400");
  });

  it("architectAnalyze sends POST with empty body when no params given", async () => {
    const fetch = mockFetch({ data: { summary: {} } });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    await client.architectAnalyze();

    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/agent/v1/architect/analyze");
    expect(JSON.parse(opts.body as string)).toEqual({});
  });

  it("architectConsistency sends GET to /agent/v1/architect/consistency", async () => {
    const response = { scannedAt: "2026-01-01T00:00:00.000Z", patternCount: 2, patterns: [] };
    const fetch = mockFetch({ data: response });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    const result = await client.architectConsistency();

    expect(result).toEqual(response);
    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/agent/v1/architect/consistency");
    expect(opts.method).toBe("GET");
    expect((opts.headers as Record<string, string>)["x-tenant-id"]).toBe("test-tenant");
  });

  it("architectDrift sends GET to /agent/v1/architect/drift without snapshotId", async () => {
    const fetch = mockFetch({ data: { delta: null, recentChanges: [] } });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    await client.architectDrift();

    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/agent/v1/architect/drift");
    expect(opts.method).toBe("GET");
  });

  it("architectDrift appends ?snapshotId when provided", async () => {
    const snapshotId = "00000000-0000-0000-0000-000000000099";
    const fetch = mockFetch({ data: { delta: { nodesDelta: 5 }, recentChanges: [] } });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    await client.architectDrift(snapshotId);

    const [url] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://localhost:3001/agent/v1/architect/drift?snapshotId=${snapshotId}`);
  });

  it("architectDebt sends GET to /agent/v1/architect/debt", async () => {
    const response = { scannedAt: "2026-01-01T00:00:00.000Z", totals: { total: 10, open: 7, inProgress: 2 } };
    const fetch = mockFetch({ data: response });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    const result = await client.architectDebt();

    expect(result).toEqual(response);
    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/agent/v1/architect/debt");
    expect(opts.method).toBe("GET");
    expect((opts.headers as Record<string, string>)["x-tenant-id"]).toBe("test-tenant");
  });

  it("impactPredict sends POST to /agent/v1/architect/impact-predict with body", async () => {
    const response = {
      predictedAt: "2026-01-01T00:00:00.000Z",
      changeType: "update",
      maxDepth: 3,
      affectedNodes: [],
      predictedViolations: [],
      requiresConfirmation: false,
      summary: "UPDATE affects 0 neighboring node(s). No guardrail violations predicted. No high-impact layer nodes in blast radius.",
    };
    const fetch = mockFetch({ data: response });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    const result = await client.impactPredict({
      changeType: "update",
      nodeId: "00000000-0000-0000-0000-000000000001",
      proposedNode: { type: "Service", layer: "L3", name: "auth-svc-v2" },
    });

    expect(result).toEqual(response);
    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/agent/v1/architect/impact-predict");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toMatchObject({
      changeType: "update",
      nodeId: "00000000-0000-0000-0000-000000000001",
      proposedNode: { type: "Service", layer: "L3", name: "auth-svc-v2" },
    });
    expect((opts.headers as Record<string, string>)["x-tenant-id"]).toBe("test-tenant");
  });

  it("impactPredict — requiresConfirmation=true when L1/L2 nodes in blast radius", async () => {
    const response = {
      predictedAt: "2026-01-01T00:00:00.000Z",
      changeType: "delete",
      maxDepth: 3,
      affectedNodes: [
        { id: "00000000-0000-0000-0000-000000000010", name: "BusinessCapability-A", type: "BoundedContext", layer: "L1", relationshipPath: [] },
      ],
      predictedViolations: [],
      requiresConfirmation: true,
      summary: "DELETE affects 1 neighboring node(s). No guardrail violations predicted. Requires confirmation — L1/L2 (Business/Domain) node(s) in blast radius.",
    };
    const fetch = mockFetch({ data: response });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    const result = await client.impactPredict({
      changeType: "delete",
      nodeId: "00000000-0000-0000-0000-000000000002",
    });

    expect((result as typeof response).requiresConfirmation).toBe(true);
    expect((result as typeof response).affectedNodes).toHaveLength(1);
    expect((result as typeof response).affectedNodes[0].layer).toBe("L1");
  });

  it("impactPredict — returns predictedViolations for create scenario", async () => {
    const response = {
      predictedAt: "2026-01-01T00:00:00.000Z",
      changeType: "create",
      maxDepth: 3,
      affectedNodes: [],
      predictedViolations: [
        { ruleKey: "naming.node.min_length", severity: "WARN", nodeId: null, description: "Node name 'xy' is shorter than minimum 3" },
      ],
      requiresConfirmation: false,
      summary: "CREATE affects 0 neighboring node(s). Predicted 1 violation(s): 0 ERROR, 1 WARN. No high-impact layer nodes in blast radius.",
    };
    const fetch = mockFetch({ data: response });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    const result = await client.impactPredict({
      changeType: "create",
      proposedNode: { type: "Service", layer: "L4", name: "xy" },
    });

    expect((result as typeof response).predictedViolations).toHaveLength(1);
    expect((result as typeof response).predictedViolations[0].ruleKey).toBe("naming.node.min_length");
    expect((result as typeof response).requiresConfirmation).toBe(false);
  });

  it("impactPredict — includes edgeChanges in request body", async () => {
    const response = {
      predictedAt: "2026-01-01T00:00:00.000Z",
      changeType: "create",
      maxDepth: 2,
      affectedNodes: [],
      predictedViolations: [],
      requiresConfirmation: false,
      summary: "CREATE affects 0 neighboring node(s). No guardrail violations predicted. No high-impact layer nodes in blast radius.",
    };
    const fetch = mockFetch({ data: response });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    await client.impactPredict({
      changeType: "create",
      proposedNode: { type: "Service", layer: "L3", name: "new-svc" },
      edgeChanges: [
        { fromId: "00000000-0000-0000-0000-000000000001", toId: "00000000-0000-0000-0000-000000000002", edgeType: "DEPENDS_ON", action: "add" },
      ],
      maxDepth: 2,
    });

    const [, opts] = fetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string);
    expect(body.edgeChanges).toHaveLength(1);
    expect(body.edgeChanges[0].action).toBe("add");
    expect(body.maxDepth).toBe(2);
  });

  it("architectAdrCoverage sends GET to /agent/v1/architect/adr-coverage without minEdges", async () => {
    const response = { scannedAt: "2026-01-01T00:00:00.000Z", uncoveredNodes: [], coveragePercent: 100 };
    const fetch = mockFetch({ data: response });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    const result = await client.architectAdrCoverage();

    expect(result).toEqual(response);
    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/agent/v1/architect/adr-coverage");
    expect(opts.method).toBe("GET");
    expect((opts.headers as Record<string, string>)["x-tenant-id"]).toBe("test-tenant");
  });

  it("architectAdrCoverage appends ?minEdges when provided", async () => {
    const fetch = mockFetch({ data: { scannedAt: "2026-01-01T00:00:00.000Z", uncoveredNodes: [], coveragePercent: 80 } });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    await client.architectAdrCoverage(5);

    const [url] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/agent/v1/architect/adr-coverage?minEdges=5");
  });

  it("architectRequirementFulfillment sends GET to /agent/v1/architect/requirement-fulfillment", async () => {
    const response = { scannedAt: "2026-01-01T00:00:00.000Z", requirements: [], fulfilledCount: 0, totalCount: 0 };
    const fetch = mockFetch({ data: response });
    vi.stubGlobal("fetch", fetch);

    const client = createLsdsClient(mockConfig);
    const result = await client.architectRequirementFulfillment();

    expect(result).toEqual(response);
    const [url, opts] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/agent/v1/architect/requirement-fulfillment");
    expect(opts.method).toBe("GET");
    expect((opts.headers as Record<string, string>)["x-tenant-id"]).toBe("test-tenant");
  });
});
