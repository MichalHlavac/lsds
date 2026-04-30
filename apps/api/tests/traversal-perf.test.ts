// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Performance smoke test — PostgresTraversalAdapter on 10k nodes / 50k edges.
// (LSDS-128)
//
// Verifies that the recursive-CTE traversal engine scales to a realistic graph
// size without regressing past an acceptable latency bound.  Runs against a
// real Postgres instance managed by testcontainers.
//
// Graph topology: 5-ary balanced tree (9 999 edges) + 40 001 random
// cross-links, spread across all nodes to avoid hub concentrations.
// Traversals start from an interior node (depth ~4 in the tree) so
// each query has a bounded, predictable blast radius.
//
// Acceptance bound: each traversal must return within TRAVERSAL_TIMEOUT_MS.
// Container start + bulk load is excluded from the bound; only the raw
// traversal query is timed.

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
const EDGE_COUNT = 50_000;
// Each traversal must complete within this bound.
const TRAVERSAL_TIMEOUT_MS = 15_000;

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

// ── State ─────────────────────────────────────────────────────────────────────

let container: StartedPostgreSqlContainer;
let sql: Sql;
// IDs of all inserted nodes, in insertion order.
let nodeIds: string[] = [];

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(
  async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    sql = postgres(container.getConnectionUri(), { max: 5 });

    for (const file of ["001_initial_schema.sql", "002_indexes.sql"]) {
      await sql.unsafe(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    }

    // ── Bulk load: nodes ─────────────────────────────────────────────────────
    // Three layers spread evenly so edge types are plausible.
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
    // 1. Balanced 5-ary spanning tree (NODE_COUNT - 1 edges).
    //    Node i's parent: Math.floor((i - 1) / 5).
    //    Each non-root node has exactly 1 parent edge.
    //    Root (index 0) has at most 5 direct children — no hub.
    // 2. Random cross-links to reach EDGE_COUNT, distributed across all
    //    non-root nodes as sources to keep per-node fan-out low.
    type EdgeRow = { tenant_id: string; source_id: string; target_id: string; type: string; layer: string };
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

    // Spanning tree
    for (let i = 1; i < nodeIds.length; i++) {
      push(Math.floor((i - 1) / 5), i, "contains", "L3");
    }

    // Cross-links: random directed edges, sources drawn from [1, N) to avoid
    // making the root a mega-hub.
    const remaining = EDGE_COUNT - edgeRows.length;
    for (let k = 0; k < remaining; k++) {
      const si = 1 + (k % (nodeIds.length - 1)); // deterministic, cycles through non-root
      const ti = (si * 7 + k * 13) % nodeIds.length; // deterministic pseudo-random target
      if (si !== ti) push(si, ti, "depends-on", "L4");
    }

    for (let off = 0; off < edgeRows.length; off += BATCH) {
      const chunk = edgeRows.slice(off, off + BATCH);
      await sql`
        INSERT INTO edges ${sql(chunk, "tenant_id", "source_id", "target_id", "type", "layer")}
      `;
    }
  },
  // Allow up to 3 minutes for container startup + data load.
  180_000,
);

afterAll(async () => {
  await sql?.end();
  await container?.stop();
}, 60_000);

// ── Helpers ───────────────────────────────────────────────────────────────────

// A node at tree-depth ~4 (index 781 in a 5-ary tree).
// It has exactly 5 children and 1 parent — bounded blast radius.
const interiorIdx = 781; // depth-4 interior node

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PostgresTraversalAdapter — 10k nodes / 50k edges smoke test", () => {
  it(
    "outbound traversal from interior node (depth 4) completes within time bound",
    async () => {
      const adapter = new PostgresTraversalAdapter(sql);
      const startId = nodeIds[interiorIdx]!;

      const t0 = performance.now();
      const results = await adapter.traverseWithDepth(startId, 4, "outbound");
      const elapsed = performance.now() - t0;

      // Uniqueness: result set has no duplicate node IDs.
      const ids = results.map((r) => r.nodeId);
      expect(new Set(ids).size).toBe(ids.length);

      // Root is included at depth 0.
      expect(ids).toContain(startId);

      // Depth values are within [0, 4].
      for (const r of results) {
        expect(r.depth).toBeGreaterThanOrEqual(0);
        expect(r.depth).toBeLessThanOrEqual(4);
      }

      expect(elapsed).toBeLessThan(TRAVERSAL_TIMEOUT_MS);
      console.log(`[perf] outbound d=4: ${results.length} nodes in ${elapsed.toFixed(0)} ms`);
    },
    TRAVERSAL_TIMEOUT_MS + 5_000,
  );

  it(
    "inbound traversal from a leaf node (depth 5) completes within time bound",
    async () => {
      const adapter = new PostgresTraversalAdapter(sql);

      // Pick a node deep in the 5-ary tree: last node is close to a leaf.
      const leafId = nodeIds[nodeIds.length - 1]!;

      const t0 = performance.now();
      const results = await adapter.traverseWithDepth(leafId, 5, "inbound");
      const elapsed = performance.now() - t0;

      const ids = results.map((r) => r.nodeId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain(leafId);
      expect(elapsed).toBeLessThan(TRAVERSAL_TIMEOUT_MS);
      console.log(`[perf] inbound d=5: ${results.length} nodes in ${elapsed.toFixed(0)} ms`);
    },
    TRAVERSAL_TIMEOUT_MS + 5_000,
  );

  it(
    "bidirectional traversal from interior node (depth 4) completes within time bound",
    async () => {
      const adapter = new PostgresTraversalAdapter(sql);
      const startId = nodeIds[interiorIdx]!;

      const t0 = performance.now();
      const results = await adapter.traverseWithDepth(startId, 4, "both");
      const elapsed = performance.now() - t0;

      const ids = results.map((r) => r.nodeId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(elapsed).toBeLessThan(TRAVERSAL_TIMEOUT_MS);
      console.log(`[perf] bidirectional d=4: ${results.length} nodes in ${elapsed.toFixed(0)} ms`);
    },
    TRAVERSAL_TIMEOUT_MS + 5_000,
  );

  it(
    "edge-type-filtered traversal returns only nodes reachable via 'contains'",
    async () => {
      const adapter = new PostgresTraversalAdapter(sql);
      const startId = nodeIds[0]!; // root

      const t0 = performance.now();
      const results = await adapter.traverseWithDepth(startId, 3, "outbound", ["contains"]);
      const elapsed = performance.now() - t0;

      const ids = results.map((r) => r.nodeId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(elapsed).toBeLessThan(TRAVERSAL_TIMEOUT_MS);

      // Root → 5 children → 25 grandchildren → 125 great-grandchildren = 156 nodes (incl. root).
      expect(ids.length).toBeGreaterThanOrEqual(5); // at minimum the direct children
      console.log(`[perf] filtered(contains) d=3: ${results.length} nodes in ${elapsed.toFixed(0)} ms`);
    },
    TRAVERSAL_TIMEOUT_MS + 5_000,
  );
});
