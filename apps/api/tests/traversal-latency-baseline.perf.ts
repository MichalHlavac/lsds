// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// @perf — Traversal latency baseline on a deterministic 10k-node / ~15k-edge graph.
// (LSDS-1115)
//
// Purpose: catch catastrophic regressions (N+1 queries, missing indices) before
// they reach production. Not a sub-millisecond benchmark — the budget is soft.
//
// Graph topology:
//   10 000 nodes across layers L2/L3/L4
//   9 999 spanning-tree edges (5-ary balanced tree, type "contains", layer L3)
//   5 001 cross-links (type "depends-on", layer L4, deterministic pseudo-random)
//   Total: ~15 000 edges
//
// Each test runs SAMPLE_COUNT depth-3 outbound BFS traversals from distinct
// interior nodes, records per-traversal latency, and asserts P95 < 2 000 ms.
// Median and P95 are printed to stdout for future baseline comparison.
//
// Isolation: a fresh testcontainers PostgreSQL 16 instance per run.
// Seed + teardown are fully contained — no shared-Postgres side effects.
//
// Opt-in only — excluded from the default `pnpm test` run.
// Invoke with:  pnpm --filter @lsds/api test:perf
//           or: pnpm test:perf  (from workspace root)

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgresTraversalAdapter } from "../src/db/traversal-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "../migrations");

// ── Config ────────────────────────────────────────────────────────────────────

const NODE_COUNT = 10_000;
const TREE_EDGES = NODE_COUNT - 1; // 9 999 — 5-ary spanning tree
const CROSS_LINKS = 5_001; // deterministic cross-links → ~15 000 total
const TRAVERSAL_DEPTH = 3;
const SAMPLE_COUNT = 20;
const P95_LIMIT_MS = 2_000;
const TENANT_ID = "00000000-0000-0000-0000-000000000002";

// ── State ─────────────────────────────────────────────────────────────────────

let container: StartedPostgreSqlContainer;
let sql: Sql;
let nodeIds: string[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(
  async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    sql = postgres(container.getConnectionUri(), { max: 5 });

    for (const file of ["001_initial_schema.sql", "002_indexes.sql"]) {
      await sql.unsafe(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    }

    // ── Bulk load: nodes ─────────────────────────────────────────────────────
    const layers = ["L2", "L3", "L4"] as const;
    const BATCH = 1_000;

    for (let off = 0; off < NODE_COUNT; off += BATCH) {
      const chunk = Array.from({ length: Math.min(BATCH, NODE_COUNT - off) }, (_, j) => ({
        tenant_id: TENANT_ID,
        type: "Service",
        layer: layers[(off + j) % layers.length] as string,
        name: `node-${off + j}`,
      }));
      const rows = await sql<{ id: string }[]>`
        INSERT INTO nodes ${sql(chunk, "tenant_id", "type", "layer", "name")}
        RETURNING id
      `;
      for (const r of rows) nodeIds.push(r.id);
    }

    // ── Bulk load: edges ─────────────────────────────────────────────────────
    // 5-ary spanning tree: node i → parent floor((i-1)/5), type "contains"
    // Cross-links: deterministic pseudo-random "depends-on" edges spread across
    // all non-root nodes to keep per-node fan-out low and avoid hub concentration.
    type EdgeRow = {
      tenant_id: string;
      source_id: string;
      target_id: string;
      type: string;
      layer: string;
    };
    const edgeRows: EdgeRow[] = [];

    const push = (si: number, ti: number, type: string, layer: string) => {
      edgeRows.push({
        tenant_id: TENANT_ID,
        source_id: nodeIds[si]!,
        target_id: nodeIds[ti]!,
        type,
        layer,
      });
    };

    // Spanning tree (9 999 edges)
    for (let i = 1; i < nodeIds.length; i++) {
      push(Math.floor((i - 1) / 5), i, "contains", "L3");
    }

    // Cross-links (~5 001 edges — skips self-loops)
    let crossLinksAdded = 0;
    for (let k = 0; crossLinksAdded < CROSS_LINKS; k++) {
      const si = 1 + (k % (nodeIds.length - 1));
      const ti = (si * 7 + k * 13) % nodeIds.length;
      if (si !== ti) {
        push(si, ti, "depends-on", "L4");
        crossLinksAdded++;
      }
    }

    for (let off = 0; off < edgeRows.length; off += BATCH) {
      const chunk = edgeRows.slice(off, off + BATCH);
      await sql`
        INSERT INTO edges ${sql(chunk, "tenant_id", "source_id", "target_id", "type", "layer")}
      `;
    }
  },
  // Container start + bulk load budget
  180_000,
);

afterAll(async () => {
  await sql?.end();
  await container?.stop();
}, 60_000);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("@perf traversal latency baseline — 10k nodes / ~15k edges", () => {
  it(
    "depth-3 outbound BFS from 20 interior nodes: P95 < 2 000 ms; records median and P95",
    async () => {
      // Sample 20 interior nodes evenly distributed between tree-depth-4 and
      // tree-depth-7 (indices 156–1999 in a 5-ary tree with 10k nodes).
      // All have children in the tree → bounded depth-3 blast radius.
      const sampleIndices = Array.from(
        { length: SAMPLE_COUNT },
        (_, i) => 156 + Math.round((i * (1999 - 156)) / (SAMPLE_COUNT - 1)),
      );

      const latencies: number[] = [];

      for (const idx of sampleIndices) {
        const rootId = nodeIds[idx]!;
        const adapter = new PostgresTraversalAdapter(sql, TENANT_ID);

        const t0 = performance.now();
        const results = await adapter.traverseWithDepth(rootId, TRAVERSAL_DEPTH, "outbound");
        const elapsed = performance.now() - t0;

        latencies.push(elapsed);

        // Structural invariants per traversal
        const ids = results.map((r) => r.nodeId);
        expect(new Set(ids).size, `duplicate nodeIds at sample index ${idx}`).toBe(ids.length);
        expect(ids, `root missing from results at sample index ${idx}`).toContain(rootId);
        for (const r of results) {
          expect(r.depth, `depth out of bound at sample index ${idx}`).toBeGreaterThanOrEqual(0);
          expect(r.depth, `depth out of bound at sample index ${idx}`).toBeLessThanOrEqual(
            TRAVERSAL_DEPTH,
          );
        }
      }

      const sorted = [...latencies].sort((a, b) => a - b);
      const p50 = percentile(sorted, 50);
      const p95 = percentile(sorted, 95);

      console.log(
        `[perf] depth-${TRAVERSAL_DEPTH} outbound BFS — samples: ${SAMPLE_COUNT}, ` +
          `median: ${p50.toFixed(0)} ms, P95: ${p95.toFixed(0)} ms`,
      );

      expect(p95, `P95 traversal latency exceeded budget of ${P95_LIMIT_MS} ms`).toBeLessThan(
        P95_LIMIT_MS,
      );
    },
    // Each traversal budget × samples + margin
    60_000,
  );

  it(
    "depth-3 outbound BFS from tree root (contains-only filter): P95 < 2 000 ms; records median and P95",
    async () => {
      // Root at index 0 is the most predictable starting point for regression
      // detection: the 5-ary subtree at depth ≤ 3 is exactly 156 nodes, bounded.
      const rootId = nodeIds[0]!;
      const latencies: number[] = [];

      for (let i = 0; i < SAMPLE_COUNT; i++) {
        const adapter = new PostgresTraversalAdapter(sql, TENANT_ID);
        const t0 = performance.now();
        const results = await adapter.traverseWithDepth(rootId, TRAVERSAL_DEPTH, "outbound", [
          "contains",
        ]);
        const elapsed = performance.now() - t0;
        latencies.push(elapsed);

        const ids = results.map((r) => r.nodeId);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toContain(rootId);
        // 5-ary tree at depth ≤ 3: 1 + 5 + 25 + 125 = 156 nodes
        expect(ids.length).toBeGreaterThanOrEqual(5);
        expect(ids.length).toBeLessThanOrEqual(156);
      }

      const sorted = [...latencies].sort((a, b) => a - b);
      const p50 = percentile(sorted, 50);
      const p95 = percentile(sorted, 95);

      console.log(
        `[perf] depth-${TRAVERSAL_DEPTH} outbound BFS (contains-only) — samples: ${SAMPLE_COUNT}, ` +
          `median: ${p50.toFixed(0)} ms, P95: ${p95.toFixed(0)} ms`,
      );

      expect(p95, `P95 latency for filtered traversal exceeded ${P95_LIMIT_MS} ms`).toBeLessThan(
        P95_LIMIT_MS,
      );
    },
    60_000,
  );
});
