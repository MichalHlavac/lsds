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

async function createNode(name = "test-node") {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ type: "Service", layer: "L4", name }),
  });
  return (await res.json()).data;
}

// ── full lifecycle flow ───────────────────────────────────────────────────────

describe("full ACTIVE → DEPRECATED → ARCHIVED → PURGE → deleted flow", () => {
  it("transitions a node through all lifecycle stages", async () => {
    const node = await createNode("lifecycle-node");

    // 1. Deprecate (ACTIVE → DEPRECATED)
    let res = await app.request(`/v1/lifecycle/nodes/${node.id}/deprecate`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.lifecycleStatus).toBe("DEPRECATED");

    // 2. Archive (DEPRECATED → ARCHIVED)
    res = await app.request(`/v1/lifecycle/nodes/${node.id}/archive`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.lifecycleStatus).toBe("ARCHIVED");

    // 3. Mark for purge with -1 days → purge_after is in the past
    res = await app.request(`/v1/lifecycle/nodes/${node.id}/mark-purge`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ purgeAfterDays: -1 }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.lifecycleStatus).toBe("PURGE");

    // 4. Purge (DELETE from DB)
    res = await app.request(`/v1/lifecycle/nodes/${node.id}/purge`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.purged).toBe(true);

    // 5. Verify the node is gone
    res = await app.request(`/v1/nodes/${node.id}`, { headers: h() });
    expect(res.status).toBe(404);
  });
});

// ── POST .../deprecate ────────────────────────────────────────────────────────

describe("POST /v1/lifecycle/nodes/:id/deprecate", () => {
  it("transitions ACTIVE → DEPRECATED and returns the node", async () => {
    const node = await createNode();
    const res = await app.request(`/v1/lifecycle/nodes/${node.id}/deprecate`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.lifecycleStatus).toBe("DEPRECATED");
    expect(data.deprecatedAt).toBeTruthy();
  });

  it("returns 400 when the node is already DEPRECATED (not ACTIVE)", async () => {
    const node = await createNode();
    // First deprecate: OK
    await app.request(`/v1/lifecycle/nodes/${node.id}/deprecate`, { method: "POST", headers: h() });
    // Second deprecate: 400 — no longer ACTIVE
    const res = await app.request(`/v1/lifecycle/nodes/${node.id}/deprecate`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ACTIVE/);
  });
});

// ── POST .../archive ──────────────────────────────────────────────────────────

describe("POST /v1/lifecycle/nodes/:id/archive", () => {
  it("transitions ACTIVE → ARCHIVED", async () => {
    const node = await createNode();
    const res = await app.request(`/v1/lifecycle/nodes/${node.id}/archive`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.lifecycleStatus).toBe("ARCHIVED");
  });

  it("transitions DEPRECATED → ARCHIVED", async () => {
    const node = await createNode();
    await app.request(`/v1/lifecycle/nodes/${node.id}/deprecate`, { method: "POST", headers: h() });
    const res = await app.request(`/v1/lifecycle/nodes/${node.id}/archive`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.lifecycleStatus).toBe("ARCHIVED");
  });

  it("returns 400 for an already ARCHIVED node", async () => {
    const node = await createNode();
    await app.request(`/v1/lifecycle/nodes/${node.id}/archive`, { method: "POST", headers: h() });
    const res = await app.request(`/v1/lifecycle/nodes/${node.id}/archive`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(400);
  });
});

// ── POST .../mark-purge ───────────────────────────────────────────────────────

describe("POST /v1/lifecycle/nodes/:id/mark-purge", () => {
  it("transitions ARCHIVED → PURGE and sets purge_after", async () => {
    const node = await createNode();
    await app.request(`/v1/lifecycle/nodes/${node.id}/archive`, { method: "POST", headers: h() });

    const res = await app.request(`/v1/lifecycle/nodes/${node.id}/mark-purge`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ purgeAfterDays: 30 }),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.lifecycleStatus).toBe("PURGE");
    expect(data.purgeAfter).toBeTruthy();
  });

  it("returns 400 when the node is not ARCHIVED", async () => {
    const node = await createNode();  // ACTIVE state
    const res = await app.request(`/v1/lifecycle/nodes/${node.id}/mark-purge`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ARCHIVED/);
  });
});

// ── DELETE .../purge ──────────────────────────────────────────────────────────

describe("DELETE /v1/lifecycle/nodes/:id/purge", () => {
  it("returns 400 when node is not in PURGE state", async () => {
    const node = await createNode();  // ACTIVE
    const res = await app.request(`/v1/lifecycle/nodes/${node.id}/purge`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not eligible/);
  });
});

// ── POST /v1/lifecycle/apply-retention ───────────────────────────────────────

describe("POST /v1/lifecycle/apply-retention", () => {
  it("returns 200 with deprecated and archived counts", async () => {
    const res = await app.request("/v1/lifecycle/apply-retention", {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(typeof data.deprecated).toBe("number");
    expect(typeof data.archived).toBe("number");
  });
});
