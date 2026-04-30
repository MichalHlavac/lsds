// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { violationsRouter } from "../src/routes/violations";
import { T, ID1, ID2, h, makeSql, withErrorHandler, fakeViolation } from "./test-helpers";

function makeApp(rows: unknown[] = []) {
  const app = new Hono();
  app.route("/v1/violations", violationsRouter(makeSql(rows)));
  return withErrorHandler(app);
}

describe("GET /v1/violations", () => {
  it("returns 200 with data array", async () => {
    const app = makeApp([fakeViolation()]);
    const res = await app.request("/v1/violations", { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("returns 400 when x-tenant-id header is missing", async () => {
    const app = makeApp();
    const res = await app.request("/v1/violations");
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/violations", () => {
  it("returns 201 for a valid violation with nodeId", async () => {
    const app = makeApp([fakeViolation()]);
    const res = await app.request("/v1/violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        nodeId: ID2,
        ruleKey: "naming.min_length",
        severity: "WARN",
        message: "Name is too short",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toBeDefined();
  });

  it("returns 201 for a valid violation with edgeId only", async () => {
    const app = makeApp([fakeViolation()]);
    const res = await app.request("/v1/violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        edgeId: ID2,
        ruleKey: "edge.cross_layer",
        severity: "ERROR",
        message: "Cross-layer edge not allowed",
      }),
    });
    expect(res.status).toBe(201);
  });

  it("returns 400 for invalid severity", async () => {
    const app = makeApp();
    const res = await app.request("/v1/violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        ruleKey: "naming.min_length",
        severity: "CRITICAL",
        message: "bad",
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("validation error");
  });

  it("returns 400 when ruleKey is missing", async () => {
    const app = makeApp();
    const res = await app.request("/v1/violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ severity: "WARN", message: "missing key" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when message is empty", async () => {
    const app = makeApp();
    const res = await app.request("/v1/violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ ruleKey: "r", severity: "WARN", message: "" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/violations/:id", () => {
  it("returns 200 when violation exists", async () => {
    const app = makeApp([fakeViolation()]);
    const res = await app.request(`/v1/violations/${ID1}`, { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(ID1);
  });

  it("returns 404 when violation does not exist", async () => {
    const app = makeApp([]);
    const res = await app.request(`/v1/violations/${ID1}`, { headers: h() });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not found");
  });
});

describe("POST /v1/violations/:id/resolve", () => {
  it("returns 200 when violation is resolved", async () => {
    const resolved = { ...fakeViolation(), resolved: true, resolvedAt: new Date() };
    const app = makeApp([resolved]);
    const res = await app.request(`/v1/violations/${ID1}/resolve`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
  });

  it("returns 404 when violation not found or already resolved", async () => {
    const app = makeApp([]);
    const res = await app.request(`/v1/violations/${ID1}/resolve`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/);
  });
});

describe("DELETE /v1/violations/:id", () => {
  it("returns 200 when violation is deleted", async () => {
    const app = makeApp([{ id: ID1 }]);
    const res = await app.request(`/v1/violations/${ID1}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(ID1);
  });

  it("returns 404 when violation does not exist", async () => {
    const app = makeApp([]);
    const res = await app.request(`/v1/violations/${ID1}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(404);
  });
});
