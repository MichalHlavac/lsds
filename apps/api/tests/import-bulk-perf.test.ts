// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Performance smoke — POST /v1/import/bulk at 1k and 5k node batch sizes.
// (LSDS-567)
//
// The endpoint is capped at 500 items per call (schema hard limit), so large
// batches are split into sequential sub-requests. P50 and P99 are computed
// across per-call latencies; wall time covers the full batch set.
//
// Acceptance: P99 per-call ≤ 5,000 ms at both 1k and 5k node scales.
// Runs against DATABASE_URL (real Postgres, same as CI / Docker Compose).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app.js";
import { sql } from "../src/db/client.js";
import { cleanTenant } from "./test-helpers.js";

// ── Config ────────────────────────────────────────────────────────────────────

const MAX_PER_CALL = 500; // schema hard cap (BulkImportSchema)
const P99_LIMIT_MS = 5_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

function makeNodes(count: number, prefix: string) {
  return Array.from({ length: count }, (_, i) => ({
    type: "Service",
    layer: "L4",
    name: `${prefix}-${i}`,
  }));
}

async function runImport(
  tid: string,
  nodes: ReturnType<typeof makeNodes>,
): Promise<{ batchLatencies: number[]; wallMs: number; totalCreated: number }> {
  const headers = { "content-type": "application/json", "x-tenant-id": tid };
  const batchLatencies: number[] = [];
  let totalCreated = 0;
  const wallStart = performance.now();

  for (let off = 0; off < nodes.length; off += MAX_PER_CALL) {
    const chunk = nodes.slice(off, off + MAX_PER_CALL);
    const t0 = performance.now();
    const res = await app.request("/v1/import/bulk", {
      method: "POST",
      headers,
      body: JSON.stringify({ nodes: chunk }),
    });
    batchLatencies.push(performance.now() - t0);

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { created: { nodes: string[]; edges: string[] } };
    };
    totalCreated += body.data.created.nodes.length;
  }

  return { batchLatencies, wallMs: performance.now() - wallStart, totalCreated };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /v1/import/bulk — performance smoke", () => {
  let tid1k: string;
  let tid5k: string;

  beforeAll(() => {
    tid1k = randomUUID();
    tid5k = randomUUID();
  });

  afterAll(async () => {
    await cleanTenant(sql, tid1k);
    await cleanTenant(sql, tid5k);
  }, 60_000);

  it(
    "1,000 nodes (2 × 500 batches): all nodes created, P99 ≤ 5s",
    async () => {
      const nodes = makeNodes(1_000, `perf-1k-${Date.now()}`);
      const { batchLatencies, wallMs, totalCreated } = await runImport(tid1k, nodes);

      expect(totalCreated).toBe(1_000);

      const sorted = [...batchLatencies].sort((a, b) => a - b);
      const p50 = percentile(sorted, 50);
      const p99 = percentile(sorted, 99);

      console.log(
        `[perf] 1k nodes — batches: ${batchLatencies.length}, ` +
          `P50: ${p50.toFixed(0)} ms, P99: ${p99.toFixed(0)} ms, wall: ${wallMs.toFixed(0)} ms`,
      );

      expect(p99).toBeLessThan(P99_LIMIT_MS);
    },
    60_000,
  );

  it(
    "5,000 nodes (10 × 500 batches): all nodes created, P99 ≤ 5s",
    async () => {
      const nodes = makeNodes(5_000, `perf-5k-${Date.now()}`);
      const { batchLatencies, wallMs, totalCreated } = await runImport(tid5k, nodes);

      expect(totalCreated).toBe(5_000);

      const sorted = [...batchLatencies].sort((a, b) => a - b);
      const p50 = percentile(sorted, 50);
      const p99 = percentile(sorted, 99);

      console.log(
        `[perf] 5k nodes — batches: ${batchLatencies.length}, ` +
          `P50: ${p50.toFixed(0)} ms, P99: ${p99.toFixed(0)} ms, wall: ${wallMs.toFixed(0)} ms`,
      );

      expect(p99).toBeLessThan(P99_LIMIT_MS);
    },
    120_000,
  );
});
