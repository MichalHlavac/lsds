// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

export class LifecycleTransitionApiError extends Error {
  constructor(
    public readonly currentStatus: string,
    public readonly requestedTransition: string,
    public readonly allowed: string[]
  ) {
    super(`transition '${requestedTransition}' not allowed from '${currentStatus}'`);
  }
}

export interface LsdsClientConfig {
  baseUrl: string;
  tenantId: string;
}

export function getConfigFromEnv(): LsdsClientConfig {
  return {
    baseUrl: process.env["LSDS_API_URL"] ?? "http://localhost:3001",
    tenantId: process.env["LSDS_TENANT_ID"] ?? "default",
  };
}

async function lifecyclePatch<T>(
  config: LsdsClientConfig,
  path: string,
  transition: string
): Promise<T> {
  const url = `${config.baseUrl}${path}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-tenant-id": config.tenantId },
    body: JSON.stringify({ transition }),
  });

  if (res.status === 404) {
    throw new Error("not found");
  }
  if (res.status === 422) {
    const json = (await res.json()) as {
      currentStatus: string;
      requestedTransition: string;
      allowed: string[];
    };
    throw new LifecycleTransitionApiError(
      json.currentStatus,
      json.requestedTransition,
      json.allowed
    );
  }
  if (!res.ok) {
    let errorMsg = "unknown error";
    try {
      const json = (await res.json()) as { error?: string };
      errorMsg = json.error ?? "unknown error";
    } catch { /* non-JSON body */ }
    throw new Error(`LSDS API PATCH ${path} → ${res.status}: ${errorMsg}`);
  }

  const json = (await res.json()) as { data?: T };
  return json.data as T;
}

async function apiRequest<T>(
  config: LsdsClientConfig,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${config.baseUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-tenant-id": config.tenantId,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    let errorMsg = "unknown error";
    try {
      const json = (await res.json()) as { error?: string };
      errorMsg = json.error ?? "unknown error";
    } catch {
      // Non-JSON body (e.g. 502 HTML from a gateway) — status code is sufficient
    }
    throw new Error(`LSDS API ${method} ${path} → ${res.status}: ${errorMsg}`);
  }

  const json = (await res.json()) as { data?: T };
  return json.data as T;
}

export function createLsdsClient(config: LsdsClientConfig) {
  const req = <T>(method: string, path: string, body?: unknown) =>
    apiRequest<T>(config, method, path, body);

  return {
    // ── Knowledge Agent (read) ─────────────────────────────────────────────
    getContext: (nodeId: string, tokenBudget?: number, profile?: string) => {
      const params = new URLSearchParams();
      if (tokenBudget != null) params.set("tokenBudget", String(tokenBudget));
      if (profile) params.set("profile", profile);
      const qs = params.toString();
      return req("GET", `/agent/v1/context/${nodeId}${qs ? `?${qs}` : ""}`);
    },

    searchNodes: (params: {
      query?: string;
      type?: string;
      layer?: string;
      lifecycleStatus?: string;
      attributes?: Record<string, unknown>;
      limit?: number;
    }) => req("POST", "/agent/v1/search", params),

    semanticSearch: (params: {
      query: string;
      limit?: number;
      type?: string;
      layer?: string;
      minScore?: number;
    }) => req("POST", "/agent/v1/search/semantic", params),

    batchLookup: (ids: string[]) =>
      req("POST", "/agent/v1/nodes/batch", { ids }),

    getStats: () => req("GET", "/agent/v1/stats"),

    violationsSummary: () => req("GET", "/agent/v1/violations/summary"),

    evaluateNode: (nodeId: string, persist: boolean) =>
      req("POST", `/agent/v1/evaluate/${nodeId}?persist=${persist}`),

    getWriteGuidance: (nodeType: string) =>
      req("GET", `/agent/v1/write-guidance/${encodeURIComponent(nodeType)}`),

    previewNodeViolations: (body: {
      type: string;
      layer: string;
      name: string;
      version?: string;
      lifecycleStatus?: string;
      attributes?: Record<string, unknown>;
    }) => req("POST", "/v1/nodes/preview-violations", body),

    previewEdgeViolations: (body: {
      sourceId: string;
      targetId: string;
      type: string;
      layer: string;
      traversalWeight?: number;
      attributes?: Record<string, unknown>;
    }) => req("POST", "/v1/edges/preview-violations", body),

    checkNaming: (type: string, name: string) =>
      req("GET", `/agent/v1/naming-check?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}`),

    // ── Traversal ──────────────────────────────────────────────────────────
    traverse: (
      nodeId: string,
      params: {
        depth?: number;
        direction?: "outbound" | "inbound" | "both";
        edgeTypes?: string[];
      }
    ) => req("POST", `/v1/nodes/${nodeId}/traverse`, params),

    // ── Write Agent ────────────────────────────────────────────────────────
    createNode: (body: {
      type: string;
      layer: string;
      name: string;
      version?: string;
      attributes?: Record<string, unknown>;
    }) => req("POST", "/v1/nodes", body),

    updateNode: (
      nodeId: string,
      body: {
        name?: string;
        version?: string;
        attributes?: Record<string, unknown>;
      }
    ) => req("PATCH", `/v1/nodes/${nodeId}`, body),

    deleteNode: (nodeId: string) => req("DELETE", `/v1/nodes/${nodeId}`),

    createEdge: (body: {
      sourceId: string;
      targetId: string;
      type: string;
      layer: string;
      traversalWeight?: number;
      attributes?: Record<string, unknown>;
    }) => req("POST", "/v1/edges", body),

    upsertNode: (body: {
      type: string;
      layer: string;
      name: string;
      version?: string;
      lifecycleStatus?: string;
      attributes?: Record<string, unknown>;
    }) => req("PUT", "/v1/nodes", body),

    upsertEdge: (body: {
      sourceId: string;
      targetId: string;
      type: string;
      layer: string;
      traversalWeight?: number;
      attributes?: Record<string, unknown>;
    }) => req("PUT", "/v1/edges", body),

    queryEdges: (params: {
      sourceId?: string;
      targetId?: string;
      type?: string;
      q?: string;
      limit?: number;
      offset?: number;
    }) => {
      const qs = new URLSearchParams();
      if (params.sourceId) qs.set("sourceId", params.sourceId);
      if (params.targetId) qs.set("targetId", params.targetId);
      if (params.type) qs.set("type", params.type);
      if (params.q) qs.set("q", params.q);
      if (params.limit != null) qs.set("limit", String(params.limit));
      if (params.offset != null) qs.set("offset", String(params.offset));
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return req("GET", `/v1/edges${suffix}`);
    },

    getViolations: (params: {
      nodeId?: string;
      ruleKey?: string;
      resolved?: boolean;
      limit?: number;
      offset?: number;
    }) => {
      const qs = new URLSearchParams();
      if (params.nodeId) qs.set("nodeId", params.nodeId);
      if (params.ruleKey) qs.set("ruleKey", params.ruleKey);
      if (params.resolved != null) qs.set("resolved", String(params.resolved));
      if (params.limit != null) qs.set("limit", String(params.limit));
      if (params.offset != null) qs.set("offset", String(params.offset));
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return req("GET", `/v1/violations${suffix}`);
    },

    // ── Lifecycle ──────────────────────────────────────────────────────────
    deprecateNode: (nodeId: string) =>
      req("POST", `/v1/lifecycle/nodes/${nodeId}/deprecate`),

    archiveNode: (nodeId: string) =>
      req("POST", `/v1/lifecycle/nodes/${nodeId}/archive`),

    transitionNodeLifecycle: (nodeId: string, transition: string) =>
      lifecyclePatch(config, `/v1/nodes/${nodeId}/lifecycle`, transition),

    transitionEdgeLifecycle: (edgeId: string, transition: string) =>
      lifecyclePatch(config, `/v1/edges/${edgeId}/lifecycle`, transition),

    // ── Migration Agent ────────────────────────────────────────────────────────
    migrationPropose: (body: {
      sessionId: string;
      sourceRef: string;
      proposedType: string;
      proposedLayer: string;
      proposedName: string;
      proposedAttrs?: Record<string, unknown>;
      confidence?: Record<string, "HIGH" | "MEDIUM" | "LOW">;
      owner: string;
    }) => req("POST", "/agent/v1/migration/propose", body),

    migrationSession: (sessionId: string) =>
      req("GET", `/agent/v1/migration/sessions/${encodeURIComponent(sessionId)}`),

    migrationCommit: (sessionId: string) =>
      req("POST", `/agent/v1/migration/sessions/${encodeURIComponent(sessionId)}/commit`),

    migrationReviewDraft: (
      draftId: string,
      body: { status?: "approved" | "rejected"; proposedAttrs?: Record<string, unknown> }
    ) => req("PATCH", `/agent/v1/migration/drafts/${encodeURIComponent(draftId)}`, body),

    // ── Architect Agent ────────────────────────────────────────────────────────
    architectAnalyze: (body?: {
      persist?: boolean;
      types?: string[];
      layers?: string[];
      lifecycleStatuses?: string[];
      sampleLimit?: number;
    }) => req("POST", "/agent/v1/architect/analyze", body ?? {}),

    architectConsistency: () => req("GET", "/agent/v1/architect/consistency"),

    architectDrift: (snapshotId?: string) => {
      const qs = snapshotId ? `?snapshotId=${encodeURIComponent(snapshotId)}` : "";
      return req("GET", `/agent/v1/architect/drift${qs}`);
    },

    architectDebt: () => req("GET", "/agent/v1/architect/debt"),

    architectAdrCoverage: (minEdges?: number) => {
      const qs = minEdges != null ? `?minEdges=${minEdges}` : "";
      return req("GET", `/agent/v1/architect/adr-coverage${qs}`);
    },

    architectRequirementFulfillment: () =>
      req("GET", "/agent/v1/architect/requirement-fulfillment"),
  };
}

export type LsdsClient = ReturnType<typeof createLsdsClient>;
