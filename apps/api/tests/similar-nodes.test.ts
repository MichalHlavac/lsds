// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Integration tests for POST /v1/nodes/similar.
// Embeddings are injected directly into nodes.embedding (no EmbeddingService).
// Uses singleton unit vectors so cosine similarity is deterministic:
//   vec(i) · vec(i) = 1.0  (identical direction)
//   vec(i) · vec(j) = 0.0  (orthogonal, i ≠ j)

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant } from "./test-helpers";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

beforeEach(() => { tid = randomUUID(); });
afterEach(async () => { await cleanTenant(sql, tid); });

function singletonVec(idx: number): string {
  const v = new Array(1536).fill(0) as number[];
  v[idx] = 1;
  return `[${v.join(",")}]`;
}

async function createNode(type: string, layer: string, name: string) {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ type, layer, name }),
  });
  expect(res.status).toBe(201);
  return (await res.json() as { data: { id: string } }).data;
}

async function insertEmbedding(nodeId: string, vec: string): Promise<void> {
  await sql`
    UPDATE nodes SET embedding = ${vec}::vector
    WHERE id = ${nodeId} AND tenant_id = ${tid}
  `;
}

describe("POST /v1/nodes/similar", () => {
  it("returns 400 for missing nodeId", async () => {
    const res = await app.request("/v1/nodes/similar", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ topK: 5 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid nodeId format", async () => {
    const res = await app.request("/v1/nodes/similar", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ nodeId: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when node does not exist", async () => {
    const res = await app.request("/v1/nodes/similar", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ nodeId: randomUUID() }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 422 when node has no embedding", async () => {
    const node = await createNode("Service", "L4", "no-embedding");
    const res = await app.request("/v1/nodes/similar", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ nodeId: node.id }),
    });
    expect(res.status).toBe(422);
    expect((await res.json() as { error: string }).error).toMatch(/no embedding/);
  });

  it("returns cosine-ranked { node, score } results", async () => {
    const root = await createNode("Service", "L4", "root");
    const near = await createNode("Service", "L4", "near");
    const far = await createNode("Service", "L4", "far");

    // root and near share direction 0 → cosine similarity = 1.0
    // far is orthogonal → cosine similarity = 0.0
    await insertEmbedding(root.id, singletonVec(0));
    await insertEmbedding(near.id, singletonVec(0));
    await insertEmbedding(far.id, singletonVec(1));

    const res = await app.request("/v1/nodes/similar", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ nodeId: root.id, topK: 10 }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: Array<{ node: { id: string }; score: number }> };
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);

    const nearResult = data.find(r => r.node.id === near.id);
    const farResult = data.find(r => r.node.id === far.id);
    expect(nearResult).toBeDefined();
    expect(nearResult!.score).toBeCloseTo(1.0, 3);

    // near ranks before far (if far is present at all with score ≈ 0)
    if (farResult) {
      const nearIdx = data.indexOf(nearResult!);
      const farIdx = data.indexOf(farResult);
      expect(nearIdx).toBeLessThan(farIdx);
    }

    // embedding column must not leak into response
    expect((nearResult!.node as Record<string, unknown>)["embedding"]).toBeUndefined();
  });

  it("excludes root node from results", async () => {
    const root = await createNode("Service", "L4", "root");
    const other = await createNode("Service", "L4", "other");
    await insertEmbedding(root.id, singletonVec(0));
    await insertEmbedding(other.id, singletonVec(0));

    const res = await app.request("/v1/nodes/similar", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ nodeId: root.id, topK: 10 }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: Array<{ node: { id: string } }> };
    expect(data.find(r => r.node.id === root.id)).toBeUndefined();
    expect(data.find(r => r.node.id === other.id)).toBeDefined();
  });

  it("respects topK limit", async () => {
    const root = await createNode("Service", "L4", "root");
    await insertEmbedding(root.id, singletonVec(0));

    for (let i = 0; i < 5; i++) {
      const n = await createNode("Service", "L4", `node-${i}`);
      await insertEmbedding(n.id, singletonVec(0));
    }

    const res = await app.request("/v1/nodes/similar", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ nodeId: root.id, topK: 3 }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: unknown[] };
    expect(data.length).toBeLessThanOrEqual(3);
  });

  it("applies threshold filter", async () => {
    const root = await createNode("Service", "L4", "root");
    const similar = await createNode("Service", "L4", "similar");
    const orthogonal = await createNode("Service", "L4", "orthogonal");

    await insertEmbedding(root.id, singletonVec(0));
    await insertEmbedding(similar.id, singletonVec(0));   // score ≈ 1.0
    await insertEmbedding(orthogonal.id, singletonVec(1)); // score ≈ 0.0

    const res = await app.request("/v1/nodes/similar", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ nodeId: root.id, topK: 10, threshold: 0.5 }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: Array<{ node: { id: string }; score: number }> };
    expect(data.every(r => r.score >= 0.5)).toBe(true);
    expect(data.find(r => r.node.id === orthogonal.id)).toBeUndefined();
    expect(data.find(r => r.node.id === similar.id)).toBeDefined();
  });

  it("enforces tenant isolation (A6)", async () => {
    const tid2 = randomUUID();

    const root = await createNode("Service", "L4", "root");
    await insertEmbedding(root.id, singletonVec(0));

    // Create node in a different tenant and insert an embedding for it
    const r2 = await app.request("/v1/nodes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": tid2 },
      body: JSON.stringify({ type: "Service", layer: "L4", name: "other-tenant" }),
    });
    expect(r2.status).toBe(201);
    const otherNode = (await r2.json() as { data: { id: string } }).data;
    await sql`
      UPDATE nodes SET embedding = ${singletonVec(0)}::vector
      WHERE id = ${otherNode.id} AND tenant_id = ${tid2}
    `;

    const res = await app.request("/v1/nodes/similar", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ nodeId: root.id, topK: 10 }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: Array<{ node: { id: string } }> };
    expect(data.find(r => r.node.id === otherNode.id)).toBeUndefined();

    await cleanTenant(sql, tid2);
  });

  it("excludes ARCHIVED nodes from results", async () => {
    const root = await createNode("Service", "L4", "root");
    const active = await createNode("Service", "L4", "active");
    const toArchive = await createNode("Service", "L4", "to-archive");

    await insertEmbedding(root.id, singletonVec(0));
    await insertEmbedding(active.id, singletonVec(0));
    await insertEmbedding(toArchive.id, singletonVec(0));

    await app.request(`/v1/nodes/${toArchive.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "deprecate" }),
    });
    await app.request(`/v1/nodes/${toArchive.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "archive" }),
    });

    const res = await app.request("/v1/nodes/similar", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ nodeId: root.id, topK: 10 }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json() as { data: Array<{ node: { id: string } }> };
    expect(data.find(r => r.node.id === toArchive.id)).toBeUndefined();
    expect(data.find(r => r.node.id === active.id)).toBeDefined();
  });
});
