// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant } from "./test-helpers";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

async function createNode(layer: string, type = "Service", name = randomUUID()) {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ type, layer, name }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).data;
}

beforeEach(() => { tid = randomUUID(); });
afterEach(async () => { await cleanTenant(sql, tid); });

// ── GET /v1/layers ────────────────────────────────────────────────────────────

describe("GET /v1/layers", () => {
  it("returns empty data when tenant has no nodes", async () => {
    const res = await app.request("/v1/layers", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toEqual([]);
  });

  it("returns distinct layers with node counts", async () => {
    await createNode("L1");
    await createNode("L1");
    await createNode("L3");

    const res = await app.request("/v1/layers", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.length).toBe(2);
    const l1 = data.find((r: { layer: string }) => r.layer === "L1");
    const l3 = data.find((r: { layer: string }) => r.layer === "L3");
    expect(l1.nodeCount).toBe(2);
    expect(l3.nodeCount).toBe(1);
  });

  it("is tenant-scoped (no cross-tenant leakage)", async () => {
    await createNode("L2");
    const otherTid = randomUUID();
    try {
      const res = await app.request("/v1/layers", {
        headers: { "content-type": "application/json", "x-tenant-id": otherTid },
      });
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data).toEqual([]);
    } finally {
      await cleanTenant(sql, otherTid);
    }
  });

  it("returns 400 when x-tenant-id header is absent", async () => {
    const res = await app.request("/v1/layers");
    expect(res.status).toBe(400);
  });
});

// ── GET /v1/layers/:layer ─────────────────────────────────────────────────────

describe("GET /v1/layers/:layer", () => {
  it("returns nodes for the given layer", async () => {
    const n = await createNode("L4");
    await createNode("L2");

    const res = await app.request("/v1/layers/L4", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].id).toBe(n.id);
    expect(data[0].layer).toBe("L4");
  });

  it("returns empty data when no nodes exist for that layer", async () => {
    await createNode("L1");
    const res = await app.request("/v1/layers/L6", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toEqual([]);
  });

  it("returns 400 for an invalid layer value", async () => {
    const res = await app.request("/v1/layers/L9", { headers: h() });
    expect(res.status).toBe(400);
  });

  it("filters by type query param", async () => {
    await createNode("L5", "Service");
    await createNode("L5", "Database");

    const res = await app.request("/v1/layers/L5?type=Service", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].type).toBe("Service");
  });

  it("filters by lifecycleStatus query param", async () => {
    const n = await createNode("L2", "Service", "active-node");
    await app.request(`/v1/nodes/${n.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "deprecate" }),
    });

    const activeRes = await app.request("/v1/layers/L2?lifecycleStatus=ACTIVE", { headers: h() });
    expect((await activeRes.json()).data.length).toBe(0);

    const depRes = await app.request("/v1/layers/L2?lifecycleStatus=DEPRECATED", { headers: h() });
    expect((await depRes.json()).data.length).toBe(1);
  });

  it("is tenant-scoped", async () => {
    await createNode("L3");
    const otherTid = randomUUID();
    try {
      const res = await app.request("/v1/layers/L3", {
        headers: { "content-type": "application/json", "x-tenant-id": otherTid },
      });
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data).toEqual([]);
    } finally {
      await cleanTenant(sql, otherTid);
    }
  });

  it("returns 400 when x-tenant-id header is absent", async () => {
    const res = await app.request("/v1/layers/L1");
    expect(res.status).toBe(400);
  });
});
