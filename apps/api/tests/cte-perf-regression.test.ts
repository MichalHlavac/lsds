// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Regression guard — CTE traversal query performance (LSDS-644).
// (LSDS-669)
//
// Measures p50 and p95 latency for outbound, inbound, and edge-type-filtered
// CTE traversals across a fixed 1,000-node / 5,000-edge deterministic graph.
// Asserts that measured percentiles do not exceed the committed baseline by
// more than 20%.
//
// Baseline: tests/fixtures/cte-perf-baseline.json — commit after each
// intentional query-layer change. To retune locally:
//   VITEST_UPDATE_BASELINE=1 pnpm test --reporter=verbose
// then commit the updated fixture.
//
// Graph topology: 5-ary balanced spanning tree (999 edges) + deterministic
// cross-links to reach 5,000 edges total. Same construction as traversal-perf
// (LSDS-128) but at 10× smaller scale for a fast CI regression guard.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { PostgresTraversalAdapter } from "../src/db/traversal-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, "fixtures/cte-perf-baseline.json");
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://lsds:lsds@localhost:5432/lsds";

// ── Config ────────────────────────────────────────────────────────────────────

const NODE_COUNT = 1_000;
const EDGE_COUNT = 5_000;
// 25 iterations gives stable percentiles on shared GH Actions runners; warm-up
// pass below flushes cold-cache spikes before measurement begins (LSDS-736).
const ITERATIONS = 25;
const WARMUP_ITERATIONS = 5;
// Regression threshold: measured ≤ baseline * TOLERANCE passes.
const TOLERANCE = 1.2;

const UPDATE_MODE = process.env.VITEST_UPDATE_BASELINE === "1";

// ── State ─────────────────────────────────────────────────────────────────────

let sql: Sql;
let tenantId: string;
let nodeIds: string[] = [];

interface ScenarioBaseline {
  p50_ms: number;
  p95_ms: number;
}
interface Baseline {
  outbound_d4: ScenarioBaseline;
  inbound_d4: ScenarioBaseline;
  filtered_outbound_d3: ScenarioBaseline;
  [key: string]: unknown;
}

let baseline: Baseline;
const measurements: Partial<Baseline> = {};

// ── Helpers ───────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

async function measureTraversal(
  adapter: PostgresTraversalAdapter,
  nodeId: string,
  depth: number,
  direction: "outbound" | "inbound" | "both",
  edgeTypes?: string[],
): Promise<ScenarioBaseline> {
  // Warm-up: flush cold-cache and planner overhead before recording latencies.
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    await adapter.traverseWithDepth(nodeId, depth, direction, edgeTypes);
  }
  const latencies: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    await adapter.traverseWithDepth(nodeId, depth, direction, edgeTypes);
    latencies.push(performance.now() - t0);
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    p50_ms: percentile(sorted, 50),
    p95_ms: percentile(sorted, 95),
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  baseline = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Baseline;

  sql = postgres(DATABASE_URL, { max: 5 });
  tenantId = randomUUID();

  // Seed nodes: 1,000 across L2/L3/L4 in 500-row batches.
  const layers = ["L2", "L3", "L4"] as const;
  const BATCH = 500;
  for (let off = 0; off < NODE_COUNT; off += BATCH) {
    const chunk = Array.from({ length: Math.min(BATCH, NODE_COUNT - off) }, (_, j) => ({
      tenant_id: tenantId,
      type: "Service",
      layer: layers[(off + j) % layers.length] as string,
      name: `perf-${off + j}`,
    }));
    const rows = await sql<{ id: string }[]>`
      INSERT INTO nodes ${sql(chunk, "tenant_id", "type", "layer", "name")}
      RETURNING id
    `;
    for (const r of rows) nodeIds.push(r.id);
  }

  // Seed edges: deterministic 5-ary spanning tree (999 edges) + cross-links.
  type EdgeRow = { tenant_id: string; source_id: string; target_id: string; type: string; layer: string };
  const edgeRows: EdgeRow[] = [];
  const push = (si: number, ti: number, type: string, layer: string) => {
    edgeRows.push({
      tenant_id: tenantId,
      source_id: nodeIds[si]!,
      target_id: nodeIds[ti]!,
      type,
      layer,
    });
  };

  // Spanning tree: node i's parent = floor((i-1)/5).
  for (let i = 1; i < nodeIds.length; i++) {
    push(Math.floor((i - 1) / 5), i, "contains", "L3");
  }

  // Deterministic cross-links to reach EDGE_COUNT.
  const remaining = EDGE_COUNT - edgeRows.length;
  for (let k = 0; k < remaining; k++) {
    const si = 1 + (k % (nodeIds.length - 1));
    const ti = (si * 7 + k * 13) % nodeIds.length;
    if (si !== ti) push(si, ti, "depends-on", "L4");
  }

  for (let off = 0; off < edgeRows.length; off += BATCH) {
    await sql`
      INSERT INTO edges ${sql(edgeRows.slice(off, off + BATCH), "tenant_id", "source_id", "target_id", "type", "layer")}
    `;
  }
}, 60_000);

afterAll(async () => {
  if (tenantId && sql) {
    await sql`DELETE FROM violations WHERE tenant_id = ${tenantId}`;
    await sql`DELETE FROM nodes WHERE tenant_id = ${tenantId}`;
  }
  if (UPDATE_MODE && Object.keys(measurements).length > 0) {
    const updated = { ...baseline, ...measurements };
    writeFileSync(FIXTURE_PATH, JSON.stringify(updated, null, 2) + "\n", "utf8");
    console.log(`[perf:regression] baseline updated → ${FIXTURE_PATH}`);
  }
  await sql?.end();
}, 30_000);

// ── Tests ─────────────────────────────────────────────────────────────────────

// Depth-3 interior node of a 5-ary tree: index 31 (sum of 5^0 + 5^1 + 5^2).
// Has 5 children and bounded reachable set — good regression target.
const interiorIdx = 31;

describe("CTE traversal — regression guard (LSDS-644)", () => {
  it(
    "outbound CTE (depth 4): p50 and p95 within ±20% of baseline",
    async () => {
      const adapter = new PostgresTraversalAdapter(sql, tenantId);
      const startId = nodeIds[interiorIdx]!;

      const m = await measureTraversal(adapter, startId, 4, "outbound");

      console.log(
        `[perf:regression] outbound d=4: p50=${m.p50_ms.toFixed(0)}ms p95=${m.p95_ms.toFixed(0)}ms` +
          ` (baseline p50=${baseline.outbound_d4.p50_ms}ms p95=${baseline.outbound_d4.p95_ms}ms)`,
      );

      if (UPDATE_MODE) {
        measurements.outbound_d4 = { p50_ms: Math.ceil(m.p50_ms), p95_ms: Math.ceil(m.p95_ms) };
        return;
      }

      expect(m.p50_ms).toBeLessThanOrEqual(baseline.outbound_d4.p50_ms * TOLERANCE);
      expect(m.p95_ms).toBeLessThanOrEqual(baseline.outbound_d4.p95_ms * TOLERANCE);
    },
    120_000,
  );

  it(
    "inbound CTE (depth 4): p50 and p95 within ±20% of baseline",
    async () => {
      const adapter = new PostgresTraversalAdapter(sql, tenantId);
      // Last node in the seeded list — deep leaf in the 5-ary tree.
      const leafId = nodeIds[nodeIds.length - 1]!;

      const m = await measureTraversal(adapter, leafId, 4, "inbound");

      console.log(
        `[perf:regression] inbound d=4: p50=${m.p50_ms.toFixed(0)}ms p95=${m.p95_ms.toFixed(0)}ms` +
          ` (baseline p50=${baseline.inbound_d4.p50_ms}ms p95=${baseline.inbound_d4.p95_ms}ms)`,
      );

      if (UPDATE_MODE) {
        measurements.inbound_d4 = { p50_ms: Math.ceil(m.p50_ms), p95_ms: Math.ceil(m.p95_ms) };
        return;
      }

      expect(m.p50_ms).toBeLessThanOrEqual(baseline.inbound_d4.p50_ms * TOLERANCE);
      expect(m.p95_ms).toBeLessThanOrEqual(baseline.inbound_d4.p95_ms * TOLERANCE);
    },
    120_000,
  );

  it(
    "filtered outbound CTE (depth 3, edge-type 'contains'): p50 and p95 within ±20% of baseline",
    async () => {
      const adapter = new PostgresTraversalAdapter(sql, tenantId);
      // Root (index 0): all 'contains' edges flow outward from here.
      const rootId = nodeIds[0]!;

      const m = await measureTraversal(adapter, rootId, 3, "outbound", ["contains"]);

      // Root → 5 children → 25 grandchildren → 125 great-grandchildren = 156 nodes total.
      console.log(
        `[perf:regression] filtered(contains) outbound d=3: p50=${m.p50_ms.toFixed(0)}ms p95=${m.p95_ms.toFixed(0)}ms` +
          ` (baseline p50=${baseline.filtered_outbound_d3.p50_ms}ms p95=${baseline.filtered_outbound_d3.p95_ms}ms)`,
      );

      if (UPDATE_MODE) {
        measurements.filtered_outbound_d3 = { p50_ms: Math.ceil(m.p50_ms), p95_ms: Math.ceil(m.p95_ms) };
        return;
      }

      expect(m.p50_ms).toBeLessThanOrEqual(baseline.filtered_outbound_d3.p50_ms * TOLERANCE);
      expect(m.p95_ms).toBeLessThanOrEqual(baseline.filtered_outbound_d3.p95_ms * TOLERANCE);
    },
    120_000,
  );
});
