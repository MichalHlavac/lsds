// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { nodesRouter } from "../src/routes/nodes";
import { T, ID1, h, makeSql, makeCache, withErrorHandler, fakeNode } from "./test-helpers";

function makeApp(rows: unknown[] = []) {
  const app = new Hono();
  app.route("/v1/nodes", nodesRouter(makeSql(rows), makeCache()));
  return withErrorHandler(app);
}

describe("GET /v1/nodes", () => {
  it("returns 200 with data array", async () => {
    const app = makeApp([fakeNode()]);
    const res = await app.request("/v1/nodes", { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("returns 400 when x-tenant-id header is missing", async () => {
    const app = makeApp();
    const res = await app.request("/v1/nodes");
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/nodes", () => {
  it("returns 201 with a valid body", async () => {
    const app = makeApp([fakeNode()]);
    const res = await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "auth-service" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toBeDefined();
  });

  it("returns 400 for missing type", async () => {
    const app = makeApp();
    const res = await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ layer: "L4", name: "x" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("validation error");
  });

  it("returns 400 for invalid layer", async () => {
    const app = makeApp();
    const res = await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L9", name: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid lifecycleStatus", async () => {
    const app = makeApp();
    const res = await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L1", name: "x", lifecycleStatus: "GONE" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/nodes/:id", () => {
  it("returns 200 when node exists", async () => {
    const app = makeApp([fakeNode()]);
    const res = await app.request(`/v1/nodes/${ID1}`, { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(ID1);
  });

  it("returns 404 when node does not exist", async () => {
    const app = makeApp([]);
    const res = await app.request(`/v1/nodes/${ID1}`, { headers: h() });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not found");
  });
});

describe("PATCH /v1/nodes/:id", () => {
  it("returns 200 on successful update", async () => {
    const app = makeApp([fakeNode()]);
    const res = await app.request(`/v1/nodes/${ID1}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ name: "new-name" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
  });

  it("returns 404 when node does not exist", async () => {
    const app = makeApp([]);
    const res = await app.request(`/v1/nodes/${ID1}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ name: "new-name" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid lifecycleStatus in patch", async () => {
    const app = makeApp();
    const res = await app.request(`/v1/nodes/${ID1}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ lifecycleStatus: "DEAD" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /v1/nodes/:id", () => {
  it("returns 200 when node is deleted", async () => {
    const app = makeApp([{ id: ID1 }]);
    const res = await app.request(`/v1/nodes/${ID1}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(ID1);
  });

  it("returns 404 when node does not exist", async () => {
    const app = makeApp([]);
    const res = await app.request(`/v1/nodes/${ID1}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/nodes/:id/neighbors", () => {
  it("returns 200 with outbound and inbound arrays", async () => {
    const app = makeApp([fakeNode()]);
    const res = await app.request(`/v1/nodes/${ID1}/neighbors`, { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveProperty("outbound");
    expect(body.data).toHaveProperty("inbound");
  });

  it("returns 200 with direction=outbound", async () => {
    const app = makeApp([fakeNode()]);
    const res = await app.request(`/v1/nodes/${ID1}/neighbors?direction=outbound`, { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data.outbound)).toBe(true);
  });
});
