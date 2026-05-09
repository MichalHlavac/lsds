// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant } from "./test-helpers";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

const adminH = () => ({
  "content-type": "application/json",
  "x-tenant-id": tid,
  authorization: `Bearer ${process.env.LSDS_ADMIN_SECRET ?? "test-admin-secret"}`,
  "x-forwarded-for": tid,
});

beforeAll(() => {
  process.env.LSDS_ADMIN_SECRET = "test-admin-secret";
  process.env.LSDS_WEBHOOK_ENCRYPTION_KEY = "a".repeat(64);
});

beforeEach(() => { tid = randomUUID(); });
afterEach(async () => { await cleanTenant(sql, tid); });

// ── helpers ───────────────────────────────────────────────────────────────────

async function bulkImport(nodes: object[], edges: object[] = []) {
  return app.request("/v1/import/bulk", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ nodes, edges }),
  });
}

async function createNode(name: string, layer = "L4", type = "Service") {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ type, layer, name }),
  });
  return (await res.json()).data;
}

// ── positive cases ────────────────────────────────────────────────────────────

describe("POST /v1/import/bulk — positive: 10 nodes + 5 edges atomic", () => {
  it("creates 10 nodes and 5 edges and returns created IDs", async () => {
    const anchorIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const n = await createNode(`anchor-${i}`);
      anchorIds.push(n.id);
    }

    const res = await bulkImport(
      Array.from({ length: 10 }, (_, i) => ({ type: "Service", layer: "L4", name: `bulk-svc-${i}` })),
      Array.from({ length: 5 }, (_, i) => ({
        sourceId: anchorIds[i * 2], targetId: anchorIds[i * 2 + 1], type: "depends-on", layer: "L4",
      }))
    );

    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.created.nodes).toHaveLength(10);
    expect(data.created.edges).toHaveLength(5);
    expect(data.errors).toHaveLength(0);
    for (const id of data.created.nodes) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });
});

describe("POST /v1/import/bulk — positive: nodes only", () => {
  it("creates nodes without edges", async () => {
    const res = await bulkImport([
      { type: "BoundedContext", layer: "L2", name: "billing-context" },
      { type: "BoundedContext", layer: "L2", name: "shipping-context" },
    ]);
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.created.nodes).toHaveLength(2);
    expect(data.created.edges).toHaveLength(0);
  });
});

// ── negative / rollback ───────────────────────────────────────────────────────

describe("POST /v1/import/bulk — rollback on duplicate node", () => {
  it("rolls back all changes when a duplicate node is in the batch", async () => {
    await createNode("existing-svc");

    const res = await bulkImport([
      { type: "Service", layer: "L4", name: "should-not-exist" },
      { type: "Service", layer: "L4", name: "existing-svc" },
    ]);
    expect(res.status).toBe(409);

    const [{ count }] = await sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM nodes WHERE tenant_id = ${tid} AND name = 'should-not-exist'
    `;
    expect(Number(count)).toBe(0);
  });
});

describe("POST /v1/import/bulk — rollback on missing source node", () => {
  it("rolls back all changes when an edge references a non-existent node", async () => {
    const res = await bulkImport(
      [{ type: "Service", layer: "L4", name: "orphaned-svc" }],
      [{ sourceId: "00000000-0000-0000-0000-000000000099", targetId: "00000000-0000-0000-0000-000000000098", type: "depends-on", layer: "L4" }]
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("source node not found");

    const [{ count }] = await sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM nodes WHERE tenant_id = ${tid} AND name = 'orphaned-svc'
    `;
    expect(Number(count)).toBe(0);
  });
});

// ── 50k row cap ───────────────────────────────────────────────────────────────

describe("POST /v1/import/bulk — 50k row cap returns 422 before DB hit", () => {
  it("rejects 50,001 nodes with 422 and includes the observed total", async () => {
    const nodes = Array.from({ length: 50_001 }, (_, i) => ({
      type: "Service", layer: "L4", name: `svc-${i}`,
    }));
    const res = await bulkImport(nodes);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/50,000/);
    expect(body.total).toBe(50_001);

    const [{ count }] = await sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM nodes WHERE tenant_id = ${tid}
    `;
    expect(Number(count)).toBe(0);
  });

  it("rejects when nodes (40,000) + edges (10,001) exceeds 50,000", async () => {
    const nodes = Array.from({ length: 40_000 }, (_, i) => ({ type: "Service", layer: "L4", name: `s-${i}` }));
    const edges = Array.from({ length: 10_001 }, (_, i) => ({
      sourceId: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
      targetId: `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
      type: "depends-on", layer: "L4",
    }));
    const res = await bulkImport(nodes, edges);
    expect(res.status).toBe(422);
    expect((await res.json()).total).toBe(50_001);
  });
});

// ── history records ───────────────────────────────────────────────────────────

describe("POST /v1/import/bulk — history records created inside transaction", () => {
  it("records CREATE history for each node in the batch", async () => {
    const res = await bulkImport([
      { type: "Service", layer: "L4", name: "hist-svc-a" },
      { type: "Service", layer: "L4", name: "hist-svc-b" },
    ]);
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

// ── audit log invariants ──────────────────────────────────────────────────────

describe("POST /v1/import/bulk — audit log rows", () => {
  it("audit_log delta equals nodes.length + edges.length for the import", async () => {
    const anchor1 = await createNode("audit-anchor-1");
    const anchor2 = await createNode("audit-anchor-2");

    // Snapshot after anchor creates
    const [{ before }] = await sql<[{ before: string }]>`
      SELECT COUNT(*)::text AS before FROM audit_log WHERE tenant_id = ${tid}
    `;

    const res = await bulkImport(
      [{ type: "Service", layer: "L4", name: "audit-n1" }, { type: "Service", layer: "L4", name: "audit-n2" }],
      [{ sourceId: anchor1.id, targetId: anchor2.id, type: "depends-on", layer: "L4" }]
    );
    expect(res.status).toBe(201);

    const [{ after }] = await sql<[{ after: string }]>`
      SELECT COUNT(*)::text AS after FROM audit_log WHERE tenant_id = ${tid}
    `;
    // 2 bulk nodes + 1 bulk edge = 3 new audit rows
    expect(Number(after) - Number(before)).toBe(3);
  });

  it("mid-import failure leaves zero new audit rows and zero new node/edge rows", async () => {
    const [{ auditBefore }] = await sql<[{ auditBefore: string }]>`
      SELECT COUNT(*)::text AS audit_before FROM audit_log WHERE tenant_id = ${tid}
    `;
    const [{ nodeBefore }] = await sql<[{ nodeBefore: string }]>`
      SELECT COUNT(*)::text AS node_before FROM nodes WHERE tenant_id = ${tid}
    `;

    // Node creates audit row, then edge fails (missing source) → full rollback
    const res = await bulkImport(
      [{ type: "Service", layer: "L4", name: "will-be-rolled-back" }],
      [{ sourceId: "00000000-0000-0000-0000-000000000099", targetId: "00000000-0000-0000-0000-000000000098", type: "depends-on", layer: "L4" }]
    );
    expect(res.status).toBe(422);

    const [{ auditAfter }] = await sql<[{ auditAfter: string }]>`
      SELECT COUNT(*)::text AS audit_after FROM audit_log WHERE tenant_id = ${tid}
    `;
    const [{ nodeAfter }] = await sql<[{ nodeAfter: string }]>`
      SELECT COUNT(*)::text AS node_after FROM nodes WHERE tenant_id = ${tid}
    `;

    expect(Number(auditAfter)).toBe(Number(auditBefore));
    expect(Number(nodeAfter)).toBe(Number(nodeBefore));
  });
});

// ── import.completed webhook ──────────────────────────────────────────────────

describe("POST /v1/import/bulk — import.completed webhook", () => {
  it("fires exactly one import.completed delivery per successful import, not per row", async () => {
    const wRes = await app.request("/api/admin/webhooks", {
      method: "POST",
      headers: adminH(),
      body: JSON.stringify({ url: "https://example.com/hook", eventTypes: ["import.completed"] }),
    });
    expect(wRes.status).toBe(201);

    const res = await bulkImport([
      { type: "Service", layer: "L4", name: "wh-n1" },
      { type: "Service", layer: "L4", name: "wh-n2" },
      { type: "Service", layer: "L4", name: "wh-n3" },
    ]);
    expect(res.status).toBe(201);

    const [delivery] = await sql<[{ payload: Record<string, unknown> }]>`
      SELECT payload FROM webhook_deliveries
      WHERE tenant_id = ${tid} AND event_type = 'import.completed'
    `;
    expect(delivery).toBeDefined();
    expect(delivery.payload.event).toBe("import.completed");
    expect(delivery.payload.nodeCount).toBe(3);
    expect(delivery.payload.edgeCount).toBe(0);

    const [{ count }] = await sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM webhook_deliveries
      WHERE tenant_id = ${tid} AND event_type = 'import.completed'
    `;
    expect(Number(count)).toBe(1);
  });

  it("does not fire import.completed when no webhooks are subscribed", async () => {
    const res = await bulkImport([{ type: "Service", layer: "L4", name: "no-wh-node" }]);
    expect(res.status).toBe(201);

    const rows = await sql`SELECT id FROM webhook_deliveries WHERE tenant_id = ${tid}`;
    expect(rows).toHaveLength(0);
  });
});
