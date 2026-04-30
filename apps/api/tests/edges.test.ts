// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { edgesRouter } from "../src/routes/edges";
import { T, ID1, ID2, ID3, h, makeSql, makeSeqSql, makeCache, withErrorHandler, fakeEdge, fakeNode } from "./test-helpers";

vi.mock("@lsds/framework", () => ({
  validateRelationshipEdge: vi.fn(() => []),
}));

import { validateRelationshipEdge } from "@lsds/framework";

function makeApp(rows: unknown[] = []) {
  const app = new Hono();
  app.route("/v1/edges", edgesRouter(makeSql(rows), makeCache()));
  return withErrorHandler(app);
}

function makeSeqApp(...responses: unknown[][]) {
  const app = new Hono();
  app.route("/v1/edges", edgesRouter(makeSeqSql(...responses), makeCache()));
  return withErrorHandler(app);
}

const validEdgeBody = {
  sourceId: ID2,
  targetId: ID3,
  type: "DEPENDS_ON",
  layer: "L4",
};

describe("GET /v1/edges", () => {
  it("returns 200 with data array", async () => {
    const app = makeApp([fakeEdge()]);
    const res = await app.request("/v1/edges", { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe("POST /v1/edges", () => {
  it("returns 201 when source and target nodes exist and validation passes", async () => {
    vi.mocked(validateRelationshipEdge).mockReturnValue([]);
    const sourceNode = { ...fakeNode(), id: ID2 };
    const targetNode = { ...fakeNode(), id: ID3 };
    const edge = fakeEdge();
    const app = makeSeqApp([sourceNode], [targetNode], [edge]);
    const res = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify(validEdgeBody),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toBeDefined();
  });

  it("returns 404 when source node is not found", async () => {
    const app = makeSeqApp([], [fakeNode()], [fakeEdge()]);
    const res = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify(validEdgeBody),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/source/);
  });

  it("returns 404 when target node is not found", async () => {
    const sourceNode = { ...fakeNode(), id: ID2 };
    const app = makeSeqApp([sourceNode], [], [fakeEdge()]);
    const res = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify(validEdgeBody),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/target/);
  });

  it("returns 422 when validateRelationshipEdge returns issues", async () => {
    vi.mocked(validateRelationshipEdge).mockReturnValueOnce([{ message: "cross-layer edge not allowed" }] as any);
    const sourceNode = { ...fakeNode(), id: ID2 };
    const targetNode = { ...fakeNode(), id: ID3 };
    const app = makeSeqApp([sourceNode], [targetNode], [fakeEdge()]);
    const res = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify(validEdgeBody),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("invalid edge");
  });

  it("returns 400 for non-UUID sourceId", async () => {
    const app = makeApp();
    const res = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ ...validEdgeBody, sourceId: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-UUID targetId", async () => {
    const app = makeApp();
    const res = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ ...validEdgeBody, targetId: "bad" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid layer", async () => {
    const app = makeApp();
    const res = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ ...validEdgeBody, layer: "L9" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/edges/:id", () => {
  it("returns 200 when edge exists", async () => {
    const app = makeApp([fakeEdge()]);
    const res = await app.request(`/v1/edges/${ID1}`, { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(ID1);
  });

  it("returns 404 when edge does not exist", async () => {
    const app = makeApp([]);
    const res = await app.request(`/v1/edges/${ID1}`, { headers: h() });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /v1/edges/:id", () => {
  it("returns 200 on successful update", async () => {
    const app = makeApp([fakeEdge()]);
    const res = await app.request(`/v1/edges/${ID1}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ traversalWeight: 2.0 }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 404 when edge does not exist", async () => {
    const app = makeApp([]);
    const res = await app.request(`/v1/edges/${ID1}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ traversalWeight: 2.0 }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /v1/edges/:id", () => {
  it("returns 200 when edge is deleted", async () => {
    const app = makeApp([fakeEdge()]);
    const res = await app.request(`/v1/edges/${ID1}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(ID1);
  });

  it("returns 404 when edge does not exist", async () => {
    const app = makeApp([]);
    const res = await app.request(`/v1/edges/${ID1}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(404);
  });
});
