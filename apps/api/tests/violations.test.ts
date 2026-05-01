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

async function createNode(name = "target-node") {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ type: "Service", layer: "L4", name }),
  });
  return (await res.json()).data;
}

async function createEdge(sourceId: string, targetId: string) {
  const res = await app.request("/v1/edges", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ sourceId, targetId, type: "calls", layer: "L4" }),
  });
  return (await res.json()).data;
}

async function createViolation(nodeId: string) {
  const res = await app.request("/v1/violations", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({
      nodeId,
      ruleKey: "naming.min_length",
      severity: "WARN",
      message: "Name is too short",
    }),
  });
  return (await res.json()).data;
}

// ── GET /v1/violations ────────────────────────────────────────────────────────

describe("GET /v1/violations", () => {
  it("returns 200 with an empty array for a fresh tenant", async () => {
    const res = await app.request("/v1/violations", { headers: h() });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);
  });

  it("returns violations for the tenant", async () => {
    const node = await createNode();
    await createViolation(node.id);

    const res = await app.request("/v1/violations", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0].ruleKey).toBe("naming.min_length");
  });

  it("filters by nodeId query param", async () => {
    const node = await createNode();
    await createViolation(node.id);

    const res = await app.request(`/v1/violations?nodeId=${node.id}`, { headers: h() });
    const { data } = await res.json();
    expect(data.every((v: any) => v.nodeId === node.id)).toBe(true);
  });
});

// ── POST /v1/violations ───────────────────────────────────────────────────────

describe("POST /v1/violations", () => {
  it("creates a violation and returns 201", async () => {
    const node = await createNode();
    const res = await app.request("/v1/violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        nodeId: node.id,
        ruleKey: "naming.min_length",
        severity: "WARN",
        message: "Name is too short",
      }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.ruleKey).toBe("naming.min_length");
    expect(data.resolved).toBe(false);
  });

  it("creates a violation without a nodeId (edge-level violation)", async () => {
    const res = await app.request("/v1/violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        ruleKey: "edge.invalid",
        severity: "ERROR",
        message: "Edge violates constraints",
      }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).data.nodeId).toBeNull();
  });

  // LSDS-274: edge violations must capture source/target node IDs so architects
  // can navigate from the violation back to the offending pair.
  it("derives sourceNodeId and targetNodeId from edgeId when omitted", async () => {
    const src = await createNode("svc-a");
    const tgt = await createNode("svc-b");
    const edge = await createEdge(src.id, tgt.id);

    const res = await app.request("/v1/violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        edgeId: edge.id,
        ruleKey: "edge.cross_layer",
        severity: "ERROR",
        message: "cross-layer edge",
      }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.edgeId).toBe(edge.id);
    expect(data.sourceNodeId).toBe(src.id);
    expect(data.targetNodeId).toBe(tgt.id);
  });

  it("respects caller-supplied sourceNodeId and targetNodeId over edge lookup", async () => {
    const src = await createNode("svc-a");
    const tgt = await createNode("svc-b");
    const explicitSrc = await createNode("svc-c");
    const explicitTgt = await createNode("svc-d");
    const edge = await createEdge(src.id, tgt.id);

    const res = await app.request("/v1/violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        edgeId: edge.id,
        sourceNodeId: explicitSrc.id,
        targetNodeId: explicitTgt.id,
        ruleKey: "edge.custom",
        severity: "WARN",
        message: "custom",
      }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.sourceNodeId).toBe(explicitSrc.id);
    expect(data.targetNodeId).toBe(explicitTgt.id);
  });

  it("leaves sourceNodeId/targetNodeId null for node-level violations", async () => {
    const node = await createNode();
    const v = await createViolation(node.id);
    expect(v.sourceNodeId).toBeNull();
    expect(v.targetNodeId).toBeNull();
  });

  it("returns 400 for an invalid severity", async () => {
    const res = await app.request("/v1/violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ ruleKey: "r", severity: "CRITICAL", message: "m" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("validation error");
  });

  it("returns 400 when ruleKey is missing", async () => {
    const res = await app.request("/v1/violations", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ severity: "WARN", message: "no rule" }),
    });
    expect(res.status).toBe(400);
  });
});

// ── GET /v1/violations/:id ────────────────────────────────────────────────────

describe("GET /v1/violations/:id", () => {
  it("returns 200 and the violation when it exists", async () => {
    const node = await createNode();
    const v = await createViolation(node.id);

    const res = await app.request(`/v1/violations/${v.id}`, { headers: h() });
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe(v.id);
  });

  it("returns 404 for a nonexistent violation ID", async () => {
    const res = await app.request(`/v1/violations/${randomUUID()}`, { headers: h() });
    expect(res.status).toBe(404);
  });
});

// ── POST /v1/violations/:id/resolve ───────────────────────────────────────────

describe("POST /v1/violations/:id/resolve", () => {
  it("marks the violation as resolved and returns the updated row", async () => {
    const node = await createNode();
    const v = await createViolation(node.id);

    const res = await app.request(`/v1/violations/${v.id}/resolve`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.resolved).toBe(true);
    expect(data.resolvedAt).toBeTruthy();
  });

  it("returns 404 when resolving an already-resolved violation", async () => {
    const node = await createNode();
    const v = await createViolation(node.id);
    await app.request(`/v1/violations/${v.id}/resolve`, { method: "POST", headers: h() });

    const res = await app.request(`/v1/violations/${v.id}/resolve`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/already resolved/);
  });

  it("returns 404 for a nonexistent violation ID", async () => {
    const res = await app.request(`/v1/violations/${randomUUID()}/resolve`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(404);
  });
});

// ── DELETE /v1/violations/:id ─────────────────────────────────────────────────

describe("DELETE /v1/violations/:id", () => {
  it("deletes the violation and returns its id", async () => {
    const node = await createNode();
    const v = await createViolation(node.id);

    const res = await app.request(`/v1/violations/${v.id}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe(v.id);
  });

  it("returns 404 for a nonexistent violation ID", async () => {
    const res = await app.request(`/v1/violations/${randomUUID()}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(404);
  });
});
