// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant } from "./test-helpers";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

beforeEach(() => {
  tid = randomUUID();
});
afterEach(async () => {
  await cleanTenant(sql, tid);
});

// ── POST /v1/import/bulk ──────────────────────────────────────────────────────

describe("POST /v1/import/bulk — positive: 10 nodes + 5 edges atomic", () => {
  it("creates 10 nodes and 5 edges in a single transaction and returns created IDs", async () => {
    // Step 1: create 10 anchor nodes via separate call so we have their UUIDs for edges
    const anchorIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await app.request("/v1/nodes", {
        method: "POST",
        headers: h(),
        body: JSON.stringify({ type: "Service", layer: "L4", name: `anchor-${i}` }),
      });
      expect(res.status).toBe(201);
      const { data } = await res.json();
      anchorIds.push(data.id);
    }

    // Step 2: bulk import 10 new nodes + 5 edges between anchor nodes
    const bulkNodes = Array.from({ length: 10 }, (_, i) => ({
      type: "Service",
      layer: "L4",
      name: `bulk-svc-${i}`,
    }));

    const bulkEdges = Array.from({ length: 5 }, (_, i) => ({
      sourceId: anchorIds[i * 2],
      targetId: anchorIds[i * 2 + 1],
      type: "depends-on",
      layer: "L4",
    }));

    const res = await app.request("/v1/import/bulk", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ nodes: bulkNodes, edges: bulkEdges }),
    });

    expect(res.status).toBe(201);
    const { data } = await res.json();

    expect(data.created.nodes).toHaveLength(10);
    expect(data.created.edges).toHaveLength(5);
    expect(data.errors).toHaveLength(0);

    // All IDs are valid UUIDs
    for (const id of data.created.nodes) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }

    // Verify actual DB row count
    const [{ count: nodeCount }] = await sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM nodes WHERE tenant_id = ${tid} AND name LIKE 'bulk-svc-%'
    `;
    const [{ count: edgeCount }] = await sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM edges WHERE tenant_id = ${tid}
    `;
    expect(Number(nodeCount)).toBe(10);
    expect(Number(edgeCount)).toBe(5);
  });
});

describe("POST /v1/import/bulk — positive: nodes only (no edges)", () => {
  it("creates nodes without edges", async () => {
    const res = await app.request("/v1/import/bulk", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        nodes: [
          { type: "BoundedContext", layer: "L2", name: "billing-context" },
          { type: "BoundedContext", layer: "L2", name: "shipping-context" },
        ],
      }),
    });

    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.created.nodes).toHaveLength(2);
    expect(data.created.edges).toHaveLength(0);
  });
});

describe("POST /v1/import/bulk — negative: rollback on duplicate node", () => {
  it("rolls back all changes when a duplicate node is in the batch", async () => {
    // Pre-create a node to cause a duplicate
    const preRes = await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "existing-svc" }),
    });
    expect(preRes.status).toBe(201);

    // Bulk import with a duplicate and a new node
    const res = await app.request("/v1/import/bulk", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        nodes: [
          { type: "Service", layer: "L4", name: "should-not-exist" }, // new, would succeed alone
          { type: "Service", layer: "L4", name: "existing-svc" },      // duplicate → 23505
        ],
      }),
    });

    expect(res.status).toBe(409);

    // Verify no partial writes — "should-not-exist" must NOT be in DB
    const [{ count }] = await sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM nodes
      WHERE tenant_id = ${tid} AND name = 'should-not-exist'
    `;
    expect(Number(count)).toBe(0);
  });
});

describe("POST /v1/import/bulk — negative: rollback on missing source node", () => {
  it("rolls back all changes when an edge references a non-existent node", async () => {
    const res = await app.request("/v1/import/bulk", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        nodes: [{ type: "Service", layer: "L4", name: "orphaned-svc" }],
        edges: [
          {
            sourceId: "00000000-0000-0000-0000-000000000099", // does not exist
            targetId: "00000000-0000-0000-0000-000000000098",
            type: "depends-on",
            layer: "L4",
          },
        ],
      }),
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain("source node not found");

    // Node should have been rolled back too
    const [{ count }] = await sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM nodes
      WHERE tenant_id = ${tid} AND name = 'orphaned-svc'
    `;
    expect(Number(count)).toBe(0);
  });
});

describe("POST /v1/import/bulk — oversized batch returns 400 before DB hit", () => {
  it("rejects a payload with 501 nodes with status 400", async () => {
    const nodes = Array.from({ length: 501 }, (_, i) => ({
      type: "Service",
      layer: "L4",
      name: `svc-${i}`,
    }));

    const res = await app.request("/v1/import/bulk", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ nodes }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("validation error");

    // No rows should have been written
    const [{ count }] = await sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM nodes WHERE tenant_id = ${tid}
    `;
    expect(Number(count)).toBe(0);
  });

  it("rejects when nodes (300) + edges (201) exceeds 500", async () => {
    const nodes = Array.from({ length: 300 }, (_, i) => ({
      type: "Service",
      layer: "L4",
      name: `svc-${i}`,
    }));
    const edges = Array.from({ length: 201 }, (_, i) => ({
      sourceId: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
      targetId: `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
      type: "depends-on",
      layer: "L4",
    }));

    const res = await app.request("/v1/import/bulk", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ nodes, edges }),
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /v1/import/bulk — history records created inside transaction", () => {
  it("records CREATE history for each node in the batch", async () => {
    const res = await app.request("/v1/import/bulk", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        nodes: [
          { type: "Service", layer: "L4", name: "hist-svc-a" },
          { type: "Service", layer: "L4", name: "hist-svc-b" },
        ],
      }),
    });

    expect(res.status).toBe(201);
    const { data } = await res.json();

    for (const nodeId of data.created.nodes) {
      const rows = await sql`
        SELECT op FROM node_history WHERE node_id = ${nodeId} AND tenant_id = ${tid}
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0].op).toBe("CREATE");
    }
  });
});
