// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant, createTestTenant } from "./test-helpers";
import type { EdgeRow } from "../src/db/types";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

beforeEach(async () => { tid = randomUUID(); await createTestTenant(sql, tid); });
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

  it("returns 400 when the relationship type is not in the registry", async () => {
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
    expect(res.status).toBe(400);
  });

  // ── GR-XL-003 cross-layer negative-path tests ─────────────────────────────
  // Each test exercises a relationship type that is tightly layer-constrained
  // and verifies the prescriptive engine rejects it synchronously with a 422
  // violations array (as required by the v2 acceptance criteria).

  it("GR-XL-003: context-integration requires L2↔L2 — rejects L1→L3", async () => {
    const src = await createNode("L1", "biz-goal");
    const tgt = await createNode("L3", "arch-component");
    const res = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: src.id, targetId: tgt.id, type: "context-integration", layer: "L1" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("invalid edge");
    expect(body.violations[0].ruleKey).toBe("GR-XL-003");
  });

  it("GR-XL-003: calls requires L4/L5 → L4 — rejects L1→L6", async () => {
    const src = await createNode("L1", "biz-cap");
    const tgt = await createNode("L6", "infra");
    const res = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: src.id, targetId: tgt.id, type: "calls", layer: "L1" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.violations[0].ruleKey).toBe("GR-XL-003");
  });

  it("GR-XL-003: deploys-to requires L4/L5 → L6 — rejects L1→L2", async () => {
    const src = await createNode("L1", "req");
    const tgt = await createNode("L2", "bounded-ctx");
    const res = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: src.id, targetId: tgt.id, type: "deploys-to", layer: "L1" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.violations[0].ruleKey).toBe("GR-XL-003");
  });

  it("GR-XL-003: publishes requires L4↔L4 — rejects L2→L5", async () => {
    const src = await createNode("L2", "domain-event");
    const tgt = await createNode("L5", "code-module");
    const res = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: src.id, targetId: tgt.id, type: "publishes", layer: "L2" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.violations[0].ruleKey).toBe("GR-XL-003");
  });

  it("GR-XL-003: covers requires L6 source — rejects L1→L4", async () => {
    const src = await createNode("L1", "biz-goal");
    const tgt = await createNode("L4", "svc");
    const res = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: src.id, targetId: tgt.id, type: "covers", layer: "L1" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.violations[0].ruleKey).toBe("GR-XL-003");
  });

  it("GR-XL-003: realizes ordinal constraint (source must be >= target) — rejects L1→L6", async () => {
    const src = await createNode("L1", "biz-goal");
    const tgt = await createNode("L6", "infra");
    const res = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: src.id, targetId: tgt.id, type: "realizes", layer: "L1" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.violations[0].ruleKey).toBe("GR-XL-003");
  });

  it("returns 409 when the same edge already exists", async () => {
    const src = await createNode("L4", "dup-src");
    const tgt = await createNode("L4", "dup-tgt");
    await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: src.id, targetId: tgt.id, type: "contains", layer: "L4" }),
    });
    const res = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: src.id, targetId: tgt.id, type: "contains", layer: "L4" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already exists/);
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

// ── PUT /v1/edges (upsert) ────────────────────────────────────────────────────

describe("PUT /v1/edges", () => {
  it("creates a new edge and returns 201 when it does not exist", async () => {
    const src = await createNode("L4", "put-src");
    const tgt = await createNode("L4", "put-tgt");
    const res = await app.request("/v1/edges", {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({ sourceId: src.id, targetId: tgt.id, type: "contains", layer: "L4" }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.type).toBe("contains");
    expect(typeof data.id).toBe("string");
  });

  it("returns 200 with the same ID on a second PUT for the same key", async () => {
    const src = await createNode("L4", "put-src2");
    const tgt = await createNode("L4", "put-tgt2");
    const first = await app.request("/v1/edges", {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({ sourceId: src.id, targetId: tgt.id, type: "contains", layer: "L4", traversalWeight: 1.0 }),
    });
    const { data: created } = await first.json();

    const second = await app.request("/v1/edges", {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({ sourceId: src.id, targetId: tgt.id, type: "contains", layer: "L4", traversalWeight: 2.5 }),
    });
    expect(second.status).toBe(200);
    const { data: updated } = await second.json();
    expect(updated.id).toBe(created.id);
    expect(updated.traversalWeight).toBe(2.5);
  });

  it("is safe to call many times — edge count stays at 1", async () => {
    const src = await createNode("L4", "idem-src");
    const tgt = await createNode("L4", "idem-tgt");
    for (let i = 0; i < 3; i++) {
      await app.request("/v1/edges", {
        method: "PUT",
        headers: h(),
        body: JSON.stringify({ sourceId: src.id, targetId: tgt.id, type: "contains", layer: "L4" }),
      });
    }
    const listRes = await app.request(`/v1/edges?sourceId=${src.id}`, { headers: h() });
    const { data } = await listRes.json();
    expect(data).toHaveLength(1);
  });

  it("GR-XL-003: returns 422 violations array for invalid cross-layer edge", async () => {
    // context-integration requires L2↔L2; L1→L3 violates source layer and ordinal
    const src = await createNode("L1", "put-biz-goal");
    const tgt = await createNode("L3", "put-arch-cmp");
    const res = await app.request("/v1/edges", {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({ sourceId: src.id, targetId: tgt.id, type: "context-integration", layer: "L1" }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("invalid edge");
    expect(Array.isArray(body.violations)).toBe(true);
    expect(body.violations[0].ruleKey).toBe("GR-XL-003");
    expect(body.violations[0].severity).toBe("ERROR");
    expect(typeof body.violations[0].message).toBe("string");
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

// ── GET /v1/edges ?sortBy / ?order ────────────────────────────────────────────

describe("GET /v1/edges sortBy + order", () => {
  it("accepts valid sortBy=type&order=asc and returns 200", async () => {
    const src = await createNode("L4", "s");
    const tgt = await createNode("L4", "t");
    await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: src.id, targetId: tgt.id, type: "contains", layer: "L4" }),
    });

    const res = await app.request("/v1/edges?sortBy=type&order=asc", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
  });

  it("returns 400 for invalid sortBy value", async () => {
    const res = await app.request("/v1/edges?sortBy=INVALID_FIELD", { headers: h() });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid sortBy/);
  });

  it("returns 400 for invalid order value", async () => {
    const res = await app.request("/v1/edges?order=sideways", { headers: h() });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid order/);
  });

  it("combines sortBy with existing sourceId filter", async () => {
    const src = await createNode("L4", "s");
    const tgt1 = await createNode("L4", "t1");
    const tgt2 = await createNode("L4", "t2");
    await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: src.id, targetId: tgt1.id, type: "contains", layer: "L4" }),
    });
    await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: src.id, targetId: tgt2.id, type: "contains", layer: "L4" }),
    });

    const res = await app.request(`/v1/edges?sourceId=${src.id}&sortBy=createdAt&order=asc`, { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.every((e: EdgeRow) => e.sourceId === src.id)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(2);
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
    const orig = process.env.LIFECYCLE_RETENTION_DAYS;
    process.env.LIFECYCLE_RETENTION_DAYS = "0";
    try {
      const src = await createNode("L4", "s");
      const tgt = await createNode("L4", "t");
      const createRes = await app.request("/v1/edges", {
        method: "POST",
        headers: h(),
        body: JSON.stringify({ sourceId: src.id, targetId: tgt.id, type: "contains", layer: "L4" }),
      });
      const { data: created } = await createRes.json();

      // lifecycle enforcement: must archive before purge
      await app.request(`/v1/edges/${created.id}/lifecycle`, {
        method: "PATCH", headers: h(), body: JSON.stringify({ transition: "deprecate" }),
      });
      await app.request(`/v1/edges/${created.id}/lifecycle`, {
        method: "PATCH", headers: h(), body: JSON.stringify({ transition: "archive" }),
      });

      const res = await app.request(`/v1/edges/${created.id}`, {
        method: "DELETE",
        headers: h(),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).data.id).toBe(created.id);
    } finally {
      if (orig === undefined) delete process.env.LIFECYCLE_RETENTION_DAYS;
      else process.env.LIFECYCLE_RETENTION_DAYS = orig;
    }
  });

  it("returns 404 for a nonexistent edge ID", async () => {
    const res = await app.request(`/v1/edges/${randomUUID()}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(404);
  });
});

// ── GET /v1/edges — cursor pagination ────────────────────────────────────────

describe("GET /v1/edges cursor pagination", () => {
  it("first page has nextCursor when there are more rows", async () => {
    const nodes = await Promise.all([0, 1, 2].map((i) => createNode("L4", `cpn-${i}`)));
    await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: nodes[0].id, targetId: nodes[1].id, type: "contains", layer: "L4" }),
    });
    await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: nodes[1].id, targetId: nodes[2].id, type: "contains", layer: "L4" }),
    });

    const res = await app.request("/v1/edges?limit=1", { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(typeof body.nextCursor).toBe("string");
  });

  it("last page returns nextCursor: null", async () => {
    const nodes = await Promise.all([0, 1].map((i) => createNode("L4", `lpn-${i}`)));
    await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: nodes[0].id, targetId: nodes[1].id, type: "contains", layer: "L4" }),
    });

    const res = await app.request("/v1/edges?limit=10", { headers: h() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nextCursor).toBeNull();
  });

  it("fetching with nextCursor returns correct next page (no overlap, no gap)", async () => {
    const nodes = await Promise.all([0, 1, 2, 3].map((i) => createNode("L4", `ppn-${i}`)));
    for (let i = 0; i < 3; i++) {
      await app.request("/v1/edges", {
        method: "POST",
        headers: h(),
        body: JSON.stringify({ sourceId: nodes[i].id, targetId: nodes[i + 1].id, type: "contains", layer: "L4" }),
      });
    }

    const page1Res = await app.request("/v1/edges?limit=2", { headers: h() });
    const page1 = await page1Res.json();
    expect(page1.data).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2Res = await app.request(`/v1/edges?limit=2&cursor=${page1.nextCursor}`, { headers: h() });
    const page2 = await page2Res.json();
    expect(page2.data).toHaveLength(1);

    const allIds = [...page1.data.map((e: any) => e.id), ...page2.data.map((e: any) => e.id)];
    expect(new Set(allIds).size).toBe(3);
  });

  it("?count=true includes totalCount; without it, totalCount is absent", async () => {
    const nodes = await Promise.all([0, 1].map((i) => createNode("L4", `cen-${i}`)));
    await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: nodes[0].id, targetId: nodes[1].id, type: "contains", layer: "L4" }),
    });

    const withCount = await (await app.request("/v1/edges?count=true", { headers: h() })).json();
    expect(typeof withCount.totalCount).toBe("number");
    expect(withCount.totalCount).toBe(1);

    const withoutCount = await (await app.request("/v1/edges", { headers: h() })).json();
    expect(withoutCount.totalCount).toBeUndefined();
  });

  it("cursor + ?type= filter: all pages return only matching edges", async () => {
    const nodes = await Promise.all([0, 1, 2, 3, 4].map((i) => createNode("L4", `fe-n-${i}`)));
    for (let i = 0; i < 3; i++) {
      await app.request("/v1/edges", {
        method: "POST",
        headers: h(),
        body: JSON.stringify({ sourceId: nodes[i].id, targetId: nodes[i + 1].id, type: "contains", layer: "L4" }),
      });
    }
    await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: nodes[3].id, targetId: nodes[4].id, type: "calls", layer: "L4" }),
    });
    await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: nodes[0].id, targetId: nodes[4].id, type: "calls", layer: "L4" }),
    });

    const page1Res = await app.request("/v1/edges?limit=2&type=contains", { headers: h() });
    const page1 = await page1Res.json();
    expect(page1.data).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    expect(page1.data.every((e: any) => e.type === "contains")).toBe(true);

    const page2Res = await app.request(`/v1/edges?limit=2&type=contains&cursor=${page1.nextCursor}`, { headers: h() });
    const page2 = await page2Res.json();
    expect(page2.data).toHaveLength(1);
    expect(page2.data.every((e: any) => e.type === "contains")).toBe(true);

    const allIds = [...page1.data.map((e: any) => e.id), ...page2.data.map((e: any) => e.id)];
    expect(new Set(allIds).size).toBe(3);
  });

  it("cursor from ?type=contains context reused with ?type=calls: returns 200, only calls edges in response", async () => {
    const nodes = await Promise.all([0, 1, 2, 3].map((i) => createNode("L4", `fctx-n-${i}`)));
    for (let i = 0; i < 2; i++) {
      await app.request("/v1/edges", {
        method: "POST",
        headers: h(),
        body: JSON.stringify({ sourceId: nodes[i].id, targetId: nodes[i + 1].id, type: "contains", layer: "L4" }),
      });
    }
    await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: nodes[2].id, targetId: nodes[3].id, type: "calls", layer: "L4" }),
    });
    await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: nodes[0].id, targetId: nodes[3].id, type: "calls", layer: "L4" }),
    });

    const page1Res = await app.request("/v1/edges?limit=1&type=contains", { headers: h() });
    const page1 = await page1Res.json();
    expect(page1.nextCursor).not.toBeNull();

    // Current behavior: type filter is always applied; cursor origin does not bypass the filter
    const crossRes = await app.request(`/v1/edges?limit=10&type=calls&cursor=${page1.nextCursor}`, { headers: h() });
    expect(crossRes.status).toBe(200);
    const cross = await crossRes.json();
    expect(cross.data.every((e: any) => e.type === "calls")).toBe(true);
  });
});
