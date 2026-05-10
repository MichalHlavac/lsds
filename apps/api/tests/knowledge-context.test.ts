// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Integration tests for POST /agent/v1/context (Knowledge Agent context package).
// Semantic-profile tests require EMBEDDING_PROVIDER=stub (constant [1,…,1] vectors;
// all embedded nodes return cosine similarity = 1.0).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant, createTestTenant } from "./test-helpers";

const EMBEDDING_ENABLED = !!process.env["EMBEDDING_PROVIDER"];
const maybeIt = EMBEDDING_ENABLED ? it : it.skip;

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

beforeEach(async () => { tid = randomUUID(); await createTestTenant(sql, tid); });
afterEach(async () => { await cleanTenant(sql, tid); });

async function postContext(body: Record<string, unknown>) {
  return app.request("/agent/v1/context", {
    method: "POST",
    headers: h(),
    body: JSON.stringify(body),
  });
}

async function createNode(name: string, type = "Service", layer = "L4") {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ type, layer, name }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).data as { id: string; name: string };
}

async function createEdge(sourceId: string, targetId: string, type = "depends-on") {
  const res = await app.request("/v1/edges", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ sourceId, targetId, type, layer: "L4" }),
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

// ── Validation ────────────────────────────────────────────────────────────────

describe("POST /agent/v1/context — validation", () => {
  it("returns 400 when nodeId is missing", async () => {
    const res = await postContext({ profile: "depth" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when nodeId is not a UUID", async () => {
    const res = await postContext({ nodeId: "not-a-uuid", profile: "depth" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when profile is invalid", async () => {
    const res = await postContext({ nodeId: randomUUID(), profile: "bogus" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when x-tenant-id header is missing", async () => {
    const res = await app.request("/agent/v1/context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodeId: randomUUID(), profile: "depth" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown node", async () => {
    const res = await postContext({ nodeId: randomUUID(), profile: "depth" });
    expect(res.status).toBe(404);
  });
});

// ── Response shape ────────────────────────────────────────────────────────────

describe("POST /agent/v1/context — response shape", () => {
  it("returns correct shape for an isolated node (depth profile)", async () => {
    const node = await createNode("payment-service");
    const res = await postContext({ nodeId: node.id, profile: "depth" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cached).toBe(false);
    expect(body.profile).toBe("depth");
    expect(body.root.id).toBe(node.id);
    expect(body.root.name).toBe("payment-service");
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
    expect(Array.isArray(body.violations)).toBe(true);
    expect(body.nodes).toHaveLength(0);
    expect(body.edges).toHaveLength(0);
    expect(body.truncated).toBe(false);
  });

  it("returns cached result on identical second request", async () => {
    const node = await createNode("cache-me");
    await postContext({ nodeId: node.id, profile: "breadth" });
    const res2 = await postContext({ nodeId: node.id, profile: "breadth" });
    expect(res2.status).toBe(200);
    expect((await res2.json()).cached).toBe(true);
  });
});

// ── depth profile ─────────────────────────────────────────────────────────────

describe("POST /agent/v1/context — depth profile", () => {
  it("follows depends-on edges outbound", async () => {
    const svc = await createNode("order-service");
    const dep = await createNode("payment-service");
    await createEdge(svc.id, dep.id, "depends-on");

    const res = await postContext({ nodeId: svc.id, profile: "depth" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodes.map((n: { id: string }) => n.id)).toContain(dep.id);
  });

  it("follows implements edges outbound", async () => {
    const iface = await createNode("IPayments", "Interface");
    const impl = await createNode("StripeAdapter", "Service");
    await createEdge(impl.id, iface.id, "implements");

    const res = await postContext({ nodeId: impl.id, profile: "depth" });
    expect(res.status).toBe(200);
    const { nodes } = await res.json();
    expect(nodes.map((n: { id: string }) => n.id)).toContain(iface.id);
  });

  it("does NOT follow breadth-only edges (e.g. contains) outbound", async () => {
    const parent = await createNode("domain");
    const child = await createNode("subdomain");
    await createEdge(parent.id, child.id, "contains");

    const res = await postContext({ nodeId: parent.id, profile: "depth" });
    expect(res.status).toBe(200);
    const { nodes } = await res.json();
    // contains is not in DEPTH_EDGE_TYPES — child should NOT appear
    expect(nodes.map((n: { id: string }) => n.id)).not.toContain(child.id);
  });

  it("does NOT traverse inbound edges (outbound only)", async () => {
    const svc = await createNode("auth-service");
    const caller = await createNode("api-gateway");
    await createEdge(caller.id, svc.id, "depends-on");

    const res = await postContext({ nodeId: svc.id, profile: "depth" });
    expect(res.status).toBe(200);
    const { nodes } = await res.json();
    expect(nodes.map((n: { id: string }) => n.id)).not.toContain(caller.id);
  });

  it("includes edges connecting root and result nodes", async () => {
    const a = await createNode("svc-a");
    const b = await createNode("svc-b");
    const edge = await createEdge(a.id, b.id, "depends-on");

    const res = await postContext({ nodeId: a.id, profile: "depth" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.edges.map((e: { id: string }) => e.id)).toContain(edge.id);
  });

  it("excludes ARCHIVED nodes from results", async () => {
    const svc = await createNode("active-svc");
    const archived = await createNode("archived-dep");
    await createEdge(svc.id, archived.id, "depends-on");

    // Archive the dep node
    await app.request(`/v1/nodes/${archived.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "deprecate" }),
    });
    await app.request(`/v1/nodes/${archived.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "archive" }),
    });

    const res = await postContext({ nodeId: svc.id, profile: "depth" });
    expect(res.status).toBe(200);
    const { nodes } = await res.json();
    expect(nodes.map((n: { id: string }) => n.id)).not.toContain(archived.id);
  });

  it("returns 404 when root node is ARCHIVED", async () => {
    const node = await createNode("to-be-archived");
    await app.request(`/v1/nodes/${node.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "deprecate" }),
    });
    await app.request(`/v1/nodes/${node.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "archive" }),
    });

    const res = await postContext({ nodeId: node.id, profile: "depth" });
    expect(res.status).toBe(404);
  });

  it("includes open violations for included nodes", async () => {
    const svc = await createNode("violating-svc");
    // Post a violation via the violations API
    const vRes = await app.request("/v1/violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        nodeId: svc.id,
        ruleKey: "naming-convention",
        severity: "WARN",
        message: "name too short",
      }),
    });
    expect(vRes.status).toBe(201);

    const res = await postContext({ nodeId: svc.id, profile: "depth" });
    expect(res.status).toBe(200);
    const { violations } = await res.json();
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0].ruleKey).toBe("naming-convention");
  });

  it("respects maxNodes and sets truncated=true", async () => {
    const root = await createNode("root");
    const deps = await Promise.all(
      Array.from({ length: 5 }, (_, i) => createNode(`dep-${i}`))
    );
    await Promise.all(deps.map((d) => createEdge(root.id, d.id, "depends-on")));

    const res = await postContext({ nodeId: root.id, profile: "depth", maxNodes: 3 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nodes.length).toBeLessThanOrEqual(3);
    expect(body.truncated).toBe(true);
  });
});

// ── breadth profile ───────────────────────────────────────────────────────────

describe("POST /agent/v1/context — breadth profile", () => {
  it("follows all edge types in both directions", async () => {
    const center = await createNode("hub");
    const child = await createNode("child");
    const parent = await createNode("parent");
    await createEdge(center.id, child.id, "contains");
    await createEdge(parent.id, center.id, "contains");

    const res = await postContext({ nodeId: center.id, profile: "breadth" });
    expect(res.status).toBe(200);
    const { nodes } = await res.json();
    const ids = nodes.map((n: { id: string }) => n.id);
    expect(ids).toContain(child.id);
    expect(ids).toContain(parent.id);
  });

  it("limits traversal to max 2 hops", async () => {
    const root = await createNode("root");
    const hop1 = await createNode("hop1");
    const hop2 = await createNode("hop2");
    const hop3 = await createNode("hop3"); // beyond max hops
    await createEdge(root.id, hop1.id, "depends-on");
    await createEdge(hop1.id, hop2.id, "depends-on");
    await createEdge(hop2.id, hop3.id, "depends-on");

    const res = await postContext({ nodeId: root.id, profile: "breadth" });
    expect(res.status).toBe(200);
    const { nodes } = await res.json();
    const ids = nodes.map((n: { id: string }) => n.id);
    expect(ids).toContain(hop1.id);
    expect(ids).toContain(hop2.id);
    expect(ids).not.toContain(hop3.id);
  });
});

// ── semantic profile ──────────────────────────────────────────────────────────

describe("POST /agent/v1/context — semantic profile", () => {
  it("falls back to breadth when embeddingService is unavailable (no EMBEDDING_PROVIDER)", async () => {
    if (EMBEDDING_ENABLED) return; // only meaningful without a provider
    const center = await createNode("fallback-hub");
    const neighbor = await createNode("fallback-neighbor");
    await createEdge(center.id, neighbor.id, "depends-on");

    const res = await postContext({ nodeId: center.id, profile: "semantic" });
    expect(res.status).toBe(200);
    const { nodes } = await res.json();
    // Fallback breadth should pick up the neighbor at depth 1
    expect(nodes.map((n: { id: string }) => n.id)).toContain(neighbor.id);
  });

  maybeIt("returns similar nodes by cosine similarity when embeddings are present", async () => {
    const anchor = await createNode("anchor-service");
    const similar = await createNode("similar-service");
    // Unrelated node — also gets embedded but should pass minSimilarity with stub (score=1.0)
    const other = await createNode("other-service");

    await Promise.all([
      waitForEmbedding(anchor.id),
      waitForEmbedding(similar.id),
      waitForEmbedding(other.id),
    ]);

    const res = await postContext({ nodeId: anchor.id, profile: "semantic", minSimilarity: 0.5 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile).toBe("semantic");
    // With stub embeddings (all [1,…,1]) every node scores 1.0 ≥ 0.5
    const ids = body.nodes.map((n: { id: string }) => n.id);
    expect(ids).toContain(similar.id);
    expect(ids).toContain(other.id);
    expect(ids).not.toContain(anchor.id); // root is in body.root, not body.nodes
  });

  maybeIt("falls back to breadth when root node has no embedding", async () => {
    const noEmbed = await createNode("no-embed-svc");
    const neighbor = await createNode("embed-neighbor");
    await createEdge(noEmbed.id, neighbor.id, "depends-on");

    // Explicitly null out the root's embedding
    await sql`UPDATE nodes SET embedding = NULL WHERE id = ${noEmbed.id}`;

    const res = await postContext({ nodeId: noEmbed.id, profile: "semantic" });
    expect(res.status).toBe(200);
    const { nodes } = await res.json();
    // Breadth fallback should find the neighbor (depth 1 via depends-on)
    expect(nodes.map((n: { id: string }) => n.id)).toContain(neighbor.id);
  });

  // "excludes nodes below minSimilarity threshold" cannot be tested with the stub
  // provider: the schema correctly enforces minSimilarity ≤ 1.0 (cosine range),
  // and stub embeddings return similarity = 1.0 for every node, so no valid
  // threshold can demonstrate exclusion. Exercise this path with a real
  // embedding provider in a staging environment.
});
