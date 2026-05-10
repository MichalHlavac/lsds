// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// E2E smoke tests for the four edit-flow paths merged in LSDS-181 (PR #69).
// Covers: POST /v1/nodes, PATCH /v1/nodes/:id, POST /v1/edges, PATCH /v1/edges/:id
// plus error paths that gate the LSDS-208 readiness review smoke pass.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant, createTestTenant } from "./test-helpers";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

beforeEach(async () => { tid = randomUUID(); await createTestTenant(sql, tid); });
afterEach(async () => { await cleanTenant(sql, tid); });

async function postNode(payload: Record<string, unknown>) {
  return app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify(payload),
  });
}

async function postEdge(payload: Record<string, unknown>) {
  return app.request("/v1/edges", {
    method: "POST",
    headers: h(),
    body: JSON.stringify(payload),
  });
}

// ── POST /v1/nodes ────────────────────────────────────────────────────────────

describe("POST /v1/nodes — edit-flow smoke", () => {
  it("returns 201 with all schema fields present", async () => {
    const res = await postNode({ type: "Service", layer: "L4", name: "smoke-node" });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(typeof data.id).toBe("string");
    expect(data.type).toBe("Service");
    expect(data.layer).toBe("L4");
    expect(data.name).toBe("smoke-node");
    expect(typeof data.createdAt).toBe("string");
    expect(typeof data.updatedAt).toBe("string");
  });

  it("applies default lifecycleStatus, version, and attributes when omitted", async () => {
    const res = await postNode({ type: "Service", layer: "L4", name: "defaults-node" });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.lifecycleStatus).toBe("ACTIVE");
    expect(data.version).toBe("0.1.0");
    expect(data.attributes).toEqual({});
  });

  it("stores explicit optional fields when provided", async () => {
    const res = await postNode({
      type: "Service",
      layer: "L4",
      name: "explicit-node",
      version: "1.2.3",
      lifecycleStatus: "DEPRECATED",
      attributes: { owner: "platform-team" },
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.version).toBe("1.2.3");
    expect(data.lifecycleStatus).toBe("DEPRECATED");
    expect(data.attributes).toEqual({ owner: "platform-team" });
  });

  it("returns 400 with issues array when a required field is missing", async () => {
    const res = await postNode({ type: "Service", layer: "L4" }); // missing name
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("validation error");
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
  });
});

// ── PATCH /v1/nodes/:id ───────────────────────────────────────────────────────

describe("PATCH /v1/nodes/:id — edit-flow smoke", () => {
  it("updates name and leaves all other fields unchanged", async () => {
    const { data: created } = await (
      await postNode({ type: "Service", layer: "L4", name: "original", version: "2.0.0" })
    ).json();

    const res = await app.request(`/v1/nodes/${created.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ name: "renamed" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.name).toBe("renamed");
    expect(data.type).toBe("Service");
    expect(data.layer).toBe("L4");
    expect(data.version).toBe("2.0.0");
    expect(data.lifecycleStatus).toBe("ACTIVE");
    expect(data.id).toBe(created.id);
  });

  it("updates version and leaves name unchanged", async () => {
    const { data: created } = await (
      await postNode({ type: "Module", layer: "L5", name: "stable-name" })
    ).json();

    const res = await app.request(`/v1/nodes/${created.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ version: "3.0.0" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.version).toBe("3.0.0");
    expect(data.name).toBe("stable-name");
  });

  it("updates attributes without affecting other fields", async () => {
    const { data: created } = await (
      await postNode({ type: "Service", layer: "L4", name: "attr-node" })
    ).json();

    const res = await app.request(`/v1/nodes/${created.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ attributes: { team: "backend", env: "prod" } }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.attributes).toEqual({ team: "backend", env: "prod" });
    expect(data.name).toBe("attr-node");
    expect(data.type).toBe("Service");
  });

  it("returns 404 for a nonexistent node ID", async () => {
    const res = await app.request(`/v1/nodes/${randomUUID()}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ name: "ghost" }),
    });
    expect(res.status).toBe(404);
  });
});

// ── POST /v1/edges ────────────────────────────────────────────────────────────

describe("POST /v1/edges — edit-flow smoke", () => {
  it("returns 201 with all schema fields and applies traversalWeight default of 1.0", async () => {
    const { data: src } = await (
      await postNode({ type: "Service", layer: "L4", name: "src" })
    ).json();
    const { data: tgt } = await (
      await postNode({ type: "Service", layer: "L4", name: "tgt" })
    ).json();

    const res = await postEdge({
      sourceId: src.id,
      targetId: tgt.id,
      type: "contains",
      layer: "L4",
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(typeof data.id).toBe("string");
    expect(data.sourceId).toBe(src.id);
    expect(data.targetId).toBe(tgt.id);
    expect(data.type).toBe("contains");
    expect(data.layer).toBe("L4");
    expect(data.traversalWeight).toBe(1);
    expect(typeof data.createdAt).toBe("string");
    expect(typeof data.updatedAt).toBe("string");
  });

  it("stores a custom traversalWeight when explicitly provided", async () => {
    const { data: src } = await (
      await postNode({ type: "Service", layer: "L4", name: "src-w" })
    ).json();
    const { data: tgt } = await (
      await postNode({ type: "Service", layer: "L4", name: "tgt-w" })
    ).json();

    const res = await postEdge({
      sourceId: src.id,
      targetId: tgt.id,
      type: "contains",
      layer: "L4",
      traversalWeight: 0.5,
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.traversalWeight).toBe(0.5);
  });

  it("returns 404 with source error message when sourceId does not exist", async () => {
    const { data: tgt } = await (
      await postNode({ type: "Service", layer: "L4", name: "tgt-only" })
    ).json();

    const res = await postEdge({
      sourceId: randomUUID(),
      targetId: tgt.id,
      type: "contains",
      layer: "L4",
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/source/);
  });
});

// ── PATCH /v1/edges/:id ───────────────────────────────────────────────────────

describe("PATCH /v1/edges/:id — edit-flow smoke", () => {
  async function createEdge(srcName: string, tgtName: string, type = "contains") {
    const { data: src } = await (
      await postNode({ type: "Service", layer: "L4", name: srcName })
    ).json();
    const { data: tgt } = await (
      await postNode({ type: "Service", layer: "L4", name: tgtName })
    ).json();
    const { data: edge } = await (
      await postEdge({ sourceId: src.id, targetId: tgt.id, type, layer: "L4" })
    ).json();
    return { src, tgt, edge };
  }

  it("updates type and leaves sourceId, targetId, and layer unchanged", async () => {
    const { src, tgt, edge } = await createEdge("s-type", "t-type");

    const res = await app.request(`/v1/edges/${edge.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ type: "depends-on" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.type).toBe("depends-on");
    expect(data.sourceId).toBe(src.id);
    expect(data.targetId).toBe(tgt.id);
    expect(data.layer).toBe("L4");
  });

  it("updates traversalWeight and leaves type unchanged", async () => {
    const { edge } = await createEdge("s-weight", "t-weight");

    const res = await app.request(`/v1/edges/${edge.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ traversalWeight: 3.5 }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.traversalWeight).toBe(3.5);
    expect(data.type).toBe("contains");
  });

  it("updates type and traversalWeight together", async () => {
    const { edge } = await createEdge("s-both", "t-both");

    const res = await app.request(`/v1/edges/${edge.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ type: "uses", traversalWeight: 2.0 }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.type).toBe("uses");
    expect(data.traversalWeight).toBe(2);
  });

  it("returns 404 for a nonexistent edge ID", async () => {
    const res = await app.request(`/v1/edges/${randomUUID()}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ traversalWeight: 1.0 }),
    });
    expect(res.status).toBe(404);
  });
});
