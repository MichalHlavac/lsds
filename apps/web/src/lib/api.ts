// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { Layer, LifecycleStatus, Severity } from "@lsds/shared";
export type { Layer, LifecycleStatus, Severity };
export type LifecycleTransition = "deprecate" | "archive" | "purge";
export type HistoryOp = "CREATE" | "UPDATE" | "LIFECYCLE_TRANSITION";

export interface NodeHistoryEntry {
  id: string;
  nodeId: string;
  changedAt: string;
  changedBy: string | null;
  op: HistoryOp;
  previous: Record<string, unknown> | null;
  current: Record<string, unknown>;
}

export interface NodeRow {
  id: string;
  tenantId: string;
  type: string;
  layer: Layer;
  name: string;
  version: string;
  lifecycleStatus: LifecycleStatus;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deprecatedAt: string | null;
  archivedAt: string | null;
  purgeAfter: string | null;
}

export interface EdgeRow {
  id: string;
  tenantId: string;
  sourceId: string;
  targetId: string;
  type: string;
  layer: Layer;
  traversalWeight: number;
  lifecycleStatus: LifecycleStatus;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deprecatedAt: string | null;
  archivedAt: string | null;
  purgeAfter: string | null;
}

export interface ViolationRow {
  id: string;
  tenantId: string;
  nodeId: string | null;
  edgeId: string | null;
  sourceNodeId: string | null;
  targetNodeId: string | null;
  ruleKey: string;
  severity: Severity;
  message: string;
  attributes: Record<string, unknown>;
  resolved: boolean;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ViolationListParams {
  nodeId?: string;
  ruleKey?: string;
  resolved?: boolean;
  limit?: number;
  offset?: number;
}

export interface LifecycleErrorBody {
  error: string;
  currentStatus: string;
  requestedTransition: string;
  allowed: string[];
}

export interface BatchFailedItem {
  id: string;
  error: string;
  currentStatus?: string;
  requestedTransition?: string;
  allowed?: string[];
}

export interface BatchLifecycleResult {
  succeeded: NodeRow[];
  failed: BatchFailedItem[];
}

export interface BatchResolveResult {
  succeeded: ViolationRow[];
  failed: { id: string; error: string }[];
}

export interface ApiErrorBody {
  error?: string;
  issues?: string[];
  message?: string;
}

export interface LayerSummary {
  layer: Layer;
  nodeCount: number;
}

export interface LayerNodeListParams {
  type?: string;
  lifecycleStatus?: LifecycleStatus;
  limit?: number;
  offset?: number;
}

export interface NodeListParams {
  q?: string;
  type?: string;
  layer?: Layer;
  lifecycleStatus?: LifecycleStatus;
  limit?: number;
  offset?: number;
  sortBy?: string;
  order?: "asc" | "desc";
}

export interface EdgeListParams {
  q?: string;
  sourceId?: string;
  targetId?: string;
  type?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  order?: "asc" | "desc";
}

export interface HealthResponse {
  status: string;
  timestamp?: string;
}

export interface CreateNodePayload {
  type: string;
  layer: Layer;
  name: string;
  version?: string;
  lifecycleStatus?: LifecycleStatus;
  attributes?: Record<string, unknown>;
}

export interface UpdateNodePayload {
  name?: string;
  version?: string;
  attributes?: Record<string, unknown>;
}

export interface CreateEdgePayload {
  sourceId: string;
  targetId: string;
  type: string;
  layer: Layer;
  traversalWeight?: number;
  attributes?: Record<string, unknown>;
}

export interface UpdateEdgePayload {
  type?: string;
  traversalWeight?: number;
  attributes?: Record<string, unknown>;
}

type Params = Record<string, string | number | undefined>;

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  cache?: RequestCache;
  params?: Params;
  signal?: AbortSignal;
}

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
}

function getTenantId(): string {
  return process.env.NEXT_PUBLIC_TENANT_ID ?? "dev";
}

async function request<T>(
  path: string,
  opts: RequestOptions = {},
  requireTenant = true,
): Promise<T> {
  const { params, headers: extraHeaders = {}, ...rest } = opts;

  let url = `${getBaseUrl()}${path}`;
  if (params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  if (requireTenant) {
    headers["x-tenant-id"] = getTenantId();
  }

  const res = await fetch(url, { ...rest, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = Object.assign(new Error(`API ${res.status}: ${path}`), {
      status: res.status,
      body,
    });
    throw err;
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<HealthResponse>("/health", {}, false),

  nodes: {
    list: (params?: NodeListParams, fetchOpts?: { signal?: AbortSignal }) =>
      request<{ data: NodeRow[]; total: number }>("/v1/nodes", { params: params as Params, signal: fetchOpts?.signal }),
    get: (id: string) => request<{ data: NodeRow }>(`/v1/nodes/${id}`),
    create: (payload: CreateNodePayload) =>
      request<{ data: NodeRow }>("/v1/nodes", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    update: (id: string, payload: UpdateNodePayload) =>
      request<{ data: NodeRow }>(`/v1/nodes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    lifecycle: (id: string, transition: LifecycleTransition) =>
      request<{ data: NodeRow }>(`/v1/nodes/${id}/lifecycle`, {
        method: "PATCH",
        body: JSON.stringify({ transition }),
      }),
    batchLifecycle: (ids: string[], transition: LifecycleTransition) =>
      request<{ data: BatchLifecycleResult }>("/v1/nodes/batch-lifecycle", {
        method: "POST",
        body: JSON.stringify({ ids, transition }),
      }),
    history: (id: string, params?: { limit?: number; offset?: number }) =>
      request<{ data: NodeHistoryEntry[]; total: number }>(`/v1/nodes/${id}/history`, {
        params: params as Params,
      }),
  },

  edges: {
    list: (params?: EdgeListParams, fetchOpts?: { signal?: AbortSignal }) =>
      request<{ data: EdgeRow[]; total: number }>("/v1/edges", { params: params as Params, signal: fetchOpts?.signal }),
    get: (id: string) => request<{ data: EdgeRow }>(`/v1/edges/${id}`),
    create: (payload: CreateEdgePayload) =>
      request<{ data: EdgeRow }>("/v1/edges", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    update: (id: string, payload: UpdateEdgePayload) =>
      request<{ data: EdgeRow }>(`/v1/edges/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    lifecycle: (id: string, transition: LifecycleTransition) =>
      request<{ data: EdgeRow }>(`/v1/edges/${id}/lifecycle`, {
        method: "PATCH",
        body: JSON.stringify({ transition }),
      }),
  },

  layers: {
    list: () => request<{ data: LayerSummary[] }>("/v1/layers"),
    getNodes: (layer: Layer, params?: LayerNodeListParams) =>
      request<{ data: NodeRow[] }>(`/v1/layers/${layer}`, { params: params as Params }),
  },

  violations: {
    list: (params?: ViolationListParams) =>
      request<{ data: ViolationRow[] }>("/v1/violations", {
        params: {
          nodeId: params?.nodeId,
          ruleKey: params?.ruleKey,
          resolved: params?.resolved !== undefined ? String(params.resolved) : undefined,
          limit: params?.limit,
          offset: params?.offset,
        },
      }),
    get: (id: string) => request<{ data: ViolationRow }>(`/v1/violations/${id}`),
    resolve: (id: string) =>
      request<{ data: ViolationRow }>(`/v1/violations/${id}/resolve`, { method: "POST" }),
    batchResolve: (ids: string[]) =>
      request<{ data: BatchResolveResult }>("/v1/violations/batch-resolve", {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
  },
};
