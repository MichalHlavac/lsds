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

// ── POST /v1/nodes ────────────────────────────────────────────────────────────

describe("POST /v1/nodes", () => {
  it("creates a node and returns 201 with the persisted row", async () => {
    const res = await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "auth-service" }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(typeof data.id).toBe("string");
    expect(data.type).toBe("Service");
    expect(data.layer).toBe("L4");
    expect(data.name).toBe("auth-service");
    expect(data.lifecycleStatus).toBe("ACTIVE");
  });

  it("returns 400 for a missing required field (type)", async () => {
    const res = await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ layer: "L4", name: "x" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("validation error");
  });

  it("returns 400 for an invalid layer value", async () => {
    const res = await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L9", name: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when x-tenant-id header is absent", async () => {
    const res = await app.request("/v1/nodes", {
      method: "POST",
      body: JSON.stringify({ type: "Service", layer: "L4", name: "x" }),
    });
    expect(res.status).toBe(400);
  });
});

// ── GET /v1/nodes ─────────────────────────────────────────────────────────────

describe("GET /v1/nodes", () => {
  it("returns 200 and lists all nodes for the tenant", async () => {
    await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "svc-a" }),
    });
    const res = await app.request("/v1/nodes", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data.every((n: any) => n.type !== undefined)).toBe(true);
  });

  it("returns empty array for a tenant with no nodes", async () => {
    const res = await app.request("/v1/nodes", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toEqual([]);
  });

  it("filters by type query param", async () => {
    await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Database", layer: "L3", name: "pg" }),
    });
    const res = await app.request("/v1/nodes?type=Database", { headers: h() });
    const { data } = await res.json();
    expect(data.every((n: any) => n.type === "Database")).toBe(true);
  });

  it("?q= filters nodes by name substring (case-insensitive)", async () => {
    await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "Authentication Service" }),
    });
    await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Database", layer: "L3", name: "Postgres" }),
    });

    const res = await app.request("/v1/nodes?q=auth", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].name).toBe("Authentication Service");
  });

  it("?q= filters nodes by type substring", async () => {
    await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "ServiceMesh", layer: "L4", name: "istio" }),
    });
    await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Database", layer: "L3", name: "pg" }),
    });

    const res = await app.request("/v1/nodes?q=Mesh", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].type).toBe("ServiceMesh");
  });

  it("?q= returns empty array when nothing matches", async () => {
    await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "foo" }),
    });

    const res = await app.request("/v1/nodes?q=zzznomatch", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toEqual([]);
  });
});

// ── GET /v1/nodes ?sortBy / ?order ────────────────────────────────────────────

describe("GET /v1/nodes sortBy + order", () => {
  it("accepts valid sortBy=name&order=asc and returns 200", async () => {
    await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "bravo" }),
    });
    await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "alpha" }),
    });

    const res = await app.request("/v1/nodes?sortBy=name&order=asc", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(Array.isArray(data)).toBe(true);
    const names = data.map((n: any) => n.name);
    expect(names).toEqual([...names].sort());
  });

  it("returns nodes in descending name order when order=desc", async () => {
    await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "alpha" }),
    });
    await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "zebra" }),
    });

    const res = await app.request("/v1/nodes?sortBy=name&order=desc", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const names = data.map((n: any) => n.name);
    expect(names).toEqual([...names].sort().reverse());
  });

  it("returns 400 for invalid sortBy value", async () => {
    const res = await app.request("/v1/nodes?sortBy=INVALID_FIELD", { headers: h() });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid sortBy/);
  });

  it("returns 400 for invalid order value", async () => {
    const res = await app.request("/v1/nodes?order=sideways", { headers: h() });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid order/);
  });

  it("combines sortBy with existing type filter", async () => {
    await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Database", layer: "L3", name: "pg" }),
    });
    await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Database", layer: "L3", name: "mysql" }),
    });
    await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "api" }),
    });

    const res = await app.request("/v1/nodes?type=Database&sortBy=name&order=asc", { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.every((n: any) => n.type === "Database")).toBe(true);
    const names = data.map((n: any) => n.name);
    expect(names).toEqual([...names].sort());
  });
});

// ── GET /v1/nodes/:id ─────────────────────────────────────────────────────────

describe("GET /v1/nodes/:id", () => {
  it("returns 200 and the node when it exists", async () => {
    const createRes = await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "my-node" }),
    });
    const { data: created } = await createRes.json();

    const res = await app.request(`/v1/nodes/${created.id}`, { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.id).toBe(created.id);
    expect(data.name).toBe("my-node");
  });

  it("returns 404 for a nonexistent node ID", async () => {
    const res = await app.request(`/v1/nodes/${randomUUID()}`, { headers: h() });
    expect(res.status).toBe(404);
  });
});

// ── PATCH /v1/nodes/:id ───────────────────────────────────────────────────────

describe("PATCH /v1/nodes/:id", () => {
  it("updates name and returns the updated row", async () => {
    const createRes = await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "old-name" }),
    });
    const { data: created } = await createRes.json();

    const res = await app.request(`/v1/nodes/${created.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ name: "new-name" }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.name).toBe("new-name");
  });

  it("returns 404 for a nonexistent node ID", async () => {
    const res = await app.request(`/v1/nodes/${randomUUID()}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ name: "x" }),
    });
    expect(res.status).toBe(404);
  });
});

// ── DELETE /v1/nodes/:id ──────────────────────────────────────────────────────

describe("DELETE /v1/nodes/:id", () => {
  it("deletes the node and returns its id", async () => {
    const createRes = await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "doomed" }),
    });
    const { data: created } = await createRes.json();

    const delRes = await app.request(`/v1/nodes/${created.id}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(delRes.status).toBe(200);
    expect((await delRes.json()).data.id).toBe(created.id);

    // confirm gone
    const getRes = await app.request(`/v1/nodes/${created.id}`, { headers: h() });
    expect(getRes.status).toBe(404);
  });

  it("returns 404 for a nonexistent node ID", async () => {
    const res = await app.request(`/v1/nodes/${randomUUID()}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(404);
  });
});

// ── PUT /v1/nodes (upsert) ────────────────────────────────────────────────────

describe("PUT /v1/nodes", () => {
  it("creates a new node and returns 201 when it does not exist", async () => {
    const res = await app.request("/v1/nodes", {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "upsert-svc", attributes: { owner: "team-a" } }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.name).toBe("upsert-svc");
    expect(typeof data.id).toBe("string");
  });

  it("returns 200 with the same ID on a second PUT for the same key", async () => {
    const first = await app.request("/v1/nodes", {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "stable-svc" }),
    });
    const { data: created } = await first.json();

    const second = await app.request("/v1/nodes", {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "stable-svc", attributes: { updated: true } }),
    });
    expect(second.status).toBe(200);
    const { data: updated } = await second.json();
    expect(updated.id).toBe(created.id);
    expect(updated.attributes).toEqual({ updated: true });
  });

  it("is safe to call many times — node count stays at 1", async () => {
    for (let i = 0; i < 3; i++) {
      await app.request("/v1/nodes", {
        method: "PUT",
        headers: h(),
        body: JSON.stringify({ type: "Service", layer: "L4", name: "idempotent-svc" }),
      });
    }
    const listRes = await app.request("/v1/nodes?type=Service", { headers: h() });
    const { data } = await listRes.json();
    const matches = data.filter((n: any) => n.name === "idempotent-svc");
    expect(matches).toHaveLength(1);
  });

  it("returns 400 for a missing required field", async () => {
    const res = await app.request("/v1/nodes", {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({ layer: "L4", name: "x" }),
    });
    expect(res.status).toBe(400);
  });
});

// ── POST /v1/nodes duplicate → 409 ───────────────────────────────────────────

describe("POST /v1/nodes duplicate", () => {
  it("returns 409 when a node with the same type+layer+name already exists", async () => {
    await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "duplicate-svc" }),
    });
    const res = await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "duplicate-svc" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already exists/);
  });
});

// ── GET /v1/nodes/:id/neighbors ───────────────────────────────────────────────

describe("GET /v1/nodes/:id/neighbors", () => {
  it("returns 200 with outbound and inbound arrays", async () => {
    const createRes = await app.request("/v1/nodes", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "isolated" }),
    });
    const { data: node } = await createRes.json();

    const res = await app.request(`/v1/nodes/${node.id}/neighbors`, { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(Array.isArray(data.outbound)).toBe(true);
    expect(Array.isArray(data.inbound)).toBe(true);
    expect(data.outbound).toHaveLength(0);
    expect(data.inbound).toHaveLength(0);
  });
});
