// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant } from "./test-helpers";
import type { ContextPackage } from "@lsds/framework";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

beforeEach(() => { tid = randomUUID(); });
afterEach(async () => { await cleanTenant(sql, tid); });

async function createNode(layer: string, name: string, type = "Service") {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ type, layer, name }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).data as { id: string; name: string };
}

async function createEdge(sourceId: string, targetId: string, type = "contains") {
  const res = await app.request("/v1/edges", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ sourceId, targetId, type, layer: "L4" }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).data;
}

// ── GET /agent/v1/context/:nodeId ─────────────────────────────────────────────

describe("GET /agent/v1/context/:nodeId", () => {
  it("returns 404 for unknown node", async () => {
    const res = await app.request(`/agent/v1/context/${randomUUID()}`, {
      headers: h(),
    });
    expect(res.status).toBe(404);
  });

  it("returns a ContextPackage for an isolated node", async () => {
    const node = await createNode("L4", "payment-service");
    const res = await app.request(`/agent/v1/context/${node.id}`, {
      headers: h(),
    });
    expect(res.status).toBe(200);
    const { data, cached } = (await res.json()) as { data: ContextPackage; cached: boolean };
    expect(cached).toBe(false);
    expect(data.profile).toBe("OPERATIONAL");
    expect(data.root.id).toBe(node.id);
    expect(data.root.name).toBe("payment-service");
    expect(data.upward).toEqual([]);
    expect(data.downward).toEqual([]);
    expect(data.lateral).toEqual([]);
    expect(typeof data.estimatedTokens).toBe("number");
    expect(data.truncation.truncated).toBe(false);
  });

  it("returns cached result on second identical request", async () => {
    const node = await createNode("L4", "cache-test");
    await app.request(`/agent/v1/context/${node.id}`, { headers: h() });
    const res2 = await app.request(`/agent/v1/context/${node.id}`, { headers: h() });
    expect(res2.status).toBe(200);
    expect((await res2.json()).cached).toBe(true);
  });

  it("discovers downward neighbor via contains edge", async () => {
    const parent = await createNode("L4", "parent");
    const child = await createNode("L4", "child");
    // parent --contains--> child (downward)
    await createEdge(parent.id, child.id, "contains");

    const res = await app.request(`/agent/v1/context/${parent.id}`, { headers: h() });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: ContextPackage };
    const downwardIds = data.downward.map((c) => c.id);
    expect(downwardIds).toContain(child.id);
  });

  it("discovers upward neighbor via part-of edge (incoming contains)", async () => {
    const parent = await createNode("L4", "domain");
    const child = await createNode("L4", "subdomain");
    // parent --contains--> child means child sees parent as upward
    await createEdge(parent.id, child.id, "contains");

    const res = await app.request(`/agent/v1/context/${child.id}`, { headers: h() });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: ContextPackage };
    const upwardIds = data.upward.map((c) => c.id);
    expect(upwardIds).toContain(parent.id);
  });

  it("respects ?profile=ANALYTICAL to widen lifecycle filter", async () => {
    const node = await createNode("L4", "analytical-root");
    const res = await app.request(`/agent/v1/context/${node.id}?profile=ANALYTICAL`, {
      headers: h(),
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: ContextPackage };
    expect(data.profile).toBe("ANALYTICAL");
  });

  it("respects ?profile=FULL", async () => {
    const node = await createNode("L4", "full-root");
    const res = await app.request(`/agent/v1/context/${node.id}?profile=FULL`, {
      headers: h(),
    });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: ContextPackage };
    expect(data.profile).toBe("FULL");
  });

  it("returns 400 for invalid profile", async () => {
    const node = await createNode("L4", "bad-profile");
    const res = await app.request(`/agent/v1/context/${node.id}?profile=BOGUS`, {
      headers: h(),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid profile/);
  });

  it("returns 400 for non-positive tokenBudget", async () => {
    const node = await createNode("L4", "bad-budget");
    const res = await app.request(`/agent/v1/context/${node.id}?tokenBudget=-1`, {
      headers: h(),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/tokenBudget/);
  });

  it("respects ?tokenBudget and reports truncation when budget forces drops", async () => {
    const root = await createNode("L4", "root");
    // 6 children → downward bucket has 6 entries; a small budget should drop some
    const children = await Promise.all(
      Array.from({ length: 6 }, (_, i) => createNode("L4", `child-${i}`))
    );
    await Promise.all(children.map((c) => createEdge(root.id, c.id, "contains")));

    // First, fetch without a budget to get the baseline token count.
    const baseRes = await app.request(`/agent/v1/context/${root.id}`, { headers: h() });
    const { data: base } = (await baseRes.json()) as { data: ContextPackage };

    // Then fetch with a budget tighter than baseline but above the irreducible minimum.
    const tightBudget = Math.ceil(base.estimatedTokens / 2);
    const res = await app.request(
      `/agent/v1/context/${root.id}?tokenBudget=${tightBudget}`,
      { headers: h() }
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: ContextPackage };
    expect(data.estimatedTokens).toBeLessThanOrEqual(tightBudget);
    expect(data.truncation.truncated).toBe(true);
    expect(data.truncation.omitted.downward).toBeGreaterThan(0);
  });

  it("returns 400 when x-tenant-id header is missing", async () => {
    const res = await app.request(`/agent/v1/context/${randomUUID()}`, {});
    expect(res.status).toBe(400);
  });
});
