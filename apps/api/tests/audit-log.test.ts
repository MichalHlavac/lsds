// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../src/app";
import { sql } from "../src/db/client";
import { cleanTenant, createTestTenant } from "./test-helpers";

let tid: string;
const h = () => ({ "content-type": "application/json", "x-tenant-id": tid });

beforeEach(async () => { tid = randomUUID(); await createTestTenant(sql, tid); });
afterEach(async () => { await cleanTenant(sql, tid); });

// ── helpers ──────────────────────────────────────────────────────────────────

async function createNode(name = "svc", attrs: Record<string, unknown> = {}) {
  const res = await app.request("/v1/nodes", {
    method: "POST",
    headers: h(),
    body: JSON.stringify({ type: "Service", layer: "L4", name, attributes: attrs }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).data;
}

async function getAuditLog(params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await app.request(`/v1/audit-log${qs ? `?${qs}` : ""}`, { headers: h() });
  return res;
}

// ── write path — nodes ───────────────────────────────────────────────────────

describe("audit log — node mutations", () => {
  it("records node.create when POST /v1/nodes succeeds", async () => {
    const node = await createNode("alpha");
    const res = await getAuditLog({ entity_id: node.id });
    expect(res.status).toBe(200);
    const { items } = await res.json();
    expect(items.length).toBeGreaterThanOrEqual(1);
    const entry = items[0];
    expect(entry.operation).toBe("node.create");
    expect(entry.entityType).toBe("Service");
    expect(entry.entityId).toBe(node.id);
    expect(entry.diff).not.toBeNull();
    expect(entry.diff.before).toBeNull();
    expect(entry.diff.after).toMatchObject({ name: "alpha" });
  });

  it("records node.update when PATCH /v1/nodes/:id succeeds with changed diff only", async () => {
    const node = await createNode("beta");
    await app.request(`/v1/nodes/${node.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ name: "beta-renamed" }),
    });
    const res = await getAuditLog({ entity_id: node.id, operation: "node.update" });
    expect(res.status).toBe(200);
    const { items } = await res.json();
    expect(items.length).toBeGreaterThanOrEqual(1);
    const entry = items[0];
    expect(entry.operation).toBe("node.update");
    expect(entry.diff.before).toMatchObject({ name: "beta" });
    expect(entry.diff.after).toMatchObject({ name: "beta-renamed" });
    // unchanged fields must NOT appear in the diff
    expect(entry.diff.before.layer).toBeUndefined();
  });

  it("records node.delete when DELETE /v1/nodes/:id succeeds", async () => {
    const orig = process.env.LIFECYCLE_RETENTION_DAYS;
    process.env.LIFECYCLE_RETENTION_DAYS = "0";
    try {
      const node = await createNode("del-node");
      await app.request(`/v1/nodes/${node.id}/lifecycle`, {
        method: "PATCH", headers: h(), body: JSON.stringify({ transition: "deprecate" }),
      });
      await app.request(`/v1/nodes/${node.id}/lifecycle`, {
        method: "PATCH", headers: h(), body: JSON.stringify({ transition: "archive" }),
      });
      const delRes = await app.request(`/v1/nodes/${node.id}`, {
        method: "DELETE",
        headers: h(),
      });
      expect(delRes.status).toBe(200);
      const res = await getAuditLog({ entity_id: node.id, operation: "node.delete" });
      expect(res.status).toBe(200);
      const { items } = await res.json();
      expect(items.length).toBeGreaterThanOrEqual(1);
      const entry = items[0];
      expect(entry.operation).toBe("node.delete");
      expect(entry.entityId).toBe(node.id);
      expect(entry.diff.before).not.toBeNull();
      expect(entry.diff.after).toBeNull();
    } finally {
      if (orig === undefined) delete process.env.LIFECYCLE_RETENTION_DAYS;
      else process.env.LIFECYCLE_RETENTION_DAYS = orig;
    }
  });

  it("records node.update via PUT /v1/nodes (upsert on existing)", async () => {
    const node = await createNode("gamma");
    const putRes = await app.request("/v1/nodes", {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "gamma", version: "2.0" }),
    });
    expect(putRes.status).toBe(200);
    const updated = (await putRes.json()).data;
    const res = await getAuditLog({ entity_id: updated.id, operation: "node.update" });
    expect(res.status).toBe(200);
    const { items } = await res.json();
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].operation).toBe("node.update");
  });

  it("records node.create via PUT /v1/nodes when node does not exist", async () => {
    const putRes = await app.request("/v1/nodes", {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({ type: "Service", layer: "L4", name: "new-via-put" }),
    });
    expect(putRes.status).toBe(201);
    const created = (await putRes.json()).data;
    const res = await getAuditLog({ entity_id: created.id, operation: "node.create" });
    expect(res.status).toBe(200);
    const { items } = await res.json();
    expect(items.length).toBeGreaterThanOrEqual(1);
  });
});

// ── write path — lifecycle ───────────────────────────────────────────────────

describe("audit log — lifecycle transitions", () => {
  it("records node.deprecate from PATCH /:id/lifecycle", async () => {
    const node = await createNode("dep-test");
    const res = await app.request(`/v1/nodes/${node.id}/lifecycle`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ transition: "deprecate" }),
    });
    expect(res.status).toBe(200);
    const audit = await getAuditLog({ entity_id: node.id, operation: "node.deprecate" });
    const { items } = await audit.json();
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].operation).toBe("node.deprecate");
  });

  it("records node.deprecate from POST /v1/lifecycle/nodes/:id/deprecate", async () => {
    const node = await createNode("dep-lifecycle");
    const res = await app.request(`/v1/lifecycle/nodes/${node.id}/deprecate`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(200);
    const audit = await getAuditLog({ entity_id: node.id, operation: "node.deprecate" });
    const { items } = await audit.json();
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  it("records node.archive from POST /v1/lifecycle/nodes/:id/archive", async () => {
    const node = await createNode("arch-lifecycle");
    await app.request(`/v1/lifecycle/nodes/${node.id}/deprecate`, { method: "POST", headers: h() });
    const res = await app.request(`/v1/lifecycle/nodes/${node.id}/archive`, {
      method: "POST",
      headers: h(),
    });
    expect(res.status).toBe(200);
    const audit = await getAuditLog({ entity_id: node.id, operation: "node.archive" });
    const { items } = await audit.json();
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  it("records node.purge when DELETE /v1/lifecycle/nodes/:id/purge succeeds (hard purge)", async () => {
    const node = await createNode("purge-hard");
    await app.request(`/v1/lifecycle/nodes/${node.id}/deprecate`, { method: "POST", headers: h() });
    await app.request(`/v1/lifecycle/nodes/${node.id}/archive`, { method: "POST", headers: h() });
    await app.request(`/v1/lifecycle/nodes/${node.id}/mark-purge`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ purgeAfterDays: 0 }),
    });
    const purgeRes = await app.request(`/v1/lifecycle/nodes/${node.id}/purge`, {
      method: "DELETE",
      headers: h(),
    });
    expect(purgeRes.status).toBe(200);
    const res = await getAuditLog({ entity_id: node.id, operation: "node.purge" });
    expect(res.status).toBe(200);
    const { items } = await res.json();
    // Hard-purge entry has diff.after === null; mark-purge entry has diff.after with lifecycle status
    const hardPurgeEntry = items.find((e: { diff: { after: unknown } }) => e.diff.after === null);
    expect(hardPurgeEntry).toBeDefined();
    expect(hardPurgeEntry.operation).toBe("node.purge");
    expect(hardPurgeEntry.entityId).toBe(node.id);
    expect(hardPurgeEntry.diff.before).not.toBeNull();
    expect(hardPurgeEntry.diff.after).toBeNull();
  });
});

// ── write path — edges ───────────────────────────────────────────────────────

describe("audit log — edge mutations", () => {
  it("records edge.create when POST /v1/edges succeeds", async () => {
    const src = await createNode("edge-src");
    const tgt = await createNode("edge-tgt");
    const edgeRes = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: src.id, targetId: tgt.id, type: "contains", layer: "L4" }),
    });
    expect(edgeRes.status).toBe(201);
    const edge = (await edgeRes.json()).data;
    const res = await getAuditLog({ entity_id: edge.id });
    expect(res.status).toBe(200);
    const { items } = await res.json();
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].operation).toBe("edge.create");
    expect(items[0].diff.before).toBeNull();
  });

  it("records edge.delete when DELETE /v1/edges/:id succeeds", async () => {
    const orig = process.env.LIFECYCLE_RETENTION_DAYS;
    process.env.LIFECYCLE_RETENTION_DAYS = "0";
    try {
      const src = await createNode("ed-src");
      const tgt = await createNode("ed-tgt");
      const edgeRes = await app.request("/v1/edges", {
        method: "POST",
        headers: h(),
        body: JSON.stringify({ sourceId: src.id, targetId: tgt.id, type: "contains", layer: "L4" }),
      });
      expect(edgeRes.status).toBe(201);
      const edge = (await edgeRes.json()).data;
      await app.request(`/v1/edges/${edge.id}/lifecycle`, {
        method: "PATCH", headers: h(), body: JSON.stringify({ transition: "deprecate" }),
      });
      await app.request(`/v1/edges/${edge.id}/lifecycle`, {
        method: "PATCH", headers: h(), body: JSON.stringify({ transition: "archive" }),
      });
      const delRes = await app.request(`/v1/edges/${edge.id}`, {
        method: "DELETE",
        headers: h(),
      });
      expect(delRes.status).toBe(200);
      const res = await getAuditLog({ entity_id: edge.id, operation: "edge.delete" });
      expect(res.status).toBe(200);
      const { items } = await res.json();
      expect(items.length).toBeGreaterThanOrEqual(1);
      const entry = items[0];
      expect(entry.operation).toBe("edge.delete");
      expect(entry.entityId).toBe(edge.id);
      expect(entry.diff.before).not.toBeNull();
      expect(entry.diff.after).toBeNull();
    } finally {
      if (orig === undefined) delete process.env.LIFECYCLE_RETENTION_DAYS;
      else process.env.LIFECYCLE_RETENTION_DAYS = orig;
    }
  });

  it("records edge.update when PATCH /v1/edges/:id succeeds", async () => {
    const src = await createNode("eu-src");
    const tgt = await createNode("eu-tgt");
    const edgeRes = await app.request("/v1/edges", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ sourceId: src.id, targetId: tgt.id, type: "contains", layer: "L4" }),
    });
    const edge = (await edgeRes.json()).data;
    await app.request(`/v1/edges/${edge.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ traversalWeight: 2 }),
    });
    const audit = await getAuditLog({ entity_id: edge.id, operation: "edge.update" });
    const { items } = await audit.json();
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].diff.before).toMatchObject({ traversalWeight: 1 });
    expect(items[0].diff.after).toMatchObject({ traversalWeight: 2 });
  });
});

// ── read path — query params & pagination ───────────────────────────────────

describe("audit log — GET /v1/audit-log", () => {
  it("returns 400 for invalid operation filter", async () => {
    const res = await getAuditLog({ operation: "invalid.op" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for malformed from date", async () => {
    const res = await getAuditLog({ from: "not-a-date" });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid cursor", async () => {
    const res = await getAuditLog({ cursor: "!!not-base64url!!" });
    expect(res.status).toBe(400);
  });

  it("returns empty list for a fresh tenant", async () => {
    const res = await getAuditLog();
    expect(res.status).toBe(200);
    const { items, nextCursor } = await res.json();
    expect(items).toEqual([]);
    expect(nextCursor).toBeNull();
  });

  it("paginates with cursor across pages", async () => {
    // Create 3 nodes to get 3 audit entries
    for (let i = 0; i < 3; i++) await createNode(`page-node-${i}`);

    const page1Res = await getAuditLog({ limit: "2" });
    expect(page1Res.status).toBe(200);
    const page1 = await page1Res.json();
    expect(page1.items.length).toBe(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2Res = await getAuditLog({ limit: "2", cursor: page1.nextCursor });
    expect(page2Res.status).toBe(200);
    const page2 = await page2Res.json();
    expect(page2.items.length).toBeGreaterThanOrEqual(1);
    // No overlap between pages
    const ids1 = new Set(page1.items.map((e: { id: string }) => e.id));
    for (const entry of page2.items) {
      expect(ids1.has(entry.id)).toBe(false);
    }
  });

  it("filters by entity_type", async () => {
    await createNode("type-filter");
    const res = await getAuditLog({ entity_type: "Service" });
    expect(res.status).toBe(200);
    const { items } = await res.json();
    for (const entry of items) expect(entry.entityType).toBe("Service");
  });
});

// ── tenant isolation ─────────────────────────────────────────────────────────

describe("audit log — tenant isolation", () => {
  it("cannot read another tenant's audit log entries", async () => {
    const node = await createNode("isolation-node");
    // Confirm the entry is visible to tid
    const res1 = await getAuditLog({ entity_id: node.id });
    const { items: mine } = await res1.json();
    expect(mine.length).toBeGreaterThanOrEqual(1);

    // A different tenant sees nothing
    const otherTid = randomUUID();
    const res2 = await app.request(`/v1/audit-log?entity_id=${node.id}`, {
      headers: { "content-type": "application/json", "x-tenant-id": otherTid },
    });
    expect(res2.status).toBe(200);
    const { items: theirs } = await res2.json();
    expect(theirs).toEqual([]);
  });
});

// ── immutability ─────────────────────────────────────────────────────────────

describe("audit log — immutability", () => {
  it("returns 405 on DELETE /v1/audit-log", async () => {
    const res = await app.request("/v1/audit-log", { method: "DELETE", headers: h() });
    expect(res.status).toBe(405);
  });

  it("returns 405 on DELETE /v1/audit-log/:id", async () => {
    const res = await app.request(`/v1/audit-log/${randomUUID()}`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(405);
  });

  it("returns 405 on PATCH /v1/audit-log/:id", async () => {
    const res = await app.request(`/v1/audit-log/${randomUUID()}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(405);
  });

  it("returns 405 on PUT /v1/audit-log", async () => {
    const res = await app.request("/v1/audit-log", {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(405);
  });

  it("returns 404 or 405 on PUT /v1/audit-log/:id", async () => {
    const res = await app.request(`/v1/audit-log/${randomUUID()}`, {
      method: "PUT",
      headers: h(),
      body: JSON.stringify({}),
    });
    expect([404, 405]).toContain(res.status);
  });

  it("returns 404 or 405 on POST /v1/audit-log/bulk-delete", async () => {
    const res = await app.request("/v1/audit-log/bulk-delete", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ ids: [randomUUID()] }),
    });
    expect([404, 405]).toContain(res.status);
  });

  it("returns 404 or 405 on POST /v1/audit-log/truncate", async () => {
    const res = await app.request("/v1/audit-log/truncate", {
      method: "POST",
      headers: h(),
    });
    expect([404, 405]).toContain(res.status);
  });

  it("audit entry is not mutated by subsequent writes to the same entity", async () => {
    const node = await createNode("immut-node");

    const res1 = await getAuditLog({ entity_id: node.id, operation: "node.create" });
    expect(res1.status).toBe(200);
    const { items: before } = await res1.json();
    expect(before.length).toBeGreaterThanOrEqual(1);
    const createEntry = before[0];

    await app.request(`/v1/nodes/${node.id}`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ name: "immut-node-renamed" }),
    });

    const res2 = await getAuditLog({ entity_id: node.id, operation: "node.create" });
    expect(res2.status).toBe(200);
    const { items: after } = await res2.json();
    const sameEntry = after.find((e: { id: string }) => e.id === createEntry.id);
    expect(sameEntry).toBeDefined();
    expect(sameEntry.id).toBe(createEntry.id);
    expect(sameEntry.operation).toBe("node.create");
    expect(sameEntry.createdAt).toBe(createEntry.createdAt);
    expect(sameEntry.diff).toEqual(createEntry.diff);
  });
});
