// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Semantic search integration tests.
// Requires EMBEDDING_PROVIDER=stub (set in CI via env, or locally via .env.test).
// With stub, all embeddings are zero-vectors; cosine distance between zero-vectors = 0
// so every embedded node returns score ≈ 1.0 against any query.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant } from "./test-helpers";

const SKIP = !process.env["EMBEDDING_PROVIDER"];
const maybeIt = SKIP ? it.skip : it;

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

beforeEach(() => {
  tid = randomUUID();
});
afterEach(async () => {
  await cleanTenant(sql, tid);
});

async function createNode(type: string, layer: string, name: string) {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ type, layer, name }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).data as { id: string };
}

async function waitForEmbedding(nodeId: string, maxMs = 3000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const [row] = await sql<[{ embedding: unknown }]>`
      SELECT embedding FROM nodes WHERE id = ${nodeId}
    `;
    if (row?.embedding != null) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`embedding not stored for node ${nodeId} within ${maxMs}ms`);
}

describe("POST /agent/v1/search/semantic", () => {
  it("returns 400 for a missing query field", async () => {
    const res = await app.request("/agent/v1/search/semantic", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ limit: 5 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for an empty query string", async () => {
    const res = await app.request("/agent/v1/search/semantic", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ query: "" }),
    });
    expect(res.status).toBe(400);
  });

  maybeIt("returns cosine-ranked results with { node, score } shape", async () => {
    const node = await createNode("Service", "L4", "auth-service");
    await waitForEmbedding(node.id);

    const res = await app.request("/agent/v1/search/semantic", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ query: "authentication service" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);

    const first = data[0];
    expect(typeof first.score).toBe("number");
    expect(first.node.id).toBe(node.id);
    expect(first.node.type).toBe("Service");
    // embedding column must not appear in the response payload
    expect(first.node.embedding).toBeUndefined();
  });

  maybeIt("respects the type filter", async () => {
    const svc = await createNode("Service", "L4", "payment-service");
    const ctx = await createNode("BoundedContext", "L3", "payments");
    await Promise.all([waitForEmbedding(svc.id), waitForEmbedding(ctx.id)]);

    const res = await app.request("/agent/v1/search/semantic", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ query: "payments", type: "Service" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data.every((r: { node: { type: string } }) => r.node.type === "Service")).toBe(true);
  });

  maybeIt("respects the layer filter", async () => {
    const l4 = await createNode("Service", "L4", "inventory-service");
    const l3 = await createNode("BoundedContext", "L3", "inventory");
    await Promise.all([waitForEmbedding(l4.id), waitForEmbedding(l3.id)]);

    const res = await app.request("/agent/v1/search/semantic", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ query: "inventory", layer: "L4" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.every((r: { node: { layer: string } }) => r.node.layer === "L4")).toBe(true);
  });

  maybeIt("excludes nodes without embeddings", async () => {
    const node = await createNode("Service", "L4", "ghost-service");
    // Null out the embedding immediately to simulate un-embedded node
    await sql`UPDATE nodes SET embedding = NULL WHERE id = ${node.id}`;

    const res = await app.request("/agent/v1/search/semantic", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ query: "ghost service" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.find((r: { node: { id: string } }) => r.node.id === node.id)).toBeUndefined();
  });

  maybeIt("embedding is stored after node creation", async () => {
    const node = await createNode("Service", "L4", "new-service");
    // Embedding should be stored asynchronously by the on-write hook
    await expect(waitForEmbedding(node.id)).resolves.toBeUndefined();
  });

  maybeIt("embedding is refreshed after node update (name change)", async () => {
    const node = await createNode("Service", "L4", "old-name");
    await waitForEmbedding(node.id);

    // Clear embedding to verify it gets regenerated
    await sql`UPDATE nodes SET embedding = NULL WHERE id = ${node.id}`;

    await app.request(`/v1/nodes/${node.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ name: "new-name" }),
    });
    await expect(waitForEmbedding(node.id)).resolves.toBeUndefined();
  });
});
