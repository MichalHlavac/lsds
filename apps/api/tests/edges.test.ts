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

async function createNode(layer: string, name: string) {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ type: "Service", layer, name }),
  });
  return (await res.json()).data;
}

// ── POST /v1/edges ────────────────────────────────────────────────────────────

describe("POST /v1/edges", () => {
  it("creates an edge between two existing nodes and returns 201", async () => {
    // "contains" allows ALL_LAYERS → ALL_LAYERS with SOURCE_LTE_TARGET;
    // L4 → L4 satisfies 4 ≤ 4.
    const src = await createNode("L4", "parent");
    const tgt = await createNode("L4", "child");

    const res = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        sourceId: src.id,
        targetId: tgt.id,
        type: "contains",
        layer: "L4",
      }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.sourceId).toBe(src.id);
    expect(data.targetId).toBe(tgt.id);
    expect(data.type).toBe("contains");
  });

  it("returns 404 when the source node does not exist", async () => {
    const tgt = await createNode("L4", "target");
    const res = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        sourceId: randomUUID(),
        targetId: tgt.id,
        type: "contains",
        layer: "L4",
      }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/source/);
  });

  it("returns 404 when the target node does not exist", async () => {
    const src = await createNode("L4", "source");
    const res = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        sourceId: src.id,
        targetId: randomUUID(),
        type: "contains",
        layer: "L4",
      }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/target/);
  });

  it("returns 422 when the relationship type is not registered", async () => {
    const src = await createNode("L4", "a");
    const tgt = await createNode("L4", "b");
    const res = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        sourceId: src.id,
        targetId: tgt.id,
        type: "TOTALLY_UNKNOWN_TYPE",
        layer: "L4",
      }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("invalid edge");
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it("returns 400 for non-UUID sourceId", async () => {
    const res = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        sourceId: "not-a-uuid",
        targetId: randomUUID(),
        type: "contains",
        layer: "L4",
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ── GET /v1/edges ──────────────────────────────────────────────────────────────

describe("GET /v1/edges", () => {
  it("returns 200 and lists edges for the tenant", async () => {
    const src = await createNode("L4", "s");
    const tgt = await createNode("L4", "t");
    await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: src.id, targetId: tgt.id, type: "contains", layer: "L4" }),
    });

    const res = await app.request("/v1/edges", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
  });

  it("?q= filters edges by type substring (case-insensitive)", async () => {
    const a = await createNode("L4", "a");
    const b = await createNode("L4", "b");
    const c2 = await createNode("L4", "c");

    await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: a.id, targetId: b.id, type: "contains", layer: "L4" }),
    });
    await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: b.id, targetId: c2.id, type: "uses", layer: "L4" }),
    });

    const res = await app.request("/v1/edges?q=con", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].type).toBe("contains");
  });

  it("?q= returns empty array when nothing matches", async () => {
    const a = await createNode("L4", "a");
    const b = await createNode("L4", "b");
    await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: a.id, targetId: b.id, type: "contains", layer: "L4" }),
    });

    const res = await app.request("/v1/edges?q=zzznomatch", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toEqual([]);
  });
});

// ── GET /v1/edges/:id ─────────────────────────────────────────────────────────

describe("GET /v1/edges/:id", () => {
  it("returns 200 and the edge when it exists", async () => {
    const src = await createNode("L4", "s");
    const tgt = await createNode("L4", "t");
    const createRes = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: src.id, targetId: tgt.id, type: "contains", layer: "L4" }),
    });
    const { data: created } = await createRes.json();

    const res = await app.request(`/v1/edges/${created.id}`, { headers: h() });
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe(created.id);
  });

  it("returns 404 for a nonexistent edge ID", async () => {
    const res = await app.request(`/v1/edges/${randomUUID()}`, { headers: h() });
    expect(res.status).toBe(404);
  });
});

// ── PATCH /v1/edges/:id ───────────────────────────────────────────────────────

describe("PATCH /v1/edges/:id", () => {
  it("updates traversalWeight and returns the updated row", async () => {
    const src = await createNode("L4", "s");
    const tgt = await createNode("L4", "t");
    const createRes = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: src.id, targetId: tgt.id, type: "contains", layer: "L4" }),
    });
    const { data: created } = await createRes.json();

    const res = await app.request(`/v1/edges/${created.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ traversalWeight: 5.0 }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.traversalWeight).toBe(5.0);
  });

  it("returns 404 for a nonexistent edge ID", async () => {
    const res = await app.request(`/v1/edges/${randomUUID()}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ traversalWeight: 2.0 }),
    });
    expect(res.status).toBe(404);
  });
});

// ── DELETE /v1/edges/:id ──────────────────────────────────────────────────────

describe("DELETE /v1/edges/:id", () => {
  it("deletes the edge and returns its id", async () => {
    const src = await createNode("L4", "s");
    const tgt = await createNode("L4", "t");
    const createRes = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: src.id, targetId: tgt.id, type: "contains", layer: "L4" }),
    });
    const { data: created } = await createRes.json();

    const res = await app.request(`/v1/edges/${created.id}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe(created.id);
  });

  it("returns 404 for a nonexistent edge ID", async () => {
    const res = await app.request(`/v1/edges/${randomUUID()}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(404);
  });
});
