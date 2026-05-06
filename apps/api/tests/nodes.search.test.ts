// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant } from "./test-helpers";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

const searchUrl = (attrs: Record<string, unknown>, opts: { type?: string; limit?: number } = {}) => {
  const qs = new URLSearchParams({ attributes: JSON.stringify(attrs) });
  if (opts.type) qs.set("type", opts.type);
  if (opts.limit != null) qs.set("limit", String(opts.limit));
  return `/v1/nodes/search?${qs.toString()}`;
};

async function createNode(overrides: {
  type?: string;
  layer?: string;
  name: string;
  attributes?: Record<string, unknown>;
}) {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({
      type: overrides.type ?? "Service",
      layer: overrides.layer ?? "L3",
      name: overrides.name,
      attributes: overrides.attributes ?? {},
    }),
  });
  expect(res.status).toBe(201);
  const { data } = await res.json();
  return data;
}

beforeEach(() => { tid = randomUUID(); });
afterEach(async () => { await cleanTenant(sql, tid); });

// ── GET /v1/nodes/search ──────────────────────────────────────────────────────

describe("GET /v1/nodes/search — positive match", () => {
  it("returns nodes whose attributes contain all specified key-value pairs", async () => {
    await createNode({ name: "payments-svc", attributes: { owner: "team-payments", env: "prod" } });
    await createNode({ name: "auth-svc", attributes: { owner: "team-auth", env: "prod" } });

    const res = await app.request(searchUrl({ owner: "team-payments" }), { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("payments-svc");
  });

  it("matches on nested attribute value", async () => {
    await createNode({ name: "billing", attributes: { team: { id: "t-1", name: "Billing" } } });
    await createNode({ name: "shipping", attributes: { team: { id: "t-2", name: "Shipping" } } });

    const res = await app.request(searchUrl({ team: { id: "t-1" } }), { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("billing");
  });

  it("returns multiple matches when several nodes contain the attribute", async () => {
    await createNode({ name: "svc-a", attributes: { criticality: "CRITICAL" } });
    await createNode({ name: "svc-b", attributes: { criticality: "CRITICAL", region: "us-east-1" } });
    await createNode({ name: "svc-c", attributes: { criticality: "LOW" } });

    const res = await app.request(searchUrl({ criticality: "CRITICAL" }), { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toHaveLength(2);
    const names = data.map((n: { name: string }) => n.name).sort();
    expect(names).toEqual(["svc-a", "svc-b"]);
  });

  it("applies optional nodeType filter", async () => {
    await createNode({ type: "Service", name: "api-gw", attributes: { env: "prod" } });
    await createNode({ type: "BoundedContext", layer: "L2", name: "payments-ctx", attributes: { env: "prod" } });

    const res = await app.request(searchUrl({ env: "prod" }, { type: "Service" }), { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].type).toBe("Service");
  });

  it("respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await createNode({ name: `svc-${i}`, attributes: { tag: "batch" } });
    }
    const res = await app.request(searchUrl({ tag: "batch" }, { limit: 2 }), { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toHaveLength(2);
  });
});

describe("GET /v1/nodes/search — negative match", () => {
  it("returns empty array when no nodes match", async () => {
    await createNode({ name: "some-svc", attributes: { owner: "team-x" } });

    const res = await app.request(searchUrl({ owner: "team-nonexistent" }), { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toHaveLength(0);
  });

  it("returns empty array when type filter excludes all matches", async () => {
    await createNode({ type: "Service", name: "svc", attributes: { flag: true } });

    const res = await app.request(searchUrl({ flag: true }, { type: "BoundedContext" }), { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toHaveLength(0);
  });
});

describe("GET /v1/nodes/search — input validation", () => {
  it("returns 400 when attributes param is missing", async () => {
    const res = await app.request("/v1/nodes/search", { headers: h() });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/attributes/i);
  });

  it("returns 400 when attributes param is not valid JSON", async () => {
    const res = await app.request("/v1/nodes/search?attributes=not-json", { headers: h() });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/valid JSON/i);
  });

  it("returns 400 when attributes is JSON but not a record (array)", async () => {
    const res = await app.request(
      `/v1/nodes/search?attributes=${encodeURIComponent(JSON.stringify([1, 2]))}`,
      { headers: h() }
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when limit exceeds maximum of 500", async () => {
    const res = await app.request(searchUrl({ x: 1 }, { limit: 501 }), { headers: h() });
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/nodes/search — tenant isolation (A6)", () => {
  it("never returns nodes from a different tenant", async () => {
    // Create a node under a DIFFERENT tenant
    const otherTid = randomUUID();
    await app.request("/v1/nodes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": otherTid },
      body: JSON.stringify({ type: "Service", layer: "L3", name: "other-svc", attributes: { flag: "shared" } }),
    });

    // Search under current tenant — must not see the other tenant's node
    const res = await app.request(searchUrl({ flag: "shared" }), { headers: h() });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toHaveLength(0);

    // Cleanup other tenant
    await cleanTenant(sql, otherTid);
  });
});
