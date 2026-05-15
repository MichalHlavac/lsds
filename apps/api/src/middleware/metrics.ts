// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { createMiddleware } from "hono/factory";

const RESERVOIR_SIZE = 1000;

interface RouteMetrics {
  method: string;
  path: string;
  requests: number;
  errors4xx: number;
  errors5xx: number;
  latencies: number[];
}

const store = new Map<string, RouteMetrics>();

export interface RouteMetricsSnapshot {
  method: string;
  path: string;
  requests: number;
  errors4xx: number;
  errors5xx: number;
  latencyMs: { p50: number; p95: number; p99: number };
}

// Exported for unit testing.
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

export function getMetricsSnapshot(): RouteMetricsSnapshot[] {
  return Array.from(store.values()).map(({ method, path, requests, errors4xx, errors5xx, latencies }) => {
    const sorted = [...latencies].sort((a, b) => a - b);
    return {
      method,
      path,
      requests,
      errors4xx,
      errors5xx,
      latencyMs: {
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
      },
    };
  });
}

// Exported so tests can reset state between runs.
export function resetMetrics(): void {
  store.clear();
}

export const metricsMiddleware = createMiddleware(async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;

  const method = c.req.method;
  // Use the matched route pattern when available so /v1/nodes/abc and /v1/nodes/xyz
  // are grouped under /v1/nodes/:id rather than creating a unique key per request.
  const path = c.req.routePath ?? c.req.path;
  const status = c.res.status;

  const key = `${method}:${path}`;
  let m = store.get(key);
  if (!m) {
    m = { method, path, requests: 0, errors4xx: 0, errors5xx: 0, latencies: [] };
    store.set(key, m);
  }

  m.requests++;
  if (status >= 400 && status < 500) m.errors4xx++;
  else if (status >= 500) m.errors5xx++;

  if (m.latencies.length >= RESERVOIR_SIZE) m.latencies.shift();
  m.latencies.push(duration);
});
