// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant } from "./test-helpers";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

beforeEach(() => { tid = randomUUID(); });
afterEach(async () => { await cleanTenant(sql, tid); });

// ── helpers ───────────────────────────────────────────────────────────────────

interface NdjsonNode {
  type: "node";
  id: string;
  layer: string;
  nodeType: string;
  name: string;
  version: string;
  lifecycleStatus: string;
  attributes: Record<string, unknown>;
  createdAt: string;
}

interface NdjsonEdge {
  type: "edge";
  id: string;
  sourceId: string;
  targetId: string;
  edgeType: string;
  layer: string;
  traversalWeight: number;
  lifecycleStatus: string;
  attributes: Record<string, unknown>;
  createdAt: string;
}

type NdjsonLine = NdjsonNode | NdjsonEdge;

async function exportTenant(params: Record<string, string> = {}): Promise<NdjsonLine[]> {
  const qs = new URLSearchParams(params).toString();
  const res = await app.request(`/v1/export${qs ? `?${qs}` : ""}`, { headers: h() });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/x-ndjson");
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as NdjsonLine);
}

async function createNode(name: string, opts: { layer?: string; type?: string; lifecycleStatus?: string } = {}) {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({
      type: opts.type ?? "Service",
      layer: opts.layer ?? "L4",
      name,
      ...(opts.lifecycleStatus ? { lifecycleStatus: opts.lifecycleStatus } : {}),
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).data as { id: string };
}

async function createEdge(sourceId: string, targetId: string, opts: { layer?: string; type?: string } = {}) {
  const res = await app.request("/v1/edges", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({
      sourceId,
      targetId,
      type: opts.type ?? "depends-on",
      layer: opts.layer ?? "L4",
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).data as { id: string };
}

// ── basic streaming ───────────────────────────────────────────────────────────

describe("GET /v1/export — NDJSON line count", () => {
  it("returns zero lines for an empty tenant", async () => {
    const lines = await exportTenant();
    expect(lines).toHaveLength(0);
  });

  it("returns one line per node plus one line per edge", async () => {
    const a = await createNode("svc-a");
    const b = await createNode("svc-b");
    const c = await createNode("svc-c");
    await createEdge(a.id, b.id);
    await createEdge(b.id, c.id);

    const lines = await exportTenant();
    const nodes = lines.filter((l) => l.type === "node");
    const edges = lines.filter((l) => l.type === "edge");
    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(2);
    expect(lines).toHaveLength(5);
  });

  it("includes correct field shapes for nodes and edges", async () => {
    const a = await createNode("shape-a");
    const b = await createNode("shape-b");
    await createEdge(a.id, b.id);

    const lines = await exportTenant();
    const nodeLine = lines.find((l) => l.type === "node" && (l as NdjsonNode).name === "shape-a") as NdjsonNode;
    const edgeLine = lines.find((l) => l.type === "edge") as NdjsonEdge;

    expect(nodeLine.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(nodeLine.layer).toBe("L4");
    expect(nodeLine.nodeType).toBe("Service");
    expect(nodeLine.lifecycleStatus).toBe("ACTIVE");
    expect(typeof nodeLine.createdAt).toBe("string");

    expect(edgeLine.sourceId).toBe(a.id);
    expect(edgeLine.targetId).toBe(b.id);
    expect(edgeLine.edgeType).toBe("depends-on");
    expect(edgeLine.traversalWeight).toBe(1);
  });
});

// ── ordering invariant ────────────────────────────────────────────────────────

describe("GET /v1/export — nodes-before-edges ordering invariant", () => {
  it("every edge's sourceId and targetId appear earlier in the stream as node lines", async () => {
    const a = await createNode("ord-a");
    const b = await createNode("ord-b");
    const c = await createNode("ord-c");
    await createEdge(a.id, b.id);
    await createEdge(b.id, c.id);

    const lines = await exportTenant();
    const seenNodeIds = new Set<string>();
    for (const line of lines) {
      if (line.type === "node") {
        seenNodeIds.add(line.id);
      } else {
        const edge = line as NdjsonEdge;
        expect(seenNodeIds.has(edge.sourceId)).toBe(true);
        expect(seenNodeIds.has(edge.targetId)).toBe(true);
      }
    }
  });
});

// ── filters ───────────────────────────────────────────────────────────────────

describe("GET /v1/export — ?lifecycleStatus filter", () => {
  it("excludes archived nodes when filtering by ACTIVE", async () => {
    const active1 = await createNode("filter-active-1");
    const active2 = await createNode("filter-active-2");
    await createNode("filter-archived", { lifecycleStatus: "ARCHIVED" });
    await createEdge(active1.id, active2.id);

    const filtered = await exportTenant({ lifecycleStatus: "ACTIVE" });
    const nodeLines = filtered.filter((l) => l.type === "node") as NdjsonNode[];
    const edgeLines = filtered.filter((l) => l.type === "edge");

    expect(nodeLines).toHaveLength(2);
    expect(nodeLines.every((n) => n.lifecycleStatus === "ACTIVE")).toBe(true);
    expect(edgeLines).toHaveLength(1);
  });

  it("returns only archived nodes when filtering by ARCHIVED", async () => {
    await createNode("arc-1", { lifecycleStatus: "ARCHIVED" });
    await createNode("active-1");

    const filtered = await exportTenant({ lifecycleStatus: "ARCHIVED" });
    expect(filtered.filter((l) => l.type === "node")).toHaveLength(1);
    expect((filtered[0] as NdjsonNode).name).toBe("arc-1");
  });
});

describe("GET /v1/export — ?layer filter", () => {
  it("restricts output to the specified layer", async () => {
    const a = await createNode("l4-a", { layer: "L4" });
    const b = await createNode("l4-b", { layer: "L4" });
    await createNode("l5-c", { layer: "L5" });
    await createEdge(a.id, b.id, { layer: "L4" });

    const filtered = await exportTenant({ layer: "L4" });
    const nodeLines = filtered.filter((l) => l.type === "node") as NdjsonNode[];
    const edgeLines = filtered.filter((l) => l.type === "edge") as NdjsonEdge[];

    expect(nodeLines).toHaveLength(2);
    expect(nodeLines.every((n) => n.layer === "L4")).toBe(true);
    expect(edgeLines).toHaveLength(1);
    expect(edgeLines[0].layer).toBe("L4");
  });

  it("returns zero lines when no entities match the layer", async () => {
    await createNode("l4-only", { layer: "L4" });
    const filtered = await exportTenant({ layer: "L5" });
    expect(filtered).toHaveLength(0);
  });
});

describe("GET /v1/export — combined filters", () => {
  it("applies lifecycleStatus and layer filters together", async () => {
    await createNode("combo-ok", { layer: "L4", lifecycleStatus: "ACTIVE" });
    await createNode("combo-wrong-layer", { layer: "L5", lifecycleStatus: "ACTIVE" });
    await createNode("combo-wrong-status", { layer: "L4", lifecycleStatus: "ARCHIVED" });

    const filtered = await exportTenant({ layer: "L4", lifecycleStatus: "ACTIVE" });
    const nodeLines = filtered.filter((l) => l.type === "node") as NdjsonNode[];
    expect(nodeLines).toHaveLength(1);
    expect(nodeLines[0].name).toBe("combo-ok");
  });
});

// ── round-trip ────────────────────────────────────────────────────────────────

describe("GET /v1/export — round-trip export → import", () => {
  it("exporting and re-importing into a fresh tenant produces an isomorphic graph", async () => {
    // Build a graph in tenant A (tid)
    const importRes = await app.request("/v1/import/bulk", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        nodes: [
          { type: "Service", layer: "L4", name: "rt-a" },
          { type: "Service", layer: "L4", name: "rt-b" },
          { type: "Service", layer: "L4", name: "rt-c" },
        ],
      }),
    });
    expect(importRes.status).toBe(201);
    const { data: { created: { nodes: [idA, idB, idC] } } } = await importRes.json();

    await createEdge(idA, idB);
    await createEdge(idB, idC);

    // Export from tenant A
    const lines = await exportTenant();
    const nodeLines = lines.filter((l) => l.type === "node") as NdjsonNode[];
    const edgeLines = lines.filter((l) => l.type === "edge") as NdjsonEdge[];
    expect(nodeLines).toHaveLength(3);
    expect(edgeLines).toHaveLength(2);

    // Map old node IDs to names for edge remapping
    const oldIdToName: Record<string, string> = {};
    for (const n of nodeLines) oldIdToName[n.id] = n.name;

    // Import into fresh tenant B
    const tidB = randomUUID();
    const hB = () => ({ "content-type": "application/json", "x-tenant-id": tidB });

    try {
      const reImportRes = await app.request("/v1/import/bulk", {
        method: "POST",
        headers: hB(),
        body: JSON.stringify({
          nodes: nodeLines.map((n) => ({ type: n.nodeType, layer: n.layer, name: n.name })),
        }),
      });
      expect(reImportRes.status).toBe(201);
      const { data: { created: { nodes: newNodeIds } } } = await reImportRes.json();

      // Build name→newId mapping (order preserved by import)
      const nameToNewId: Record<string, string> = {};
      for (let i = 0; i < nodeLines.length; i++) {
        nameToNewId[nodeLines[i].name] = newNodeIds[i];
      }

      // Re-create edges in tenant B using remapped IDs
      for (const e of edgeLines) {
        const src = nameToNewId[oldIdToName[e.sourceId]];
        const tgt = nameToNewId[oldIdToName[e.targetId]];
        const res = await app.request("/v1/edges", {
          method: "POST",
          headers: hB(),
          body: JSON.stringify({ sourceId: src, targetId: tgt, type: e.edgeType, layer: e.layer }),
        });
        expect(res.status).toBe(201);
      }

      // Verify tenant B is isomorphic to tenant A
      const [{ nc }] = await sql<[{ nc: string }]>`SELECT COUNT(*)::text AS nc FROM nodes WHERE tenant_id = ${tidB}`;
      const [{ ec }] = await sql<[{ ec: string }]>`SELECT COUNT(*)::text AS ec FROM edges WHERE tenant_id = ${tidB}`;
      expect(Number(nc)).toBe(3);
      expect(Number(ec)).toBe(2);

      // Verify same node names exist
      const bNames = await sql<{ name: string }[]>`SELECT name FROM nodes WHERE tenant_id = ${tidB} ORDER BY name`;
      expect(bNames.map((r) => r.name)).toEqual(["rt-a", "rt-b", "rt-c"]);
    } finally {
      await cleanTenant(sql, tidB);
    }
  });
});
