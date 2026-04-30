// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { traversalRouter, queryRouter } from "../src/routes/traversal";
import type { TraversalEngine, TraversalResult } from "../src/db/traversal-adapter";
import { T, ID1, h, makeSql, makeCache, withErrorHandler, fakeNode } from "./test-helpers";

function makeAdapter(results: TraversalResult[] = []): TraversalEngine {
  return {
    traverse: async () => results.map((r) => r.nodeId),
    traverseWithDepth: async () => results,
  };
}

function makeApp(traversalResults: TraversalResult[] = [], nodeRows: unknown[] = []) {
  const app = new Hono();
  const sql = makeSql(nodeRows);
  const cache = makeCache();
  const adapter = makeAdapter(traversalResults);
  app.route("/v1/nodes", traversalRouter(sql, cache, adapter));
  app.route("/v1/query", queryRouter(sql));
  return withErrorHandler(app);
}

describe("POST /v1/nodes/:id/traverse", () => {
  it("returns 200 with traversal results", async () => {
    const results: TraversalResult[] = [
      { nodeId: ID1, depth: 1, path: [ID1] },
    ];
    const app = makeApp(results, [fakeNode()]);
    const res = await app.request(`/v1/nodes/${ID1}/traverse`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ depth: 2, direction: "outbound" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveProperty("root", ID1);
    expect(body.data).toHaveProperty("depth", 2);
    expect(body.data).toHaveProperty("direction", "outbound");
    expect(Array.isArray(body.data.nodes)).toBe(true);
    expect(Array.isArray(body.data.traversal)).toBe(true);
    expect(body.cached).toBe(false);
  });

  it("applies TraverseSchema defaults (depth 3, direction both)", async () => {
    const app = makeApp([], []);
    const res = await app.request(`/v1/nodes/${ID1}/traverse`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.depth).toBe(3);
    expect(body.data.direction).toBe("both");
  });

  it("returns 400 for depth above 20", async () => {
    const app = makeApp();
    const res = await app.request(`/v1/nodes/${ID1}/traverse`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ depth: 99 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("validation error");
  });

  it("returns 400 for depth below 1", async () => {
    const app = makeApp();
    const res = await app.request(`/v1/nodes/${ID1}/traverse`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ depth: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid direction", async () => {
    const app = makeApp();
    const res = await app.request(`/v1/nodes/${ID1}/traverse`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ direction: "sideways" }),
    });
    expect(res.status).toBe(400);
  });

  it("serves cached result on second request", async () => {
    const app = makeApp([], []);
    const body = JSON.stringify({ depth: 2, direction: "outbound" });
    await app.request(`/v1/nodes/${ID1}/traverse`, { method: "POST", headers: h(), body });
    const res2 = await app.request(`/v1/nodes/${ID1}/traverse`, { method: "POST", headers: h(), body });
    expect(res2.status).toBe(200);
    const b = await res2.json();
    expect(b.cached).toBe(true);
  });
});

describe("POST /v1/query/nodes", () => {
  it("returns 200 with data array", async () => {
    const app = makeApp([], [fakeNode()]);
    const res = await app.request("/v1/query/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("returns 200 with empty body (all defaults)", async () => {
    const app = makeApp([], []);
    const res = await app.request("/v1/query/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });

  it("returns 400 for invalid layer", async () => {
    const app = makeApp();
    const res = await app.request("/v1/query/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ layer: "L99" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("validation error");
  });

  it("returns 400 for limit above 500", async () => {
    const app = makeApp();
    const res = await app.request("/v1/query/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ limit: 501 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for negative offset", async () => {
    const app = makeApp();
    const res = await app.request("/v1/query/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ offset: -1 }),
    });
    expect(res.status).toBe(400);
  });
});
