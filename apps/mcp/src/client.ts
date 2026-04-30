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
    getContext: (nodeId: string, depth?: number, profile?: string) => {
      const params = new URLSearchParams();
      if (depth != null) params.set("depth", String(depth));
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

    batchLookup: (ids: string[]) =>
      req("POST", "/agent/v1/nodes/batch", { ids }),

    getStats: () => req("GET", "/agent/v1/stats"),

    violationsSummary: () => req("GET", "/agent/v1/violations/summary"),

    evaluateNode: (nodeId: string, persist: boolean) =>
      req("POST", `/agent/v1/evaluate/${nodeId}?persist=${persist}`),

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

    // ── Lifecycle ──────────────────────────────────────────────────────────
    deprecateNode: (nodeId: string) =>
      req("POST", `/v1/lifecycle/nodes/${nodeId}/deprecate`),

    archiveNode: (nodeId: string) =>
      req("POST", `/v1/lifecycle/nodes/${nodeId}/archive`),

    transitionNodeLifecycle: (nodeId: string, transition: string) =>
      lifecyclePatch(config, `/v1/nodes/${nodeId}/lifecycle`, transition),

    transitionEdgeLifecycle: (edgeId: string, transition: string) =>
      lifecyclePatch(config, `/v1/edges/${edgeId}/lifecycle`, transition),
  };
}

export type LsdsClient = ReturnType<typeof createLsdsClient>;
